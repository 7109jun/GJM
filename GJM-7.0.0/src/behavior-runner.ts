import fs from 'node:fs/promises';
import { safeProjectPath, writeText } from './fs-safe.js';
import { getGodotMajor, runGodot } from './godot.js';
import type { BehaviorFile, CommandResult } from './types.js';

const RUNNER = '.gjm_behavior_runner.gd';
const RUNNER_SCENE = '.gjm_behavior_runner.tscn';
const BEHAVIOR_DATA = '.gjm_behavior.json';
const FRAMES = '.gjm_frames';

function gdString(value: string): string {
  return JSON.stringify(value);
}

function emitRunner3(mainScene: string): string {
  return `extends Node

var actions = []
var fps = 30.0
var frame_index = 0
var accumulator = 0.0
var running = false
var checkpoint_index = 0
var game_root = null

func _ready():
    var dir = Directory.new()
    dir.make_dir_recursive("res://.gjm_frames")

    var file = File.new()
    if file.open("res://${BEHAVIOR_DATA}", File.READ) != OK:
        push_error("GJM: behavior file could not be opened")
        get_tree().quit(20)
        return

    var data = parse_json(file.get_as_text())
    file.close()
    if typeof(data) != TYPE_DICTIONARY:
        push_error("GJM: behavior data is not an object")
        get_tree().quit(21)
        return

    actions = data.get("actions", [])
    fps = float(data.get("capture", {}).get("fps", 30))

    var scene = load(${gdString(mainScene)})
    if scene == null:
        push_error("GJM: main scene could not be loaded: ${mainScene}")
        get_tree().quit(22)
        return

    var game = scene.instance()
    add_child(game)
    game_root = game
    run_actions()

func _process(delta):
    if not running:
        return
    accumulator += delta
    var interval = 1.0 / max(fps, 1.0)
    while accumulator >= interval:
        accumulator -= interval
        capture_frame()

func capture_frame():
    var image = get_viewport().get_texture().get_data()
    if image:
        image.save_png("res://.gjm_frames/frame_%06d.png" % frame_index)
        frame_index += 1

func capture_checkpoint(name):
    var image = get_viewport().get_texture().get_data()
    if image:
        var safe = str(name).replace("/", "_").replace("\\\\", "_").replace(" ", "_")
        if safe == "":
            safe = "checkpoint_%03d" % checkpoint_index
        image.save_png("res://.gjm_frames/checkpoint_%03d_%s.png" % [checkpoint_index, safe])
        checkpoint_index += 1

func button_code(value):
    if typeof(value) == TYPE_REAL or typeof(value) == TYPE_INT:
        return int(value)
    match str(value).to_lower():
        "right": return BUTTON_RIGHT
        "middle": return BUTTON_MIDDLE
        _: return BUTTON_LEFT

func send_key(key, pressed):
    var event = InputEventKey.new()
    event.scancode = OS.find_scancode_from_string(str(key))
    event.pressed = pressed
    Input.parse_input_event(event)

func send_mouse_button(x, y, button, pressed):
    var event = InputEventMouseButton.new()
    event.position = Vector2(float(x), float(y))
    event.button_index = button_code(button)
    event.pressed = pressed
    Input.parse_input_event(event)

func send_mouse_move(x, y):
    var event = InputEventMouseMotion.new()
    event.position = Vector2(float(x), float(y))
    Input.parse_input_event(event)

func inspect_node(root, node_path, label):
    var node = null
    if node_path == "" or node_path == ".":
        node = root
    else:
        node = root.get_node_or_null(node_path)
    var payload = {"path": node_path, "label": label, "exists": node != null}
    if node != null and node is Node:
        var props = {}
        for prop in ["text", "visible", "position", "rotation", "scale", "disabled", "modulate"]:
            if prop in node:
                props[prop] = node.get(prop)
        payload["properties"] = props
    print("GJM_NODE " + to_json(payload))

func run_actions():
    running = true
    for a in actions:
        var t = str(a.get("type", ""))
        if t == "wait":
            yield(get_tree().create_timer(float(a.get("ms", 0)) / 1000.0), "timeout")
        elif t == "key_down":
            send_key(a.get("key", ""), true)
        elif t == "key_up":
            send_key(a.get("key", ""), false)
        elif t == "key_press":
            send_key(a.get("key", ""), true)
            yield(get_tree().create_timer(float(a.get("durationMs", 50)) / 1000.0), "timeout")
            send_key(a.get("key", ""), false)
        elif t == "mouse_move":
            send_mouse_move(a.get("x", 0), a.get("y", 0))
        elif t == "mouse_down":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
        elif t == "mouse_up":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
        elif t == "click":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
            yield(get_tree().create_timer(0.05), "timeout")
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
        elif t == "click_node":
            var target = game_root.get_node_or_null(str(a.get("path", "")))
            if target == null:
                push_error("GJM: click_node target not found: %s" % str(a.get("path", "")))
                get_tree().quit(31)
                return
            var rect = target.get_global_rect() if target is Control else Rect2(target.global_position, Vector2(1,1))
            var pos = rect.position + rect.size * 0.5
            send_mouse_button(pos.x, pos.y, a.get("button", "left"), true)
            yield(get_tree().create_timer(0.05), "timeout")
            send_mouse_button(pos.x, pos.y, a.get("button", "left"), false)
        elif t == "double_click":
            for i in range(2):
                send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
                yield(get_tree().create_timer(0.05), "timeout")
                send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
                yield(get_tree().create_timer(0.08), "timeout")
        elif t == "scroll":
            var wheel = InputEventMouseButton.new()
            wheel.position = Vector2(float(a.get("x", 0)), float(a.get("y", 0)))
            wheel.button_index = BUTTON_WHEEL_UP if float(a.get("deltaY", 0)) < 0 else BUTTON_WHEEL_DOWN
            wheel.pressed = true
            Input.parse_input_event(wheel)
        elif t == "screenshot":
            capture_frame()
            capture_checkpoint(a.get("name", "checkpoint"))
        elif t == "inspect_node":
            inspect_node(game_root, str(a.get("path", "")), str(a.get("label", "")))

        yield(get_tree().create_timer(0.016), "timeout")

    running = false
    capture_frame()
    get_tree().quit(0)
`;
}

function emitRunnerScene(major: number): string {
  if (major >= 4) {
    return `[gd_scene load_steps=2 format=3]\n\n[ext_resource type=\"Script\" path=\"res://${RUNNER}\" id=\"1_runner\"]\n\n[node name=\"GJMBehaviorRunner\" type=\"Node\"]\nscript = ExtResource(\"1_runner\")\n`;
  }
  return `[gd_scene load_steps=2 format=2]\n\n[ext_resource path=\"res://${RUNNER}\" type=\"Script\" id=\"1\"]\n\n[node name=\"GJMBehaviorRunner\" type=\"Node\"]\nscript = ExtResource(1)\n`;
}

function emitRunner4(mainScene: string): string {
  return `extends Node

var actions = []
var fps = 30.0
var frame_index = 0
var accumulator = 0.0
var running = false
var checkpoint_index = 0
var game_root = null

func _ready():
    DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path("res://.gjm_frames"))

    var file = FileAccess.open("res://${BEHAVIOR_DATA}", FileAccess.READ)
    if file == null:
        push_error("GJM: behavior file could not be opened")
        get_tree().quit(20)
        return

    var data = JSON.parse_string(file.get_as_text())
    if typeof(data) != TYPE_DICTIONARY:
        push_error("GJM: behavior data is not an object")
        get_tree().quit(21)
        return

    actions = data.get("actions", [])
    fps = float(data.get("capture", {}).get("fps", 30))

    var scene = load(${gdString(mainScene)})
    if scene == null:
        push_error("GJM: main scene could not be loaded: ${mainScene}")
        get_tree().quit(22)
        return

    var game = scene.instantiate()
    add_child(game)
    game_root = game
    run_actions()

func _process(delta):
    if not running:
        return
    accumulator += delta
    var interval = 1.0 / max(fps, 1.0)
    while accumulator >= interval:
        accumulator -= interval
        capture_frame()

func capture_frame():
    var image = get_viewport().get_texture().get_image()
    if image:
        image.save_png("res://.gjm_frames/frame_%06d.png" % frame_index)
        frame_index += 1

func capture_checkpoint(name):
    var image = get_viewport().get_texture().get_image()
    if image:
        var safe = str(name).replace("/", "_").replace("\\\\", "_").replace(" ", "_")
        if safe == "":
            safe = "checkpoint_%03d" % checkpoint_index
        image.save_png("res://.gjm_frames/checkpoint_%03d_%s.png" % [checkpoint_index, safe])
        checkpoint_index += 1

func button_code(value):
    if typeof(value) == TYPE_INT:
        return int(value)
    match str(value).to_lower():
        "right": return MOUSE_BUTTON_RIGHT
        "middle": return MOUSE_BUTTON_MIDDLE
        _: return MOUSE_BUTTON_LEFT

func send_key(key, pressed):
    var event = InputEventKey.new()
    event.keycode = OS.find_keycode_from_string(str(key))
    event.pressed = pressed
    Input.parse_input_event(event)

func send_mouse_button(x, y, button, pressed):
    var event = InputEventMouseButton.new()
    event.position = Vector2(float(x), float(y))
    event.button_index = button_code(button)
    event.pressed = pressed
    Input.parse_input_event(event)

func send_mouse_move(x, y):
    var event = InputEventMouseMotion.new()
    event.position = Vector2(float(x), float(y))
    Input.parse_input_event(event)

func inspect_node(root, node_path, label):
    var node = null
    if node_path == "" or node_path == ".":
        node = root
    else:
        node = root.get_node_or_null(node_path)
    var payload = {"path": node_path, "label": label, "exists": node != null}
    if node != null and node is Node:
        var props = {}
        for prop in ["text", "visible", "position", "rotation", "scale", "disabled", "modulate"]:
            if prop in node:
                props[prop] = node.get(prop)
        payload["properties"] = props
    print("GJM_NODE " + JSON.stringify(payload))

func run_actions():
    running = true
    for a in actions:
        var t = str(a.get("type", ""))
        if t == "wait":
            await get_tree().create_timer(float(a.get("ms", 0)) / 1000.0).timeout
        elif t == "key_down":
            send_key(a.get("key", ""), true)
        elif t == "key_up":
            send_key(a.get("key", ""), false)
        elif t == "key_press":
            send_key(a.get("key", ""), true)
            await get_tree().create_timer(float(a.get("durationMs", 50)) / 1000.0).timeout
            send_key(a.get("key", ""), false)
        elif t == "mouse_move":
            send_mouse_move(a.get("x", 0), a.get("y", 0))
        elif t == "mouse_down":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
        elif t == "mouse_up":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
        elif t == "click":
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
            await get_tree().create_timer(0.05).timeout
            send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
        elif t == "double_click":
            for i in range(2):
                send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), true)
                await get_tree().create_timer(0.05).timeout
                send_mouse_button(a.get("x", 0), a.get("y", 0), a.get("button", "left"), false)
                await get_tree().create_timer(0.08).timeout
        elif t == "scroll":
            var wheel = InputEventMouseButton.new()
            wheel.position = Vector2(float(a.get("x", 0)), float(a.get("y", 0)))
            wheel.button_index = MOUSE_BUTTON_WHEEL_UP if float(a.get("deltaY", 0)) < 0 else MOUSE_BUTTON_WHEEL_DOWN
            wheel.pressed = true
            Input.parse_input_event(wheel)
        elif t == "screenshot":
            capture_frame()
            capture_checkpoint(a.get("name", "checkpoint"))
        elif t == "inspect_node":
            inspect_node(game_root, str(a.get("path", "")), str(a.get("label", "")))

        await get_tree().create_timer(0.016).timeout

    running = false
    capture_frame()
    get_tree().quit(0)
`;
}

export async function runBehavior(projectRoot: string, behavior: BehaviorFile): Promise<CommandResult> {
  const major = await getGodotMajor();
  const projectFile = safeProjectPath(projectRoot, 'project.godot');
  const projectText = await fs.readFile(projectFile, 'utf8');
  const match = projectText.match(/^run\/main_scene\s*=\s*"([^"]+)"/m);
  const mainScene = match?.[1] ?? 'res://main.tscn';

  const frames = safeProjectPath(projectRoot, FRAMES);
  await fs.rm(frames, { recursive: true, force: true });
  await fs.mkdir(frames, { recursive: true });
  await writeText(projectRoot, BEHAVIOR_DATA, JSON.stringify(behavior, null, 2));
  await writeText(projectRoot, RUNNER, major >= 4 ? emitRunner4(mainScene) : emitRunner3(mainScene));
  await writeText(projectRoot, RUNNER_SCENE, emitRunnerScene(major));

  try {
    return await runGodot(['--path', projectRoot, `res://${RUNNER_SCENE}`], projectRoot, 120000);
  } finally {
    await Promise.all([
      fs.rm(safeProjectPath(projectRoot, RUNNER), { force: true }),
      fs.rm(safeProjectPath(projectRoot, RUNNER_SCENE), { force: true }),
      fs.rm(safeProjectPath(projectRoot, BEHAVIOR_DATA), { force: true })
    ]);
  }
}
