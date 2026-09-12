import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { safeProjectPath } from './fs-safe.js';
import { runGodot } from './godot.js';
import { resolveGodot } from './process.js';
import type { CommandResult } from './types.js';

const STATE = '.gjm_runtime.json';
const RUNNER = '.gjm_runtime_bridge.gd';
const SCENE = '.gjm_runtime_bridge.tscn';

export interface RuntimeState {
  id: string;
  token: string;
  port: number;
  pid?: number;
  startedAt: string;
  projectRoot: string;
}

function gdString(value: string): string { return JSON.stringify(value); }

function emitBridgeScript(mainScene: string): string {
  return `extends Node

var server = TCP_Server.new()
var client = StreamPeerTCP.new()
var game_root = null
var port = 0
var auth_token = ""

func _ready():
    var scene = load(${gdString(mainScene)})
    if scene == null:
        push_error("GJM_RUNTIME: unable to load ${mainScene}")
        get_tree().quit(22)
        return
    game_root = scene.instance()
    add_child(game_root)
    auth_token = OS.get_environment("GJM_RUNTIME_TOKEN")
    var requested = int(OS.get_environment("GJM_RUNTIME_PORT"))
    for p in range(requested, requested + 50):
        if server.listen(p, "127.0.0.1") == OK:
            port = p
            print("GJM_RUNTIME_READY " + str(port))
            return
    push_error("GJM_RUNTIME: unable to bind localhost port")
    get_tree().quit(23)

func _process(_delta):
    if client.get_status() == StreamPeerTCP.STATUS_NONE and server.is_connection_available():
        client = server.take_connection()
    if client.get_status() == StreamPeerTCP.STATUS_CONNECTED:
        while client.get_available_bytes() > 0:
            var line = client.get_utf8_string(client.get_available_bytes())
            for raw in line.split("\\n"):
                if raw.strip_edges() == "":
                    continue
                var response = handle(raw)
                client.put_data((JSON.print(response) + "\\n").to_utf8())

func node_at(node_path):
    if node_path == "" or node_path == ".":
        return game_root
    return game_root.get_node_or_null(str(node_path))

func json_value(value):
    if value is Object and value.has_method("to_json"):
        return value.to_json()
    if value is Vector2:
        return {"x": value.x, "y": value.y}
    if value is Vector3:
        return {"x": value.x, "y": value.y, "z": value.z}
    if value is Color:
        return {"r": value.r, "g": value.g, "b": value.b, "a": value.a}
    return value

func coerce_value(value):
    if typeof(value) == TYPE_DICTIONARY:
        if value.has("x") and value.has("y") and value.has("z"):
            return Vector3(float(value.x), float(value.y), float(value.z))
        if value.has("x") and value.has("y"):
            return Vector2(float(value.x), float(value.y))
        if value.has("r") and value.has("g") and value.has("b"):
            return Color(float(value.r), float(value.g), float(value.b), float(value.get("a", 1.0)))
    return value

func inspect_node(node_path):
    var node = node_at(node_path)
    if node == null:
        return {"ok": false, "error": "node_not_found", "path": node_path}
    var props = {}
    for prop in ["name", "visible", "position", "rotation", "scale", "text", "disabled", "modulate"]:
        if prop in node:
            props[prop] = json_value(node.get(prop))
    return {"ok": true, "path": node_path, "name": node.name, "type": node.get_class(), "properties": props}

func tree(node, prefix = ".", out = []):
    out.append({"path": prefix, "name": node.name, "type": node.get_class()})
    for child in node.get_children():
        tree(child, prefix + "/" + str(child.name), out)
    return out

func runtime_info():
    return {
        "ok": true,
        "engine": Engine.get_version_info(),
        "current_scene": get_tree().current_scene.name if get_tree().current_scene != null else null,
        "node_count": _count_nodes(game_root),
        "uptime_ms": OS.get_ticks_msec()
    }

func _count_nodes(node):
    var count = 1
    for child in node.get_children():
        count += _count_nodes(child)
    return count

func handle(raw):
    var req = JSON.parse(raw)
    if req.error != OK:
        return {"ok": false, "error": "invalid_json"}
    var data = req.result
    if typeof(data) != TYPE_DICTIONARY:
        return {"ok": false, "error": "request_not_object"}
    if str(data.get("token", "")) != auth_token:
        return {"ok": false, "error": "unauthorized"}
    var op = str(data.get("op", ""))
    if op == "ping":
        return {"ok": true, "result": "pong", "port": port}
    if op == "tree":
        var tree_root = node_at(str(data.get("path", ".")))
        if tree_root == null:
            return {"ok": false, "error": "node_not_found", "path": str(data.get("path", "."))}
        return {"ok": true, "nodes": tree(tree_root, str(data.get("path", ".")))}
    if op == "runtime_info":
        return runtime_info()
    if op == "inspect_node":
        return inspect_node(str(data.get("path", ".")))
    if op == "get_property":
        var node = node_at(str(data.get("path", ".")))
        var prop = str(data.get("property", ""))
        if node == null:
            return {"ok": false, "error": "node_not_found"}
        if prop == "" or not (prop in node):
            return {"ok": false, "error": "property_not_found", "property": prop}
        return {"ok": true, "value": json_value(node.get(prop))}
    if op == "set_property":
        var target = node_at(str(data.get("path", ".")))
        var property = str(data.get("property", ""))
        if target == null:
            return {"ok": false, "error": "node_not_found"}
        if property == "" or not (property in target):
            return {"ok": false, "error": "property_not_found", "property": property}
        target.set(property, coerce_value(data.get("value")))
        return {"ok": true, "property": property, "value": json_value(target.get(property))}
    if op == "call_method":
        var callable = node_at(str(data.get("path", ".")))
        var method = str(data.get("method", ""))
        if callable == null:
            return {"ok": false, "error": "node_not_found"}
        if method == "" or not callable.has_method(method):
            return {"ok": false, "error": "method_not_found", "method": method}
        var args = data.get("args", [])
        var result = callable.callv(method, args)
        return {"ok": true, "result": json_value(result)}
    if op == "screenshot":
        var file_path = str(data.get("path", "res://.gjm_frames/runtime.png"))
        var image = get_viewport().get_texture().get_data()
        if image == null:
            return {"ok": false, "error": "screenshot_failed"}
        image.save_png(file_path)
        return {"ok": true, "path": file_path}
    if op == "quit":
        get_tree().quit(0)
        return {"ok": true}
    return {"ok": false, "error": "unknown_op", "op": op}
`;
}

function emitScene(major: number): string {
  return major >= 4
    ? `[gd_scene load_steps=2 format=3]\n\n[ext_resource type="Script" path="res://${RUNNER}" id="1_runner"]\n\n[node name="GJMRuntimeBridge" type="Node"]\nscript = ExtResource("1_runner")\n`
    : `[gd_scene load_steps=2 format=2]\n\n[ext_resource path="res://${RUNNER}" type="Script" id="1"]\n\n[node name="GJMRuntimeBridge" type="Node"]\nscript = ExtResource(1)\n`;
}

async function findFreePort(start: number, end: number): Promise<number> {
  for (let port = start; port < end; port++) {
    const available = await new Promise<boolean>(resolve => {
      const srv = net.createServer();
      srv.once('error', () => resolve(false));
      srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
    });
    if (available) return port;
  }
  throw new Error('No free localhost runtime port available.');
}

async function writeState(root: string, state: RuntimeState) {
  await fs.writeFile(safeProjectPath(root, STATE), JSON.stringify(state, null, 2), 'utf8');
}

export async function readRuntime(root: string): Promise<RuntimeState | null> {
  try { return JSON.parse(await fs.readFile(safeProjectPath(root, STATE), 'utf8')) as RuntimeState; }
  catch { return null; }
}

export async function startRuntime(root: string): Promise<RuntimeState> {
  const old = await readRuntime(root);
  if (old) { try { await stopRuntime(root); } catch {} }
  const projectFile = safeProjectPath(root, 'project.godot');
  const project = await fs.readFile(projectFile, 'utf8');
  const m = project.match(/run\/main_scene[^\n]*=\s*"([^"]+)"/);
  const scene = m?.[1] ?? 'res://main.tscn';
  const major = Number((await (await import('./godot.js')).godotVersion()).major);
  await fs.writeFile(safeProjectPath(root, RUNNER), emitBridgeScript(scene), 'utf8');
  await fs.writeFile(safeProjectPath(root, SCENE), emitScene(major), 'utf8');

  const portHint = await findFreePort(17890, 17940);
  const token = randomUUID();
  const procPromise = runGodot(
    ['--path', root, major >= 4 ? '--scene' : SCENE, ...(major >= 4 ? [SCENE] : [])],
    root,
    60000,
    { GJM_RUNTIME_PORT: String(portHint), GJM_RUNTIME_TOKEN: token }
  );
  void procPromise.catch(() => undefined);
  const state: RuntimeState = { id: randomUUID(), token, port: portHint, startedAt: new Date().toISOString(), projectRoot: root };
  await writeState(root, state);
  let foundPort: number | undefined;
  for (let i=0;i<120;i++) {
    for (let p=portHint;p<portHint+1;p++) {
      const ok = await new Promise<boolean>(resolve => {
        const s = net.createConnection({host:'127.0.0.1',port:p});
        s.once('connect',()=>{s.destroy();resolve(true)});
        s.once('error',()=>resolve(false));
        s.setTimeout(30,()=>{s.destroy();resolve(false)});
      });
      if (ok) { foundPort = p; break; }
    }
    if (foundPort) break;
    await new Promise(r=>setTimeout(r,100));
  }
  if (!foundPort) { await procPromise.catch(()=>{}); throw new Error('GJM runtime bridge failed to start.'); }
  state.port = foundPort;
  await writeState(root, state);
  return state;
}

export async function runtimeCommand(root: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  const state = await readRuntime(root);
  if (!state) throw new Error('No active GJM runtime.');
  return new Promise((resolve, reject) => {
    request = { ...request, token: state.token };
    const socket = net.createConnection({host:'127.0.0.1', port: state.port});
    let buffer = '';
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('Runtime command timeout.')); }, 5000);
    socket.on('connect', () => socket.write(JSON.stringify(request)+'\n'));
    socket.on('data', data => {
      buffer += data.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      const line = buffer.slice(0,nl); clearTimeout(timer); socket.end();
      try { resolve(JSON.parse(line)); } catch (e) { reject(e); }
    });
    socket.on('error', e => { clearTimeout(timer); reject(e); });
  });
}

export async function stopRuntime(root: string): Promise<void> {
  const state = await readRuntime(root);
  if (!state) return;
  try { await runtimeCommand(root, {op:'quit'}); } catch {}
  await new Promise(r=>setTimeout(r,100));
  await fs.rm(safeProjectPath(root, STATE), {force:true});
  await fs.rm(safeProjectPath(root, RUNNER), {force:true});
  await fs.rm(safeProjectPath(root, SCENE), {force:true});
}
