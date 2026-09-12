import type { BehaviorFile, GodotMake } from './types.js';

function obj(v: unknown, label: string): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${label} must be an object.`);
  return v as Record<string, unknown>;
}
function str(v: unknown, label: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`${label} must be a non-empty string.`);
  return v;
}
function num(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${label} must be a finite number.`);
  return v;
}

export function validateMake(value: unknown): GodotMake {
  const root = obj(value, 'godot.make.json');
  if (root.format !== 'godot.make') throw new Error('format must be "godot.make".');
  const version = num(root.version, 'version');
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer.');
  if (!Array.isArray(root.actions)) throw new Error('actions must be an array.');
  if (root.name !== undefined) str(root.name, 'name');
  if (root.description !== undefined) str(root.description, 'description');
  root.actions.forEach((raw, i) => {
    const a = obj(raw, `actions[${i}]`);
    const type = str(a.type, `actions[${i}].type`);
    if (type === 'directory') { str(a.path, `actions[${i}].path`); return; }
    if (type === 'file' || type === 'script' || type === 'shader' || type === 'resource') {
      str(a.path, `actions[${i}].path`);
      if (typeof a.content !== 'string') throw new Error(`actions[${i}].content must be a string.`);
      return;
    }
    if (type === 'asset_base64') {
      str(a.path, `actions[${i}].path`);
      if (typeof a.content !== 'string' || !a.content.trim()) throw new Error(`actions[${i}].content must be a non-empty base64 string.`);
      return;
    }
    if (type === 'copy') {
      str(a.from, `actions[${i}].from`);
      str(a.to, `actions[${i}].to`);
      return;
    }
    if (type === 'input_action') {
      str(a.name, `actions[${i}].name`);
      if (a.deadzone !== undefined) { const d = num(a.deadzone, `actions[${i}].deadzone`); if (d < 0 || d > 1) throw new Error(`actions[${i}].deadzone must be 0..1.`); }
      if (a.events !== undefined && !Array.isArray(a.events)) throw new Error(`actions[${i}].events must be an array.`);
      return;
    }
    if (type === 'template') {
      str(a.name, `actions[${i}].name`);
      const allowedTemplates = new Set(['platformer_2d','topdown_2d','third_person_3d','first_person_3d','ui_menu','save_system','audio_manager']);
      if (!allowedTemplates.has(String(a.name))) throw new Error(`Unsupported template: ${String(a.name)}`);
      if (a.options !== undefined) obj(a.options, `actions[${i}].options`);
      return;
    }
    if (type === 'autoload') {
      str(a.name, `actions[${i}].name`);
      str(a.path, `actions[${i}].path`);
      return;
    }
    if (type === 'project_setting') {
      str(a.section, `actions[${i}].section`); str(a.key, `actions[${i}].key`);
      if (a.value === undefined) throw new Error(`actions[${i}].value is required.`); return;
    }
    if (type === 'feature') {
      str(a.kind, `actions[${i}].kind`);
      const allowed = new Set(['2d_root','3d_root','hybrid_root','player_2d','player_3d','static_body_2d','rigid_body_2d','static_body_3d','rigid_body_3d','collision_shape_2d','collision_shape_3d','camera_2d','camera_3d','directional_light','omni_light','spot_light','world_environment','particles_2d','particles_3d','audio_player','audio_2d','audio_3d','animation_player','timer','http_request','navigation_2d','navigation_3d','sprite_2d','mesh_instance_3d','ui_label','ui_button','ui_panel','ui_root','line_2d','line_3d']);
      if (!allowed.has(String(a.kind))) throw new Error(`Unsupported feature kind: ${String(a.kind)}`);
      if (a.scene !== undefined) str(a.scene, `actions[${i}].scene`);
      if (a.name !== undefined) str(a.name, `actions[${i}].name`);
      if (a.parent !== undefined) str(a.parent, `actions[${i}].parent`);
      if (a.script !== undefined) str(a.script, `actions[${i}].script`);
      return;
    }
    if (type === 'godot_script') {
      str(a.script, `actions[${i}].script`);
      if (a.args !== undefined && !Array.isArray(a.args)) throw new Error(`actions[${i}].args must be an array.`);
      if (a.timeoutMs !== undefined) { const t = num(a.timeoutMs, `actions[${i}].timeoutMs`); if (t < 1 || t > 600000) throw new Error(`actions[${i}].timeoutMs out of range.`); }
      if (a.resultFile !== undefined) str(a.resultFile, `actions[${i}].resultFile`);
      return;
    }
    if (type === 'scene_raw') {
      str(a.path, `actions[${i}].path`);
      if (typeof a.content !== 'string') throw new Error(`actions[${i}].content must be a string.`);
      return;
    }
    if (type === 'scene') {
      str(a.path, `actions[${i}].path`);
      if (a.root !== undefined) {
        const r = obj(a.root, `actions[${i}].root`);
        if (r.name !== undefined) str(r.name, `actions[${i}].root.name`);
        if (r.type !== undefined) str(r.type, `actions[${i}].root.type`);
      }
      if (a.nodes !== undefined) {
        if (!Array.isArray(a.nodes)) throw new Error(`actions[${i}].nodes must be an array.`);
        for (let j = 0; j < a.nodes.length; j++) {
          const n = obj(a.nodes[j], `actions[${i}].nodes[${j}]`);
          str(n.name, `actions[${i}].nodes[${j}].name`); str(n.type, `actions[${i}].nodes[${j}].type`);
          if (n.parent !== undefined) str(n.parent, `actions[${i}].nodes[${j}].parent`);
        }
      }
      if (a.subresources !== undefined) {
        if (!Array.isArray(a.subresources)) throw new Error(`actions[${i}].subresources must be an array.`);
        for (let j = 0; j < a.subresources.length; j++) {
          const r = obj(a.subresources[j], `actions[${i}].subresources[${j}]`);
          str(r.id, `actions[${i}].subresources[${j}].id`);
          str(r.type, `actions[${i}].subresources[${j}].type`);
        }
      }
      if (a.connections !== undefined) {
        if (!Array.isArray(a.connections)) throw new Error(`actions[${i}].connections must be an array.`);
        for (let j = 0; j < a.connections.length; j++) {
          const c = obj(a.connections[j], `actions[${i}].connections[${j}]`);
          str(c.signal, `actions[${i}].connections[${j}].signal`);
          str(c.from, `actions[${i}].connections[${j}].from`);
          str(c.to, `actions[${i}].connections[${j}].to`);
          str(c.method, `actions[${i}].connections[${j}].method`);
        }
      }
      if (a.script !== undefined) str(a.script, `actions[${i}].script`);
      return;
    }
    throw new Error(`Unsupported make action: ${type}`);
  });
  return value as GodotMake;
}

export function validateBehavior(value: unknown): BehaviorFile {
  const root = obj(value, 'Behavior.json');
  if (root.format !== 'godot.behavior') throw new Error('format must be "godot.behavior".');
  const version = num(root.version, 'version');
  if (!Number.isInteger(version) || version < 1) throw new Error('version must be a positive integer.');
  if (!Array.isArray(root.actions)) throw new Error('actions must be an array.');
  if (root.name !== undefined) str(root.name, 'name');
  if (root.description !== undefined) str(root.description, 'description');
  const allowed = new Set(['wait','key_down','key_up','key_press','mouse_move','mouse_down','mouse_up','click','double_click','click_node','scroll','screenshot', 'inspect_node', 'runtime_command']);
  root.actions.forEach((raw, i) => {
    const a = obj(raw, `actions[${i}]`);
    if (typeof a.type !== 'string' || !allowed.has(a.type)) throw new Error(`Unsupported Behavior action at index ${i}.`);
    if (a.type === 'wait') { const v = num(a.ms, `actions[${i}].ms`); if (v < 0 || v > 300000) throw new Error(`actions[${i}].ms out of range.`); }
    if (['key_down','key_up','key_press'].includes(a.type)) str(a.key, `actions[${i}].key`);
    if (['mouse_move','mouse_down','mouse_up','click','double_click'].includes(a.type)) { num(a.x, `actions[${i}].x`); num(a.y, `actions[${i}].y`); }
    if (a.type === 'click_node') str(a.path, `actions[${i}].path`);
    if (a.type === 'key_press' && a.durationMs !== undefined) { const v = num(a.durationMs, `actions[${i}].durationMs`); if (v < 0 || v > 300000) throw new Error(`actions[${i}].durationMs out of range.`); }
    if (a.type === 'scroll' && a.deltaX === undefined && a.deltaY === undefined) throw new Error(`actions[${i}] scroll needs deltaX or deltaY.`);
    if (a.type === 'inspect_node') str(a.path, `actions[${i}].path`);
    if (a.type === 'runtime_command') str(a.op, `actions[${i}].op`);
  });
  if (root.assertions !== undefined) {
    if (!Array.isArray(root.assertions)) throw new Error('assertions must be an array.');
    root.assertions.forEach((raw, i) => {
      const a = obj(raw, `assertions[${i}]`);
      if (typeof a.type !== 'string') throw new Error(`assertions[${i}].type must be a string.`);
      switch (a.type) {
        case 'frames_min': { const v = num(a.value, `assertions[${i}].value`); if (v < 0 || !Number.isInteger(v)) throw new Error(`assertions[${i}].value must be a non-negative integer.`); break; }
        case 'checkpoint':
          str(a.name, `assertions[${i}].name`);
          break;
        case 'stdout_contains':
        case 'stderr_not_contains':
          str(a.value, `assertions[${i}].value`);
          break;
        case 'file_exists':
          str(a.path, `assertions[${i}].path`);
          break;
        case 'file_contains':
          str(a.path, `assertions[${i}].path`);
          str(a.value, `assertions[${i}].value`);
          break;
        case 'stdout_regex':
          str(a.pattern, `assertions[${i}].pattern`);
          break;
        case 'exit_code':
          if (!Number.isInteger(a.value)) throw new Error(`assertions[${i}].value must be an integer.`);
          break;
        case 'node_exists':
          str(a.path, `assertions[${i}].path`);
          break;
        case 'node_property':
          str(a.path, `assertions[${i}].path`);
          str(a.property, `assertions[${i}].property`);
          if (!(Object.prototype.hasOwnProperty.call(a, 'equals'))) throw new Error(`assertions[${i}].equals is required.`);
          break;
        default:
          throw new Error(`Unsupported assertion type: ${String(a.type)}`);
      }
    });
  }
  if (root.capture !== undefined) {
    const c = obj(root.capture, 'capture');
    if (c.fps !== undefined) { const v = num(c.fps, 'capture.fps'); if (v < 1 || v > 120) throw new Error('capture.fps must be 1..120.'); }
    for (const k of ['width','height']) if (c[k] !== undefined) { const v = num(c[k], `capture.${k}`); if (v < 1 || v > 7680) throw new Error(`capture.${k} out of range.`); }
    if (c.outputName !== undefined) str(c.outputName, 'capture.outputName');
  }
  return value as BehaviorFile;
}
