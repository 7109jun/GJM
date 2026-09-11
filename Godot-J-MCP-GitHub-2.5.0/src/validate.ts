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
    if (type === 'file' || type === 'script') {
      str(a.path, `actions[${i}].path`);
      if (typeof a.content !== 'string') throw new Error(`actions[${i}].content must be a string.`);
      return;
    }
    if (type === 'project_setting') {
      str(a.section, `actions[${i}].section`); str(a.key, `actions[${i}].key`);
      if (a.value === undefined) throw new Error(`actions[${i}].value is required.`); return;
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
  const allowed = new Set(['wait','key_down','key_up','key_press','mouse_move','mouse_down','mouse_up','click','double_click','scroll','screenshot']);
  root.actions.forEach((raw, i) => {
    const a = obj(raw, `actions[${i}]`);
    if (typeof a.type !== 'string' || !allowed.has(a.type)) throw new Error(`Unsupported Behavior action at index ${i}.`);
    if (a.type === 'wait') { const v = num(a.ms, `actions[${i}].ms`); if (v < 0 || v > 300000) throw new Error(`actions[${i}].ms out of range.`); }
    if (['key_down','key_up','key_press'].includes(a.type)) str(a.key, `actions[${i}].key`);
    if (['mouse_move','mouse_down','mouse_up','click','double_click'].includes(a.type)) { num(a.x, `actions[${i}].x`); num(a.y, `actions[${i}].y`); }
    if (a.type === 'key_press' && a.durationMs !== undefined) { const v = num(a.durationMs, `actions[${i}].durationMs`); if (v < 0 || v > 300000) throw new Error(`actions[${i}].durationMs out of range.`); }
    if (a.type === 'scroll' && a.deltaX === undefined && a.deltaY === undefined) throw new Error(`actions[${i}] scroll needs deltaX or deltaY.`);
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
          str(a.path, `assertions[${i}].path`); str(a.value, `assertions[${i}].value`);
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
