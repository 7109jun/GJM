import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { safeProjectPath } from './fs-safe.js';
import { getGodotMajor, runGodot } from './godot.js';

export type SceneOp =
  | { op: 'create'; scene: string; rootType?: string; rootName?: string }
  | { op: 'add_node'; scene: string; parent?: string; type: string; name?: string; properties?: Record<string, unknown>; script?: string }
  | { op: 'remove_node'; scene: string; path: string }
  | { op: 'rename_node'; scene: string; path: string; name: string }
  | { op: 'reparent_node'; scene: string; path: string; parent: string }
  | { op: 'set_property'; scene: string; path: string; property: string; value: unknown }
  | { op: 'attach_script'; scene: string; path: string; script: string }
  | { op: 'duplicate_node'; scene: string; path: string; parent?: string; name?: string }
  | { op: 'save'; scene: string };

function gdQuote(v: string): string { return JSON.stringify(v); }

function gdValue(v: unknown): string {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return gdQuote(v);
  if (Array.isArray(v)) return `[${v.map(gdValue).join(', ') }]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (typeof o.$type === 'string' && Array.isArray(o.value)) {
      const vals = o.value.map(gdValue).join(', ');
      switch (o.$type) {
        case 'Vector2': return `Vector2(${vals})`;
        case 'Vector3': return `Vector3(${vals})`;
        case 'Vector2i': return `Vector2(${vals})`;
        case 'Vector3i': return `Vector3(${vals})`;
        case 'Color': return `Color(${vals})`;
        case 'Rect2': return `Rect2(${vals})`;
        case 'Quat': return `Quat(${vals})`;
      }
    }
    if (typeof o.nodePath === 'string') return `NodePath(${gdQuote(o.nodePath)})`;
    if (typeof o.resource === 'string') return `load(${gdQuote(o.resource)})`;
    const pairs = Object.entries(o).map(([k, x]) => `${gdQuote(k)}: ${gdValue(x)}`);
    return `{${pairs.join(', ')}}`;
  }
  throw new Error(`Unsupported property value type: ${typeof v}`);
}

function blockForScene(scene: string, ops: SceneOp[], index: number): string[] {
  const out: string[] = [];
  const s = gdQuote(scene);
  const sceneVar = `scene_${index}`;
  const rootVar = `root_${index}`;
  const packedVar = `packed_${index}`;
  const createOps = ops.filter(o => o.op === 'create');

  out.push(`    scene_path = ${s}`);
  if (createOps.length > 0) {
    if (createOps.length > 1) throw new Error(`Multiple create operations for scene: ${scene}`);
    const c = createOps[0] as Extract<SceneOp, { op: 'create' }>;
    out.push(`    var ${rootVar} = ClassDB.instance(${gdQuote(c.rootType ?? 'Node')})`);
    out.push(`    ${rootVar}.name = ${gdQuote(c.rootName ?? 'Main')}`);
  } else {
    out.push(`    var loaded_${index} = ResourceLoader.load(scene_path)`);
    out.push(`    if loaded_${index} == null: results.append({"scene": scene_path, "error": "scene_not_found"})`);
    out.push(`    var ${rootVar} = null`);
    out.push(`    if loaded_${index} != null: ${rootVar} = loaded_${index}.instance()`);
    out.push(`    if ${rootVar} == null: results.append({"scene": scene_path, "error": "instance_failed"})`);
  }

  let opIndex = 0;
  for (const op of ops) {
    const p = `${index}_${opIndex++}`;
    if (op.op === 'create' || op.op === 'save') continue;
    if (op.op === 'add_node') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var parent_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.parent ?? '.')})`);
      out.push(`        var node_${p} = ClassDB.instance(${gdQuote(op.type)})`);
      out.push(`        if node_${p} != null:`);
      out.push(`            node_${p}.name = ${gdQuote(op.name ?? 'Node')}`);
      if (op.properties) for (const [k, v] of Object.entries(op.properties)) out.push(`            node_${p}.set(${gdQuote(k)}, ${gdValue(v)})`);
      if (op.script) out.push(`            node_${p}.set_script(load(${gdQuote(op.script)}))`);
      out.push(`            if parent_${p} != null:`);
      out.push(`                parent_${p}.add_child(node_${p})`);
      out.push(`                node_${p}.owner = ${rootVar}`);
      out.push(`                results.append({"op":"add_node","name":node_${p}.name})`);
      out.push(`            else:`);
      out.push(`                results.append({"op":"add_node","error":"parent_not_found"})`);
    } else if (op.op === 'remove_node') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        if node_${p} != null:`);
      out.push(`            node_${p}.get_parent().remove_child(node_${p})`);
      out.push(`            node_${p}.free()`);
      out.push(`            results.append({"op":"remove_node","path":${gdQuote(op.path)}})`);
      out.push(`        else:`);
      out.push(`            results.append({"op":"remove_node","error":"node_not_found"})`);
    } else if (op.op === 'rename_node') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        if node_${p} != null:`);
      out.push(`            node_${p}.name = ${gdQuote(op.name)}`);
      out.push(`            results.append({"op":"rename_node"})`);
      out.push(`        else:`);
      out.push(`            results.append({"op":"rename_node","error":"node_not_found"})`);
    } else if (op.op === 'reparent_node') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        var parent_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.parent)})`);
      out.push(`        if node_${p} != null and parent_${p} != null:`);
      out.push(`            var old_parent_${p} = node_${p}.get_parent()`);
      out.push(`            if old_parent_${p} != null:`);
      out.push(`                old_parent_${p}.remove_child(node_${p})`);
      out.push(`            parent_${p}.add_child(node_${p})`);
      out.push(`            node_${p}.owner = ${rootVar}`);
      out.push(`            results.append({"op":"reparent_node"})`);
      out.push(`        else: results.append({"op":"reparent_node","error":"node_or_parent_not_found"})`);
    } else if (op.op === 'set_property') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        if node_${p} != null:`);
      out.push(`            node_${p}.set(${gdQuote(op.property)}, ${gdValue(op.value)})`);
      out.push(`            results.append({"op":"set_property","property":${gdQuote(op.property)}})`);
      out.push(`        else:`);
      out.push(`            results.append({"op":"set_property","error":"node_not_found"})`);
    } else if (op.op === 'attach_script') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        if node_${p} != null:`);
      out.push(`            node_${p}.set_script(load(${gdQuote(op.script)}))`);
      out.push(`            results.append({"op":"attach_script"})`);
      out.push(`        else:`);
      out.push(`            results.append({"op":"attach_script","error":"node_not_found"})`);
    } else if (op.op === 'duplicate_node') {
      out.push(`    if ${rootVar} != null:`);
      out.push(`        var node_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.path)})`);
      out.push(`        var parent_${p} = ${rootVar}.get_node_or_null(${gdQuote(op.parent ?? '.')})`);
      out.push(`        if node_${p} != null and parent_${p} != null:`);
      out.push(`            var copy_${p} = node_${p}.duplicate()`);
      out.push(`            copy_${p}.name = ${gdQuote(op.name ?? 'Copy')}`);
      out.push(`            parent_${p}.add_child(copy_${p})`);
      out.push(`            copy_${p}.owner = ${rootVar}`);
      out.push(`            results.append({"op":"duplicate_node","name":copy_${p}.name})`);
      out.push(`        else: results.append({"op":"duplicate_node","error":"node_or_parent_not_found"})`);
    }
  }

  const createOnly = createOps.length > 0;
  out.push(`    if ${rootVar} != null:`);
  out.push(`        var ${packedVar} = PackedScene.new()`);
  out.push(`        ${packedVar}.pack(${rootVar})`);
  out.push(`        var save_error_${index} = ResourceSaver.save(scene_path, ${packedVar})`);
  out.push(`        results.append({"scene": scene_path, "save_error": save_error_${index}})`);
  out.push(`        ${rootVar}.free()`);
  if (!createOnly) out.push(`    else: results.append({"scene": scene_path, "error":"scene_load_failed"})`);
  return out;
}

function makeScript(ops: SceneOp[], resultFile: string): string {
  const scenes = [...new Set(ops.map(o => o.scene))];
  const lines = ['extends SceneTree', '', 'func _init():', '    var results = []', '    var scene_path = ""'];
  scenes.forEach((scene, i) => lines.push(...blockForScene(scene, ops.filter(o => o.scene === scene), i)));
  lines.push('    var f = File.new()');
  lines.push(`    if f.open(${gdQuote(resultFile)}, File.WRITE) == OK: f.store_string(to_json({"ok": true, "operations": results}))`);
  lines.push('    quit()');
  return lines.join('\n') + '\n';
}

export function buildSceneTaskScript(ops: SceneOp[], resultFile: string): string { return makeScript(ops, resultFile); }

export async function sceneOperations(projectRoot: string, ops: SceneOp[], timeoutMs = 120000) {
  if (!Array.isArray(ops) || ops.length === 0) throw new Error('At least one scene operation is required.');
  if (ops.length > 100) throw new Error('A maximum of 100 scene operations is allowed per call.');
  const root = path.resolve(projectRoot);
  const major = await getGodotMajor();
  const relScript = `.gjm_tasks/scene-${randomUUID()}.gd`;
  const relResult = `.gjm_tasks/scene-result-${randomUUID()}.json`;
  await fs.mkdir(path.dirname(safeProjectPath(root, relScript)), { recursive: true });
  const script = makeScript(ops, `res://${relResult}`);
  await fs.writeFile(safeProjectPath(root, relScript), script, 'utf8');
  try {
    const args = major >= 4 ? ['--headless','--path',root,'--script',`res://${relScript}`] : ['--path',root,'--script',`res://${relScript}`];
    const run = await runGodot(args, root, timeoutMs);
    let result: unknown = null;
    try { result = JSON.parse(await fs.readFile(safeProjectPath(root, relResult), 'utf8')); } catch {}
    const failed = run.code !== 0 || /SCRIPT ERROR:|Parse Error:|Compile Error:|Failed loading resource:/.test(run.stderr);
    return { ok: !failed, code: failed ? 'GJM-E207' : 'GJM-OK', exitCode: run.code, stdout: run.stdout, stderr: run.stderr, result };
  } finally {
    await fs.rm(safeProjectPath(root, relScript), { force: true }).catch(() => {});
    await fs.rm(safeProjectPath(root, relResult), { force: true }).catch(() => {});
  }
}
