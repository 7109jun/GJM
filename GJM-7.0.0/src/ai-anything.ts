import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath, normalizeProjectRoot, writeText } from './fs-safe.js';
import { applyMake } from './make.js';
import { validateMake, validateBehavior } from './validate.js';
import { loadJsonInput } from './input-json.js';
import { getGodotMajor, validateGodotProject, runGodot, runGodotProject, godotVersion } from './godot.js';
import { runBehavior } from './behavior-runner.js';
import { exportMp4, locateFrames, locateCheckpoints } from './record.js';
import { evaluateAssertions } from './assertions.js';
import { collectArtifacts } from './artifacts.js';
import { diagnoseLastResult } from './diagnostics.js';
import { prepareFixContext, applyFix } from './fix.js';
import { createSnapshot, restoreSnapshot, listSnapshots, deleteSnapshot } from './snapshots.js';
import { startRuntime, runtimeCommand, stopRuntime, readRuntime } from './runtime.js';
import { workspaceAction, projectAction, gitAction } from './omni.js';
import { listAssets, importAssets } from './assets.js';
import { expandTemplates } from './templates.js';
import { writeRunResult, readLastResult } from './results.js';
import { runGodotScriptTask } from './godot-task.js';
import { startSession, readSession, nextAttempt, updateSession, stopSession } from './session.js';
import { createReleasePackage, exportMatrix, getReleaseManifest } from './release.js';
import { buildDependencyGraph } from './dependency-graph.js';
import type { GodotMake, BehaviorFile } from './types.js';
import { sceneOperations } from './scene-ops.js';
import { generateAnimation, generateModel, generateRig, createShader, importAudio, configureInput, scaffoldNetwork, autoplay, runStudioPlan } from './game-studio.js';
import { auditProject, generateTexture, editAnimation, profileCompare, shaderValidate, autoplayFuzz, inputAudit, releaseReadiness } from './power.js';

export type AnyStep = {
  op: string;
  args?: Record<string, unknown>;
  id?: string;
  continueOnError?: boolean;
  retries?: number;
  when?: Record<string, unknown>;
};

export type AnythingRequest = {
  projectRoot: string;
  steps: AnyStep[];
  snapshot?: boolean;
  stopOnError?: boolean;
  rollbackOnError?: boolean;
  maxParallel?: number;
};

async function scriptPatch(root: string, args: Record<string, unknown>) {
  const rel = String(args.path ?? '');
  if (!rel) throw new Error('script_patch requires path.');
  const p = safeProjectPath(root, rel);
  let content = await fs.readFile(p, 'utf8');
  const mode = String(args.mode ?? 'replace');
  if (mode === 'replace') {
    const from = String(args.from ?? '');
    const to = String(args.to ?? '');
    if (!from) throw new Error('script_patch replace requires from.');
    const count = Number(args.count ?? 0);
    if (count > 0) {
      let remaining = count;
      content = content.replaceAll(from, () => {
        if (remaining-- <= 0) return from;
        return to;
      });
    } else {
      content = content.replaceAll(from, to);
    }
  } else if (mode === 'append') {
    content += (content.endsWith('\n') ? '' : '\n') + String(args.content ?? '') + '\n';
  } else if (mode === 'prepend') {
    content = String(args.content ?? '') + '\n' + content;
  } else if (mode === 'insert_after') {
    const marker = String(args.marker ?? '');
    const insertion = String(args.content ?? '');
    const index = content.indexOf(marker);
    if (index < 0) throw new Error(`Marker not found: ${marker}`);
    const at = index + marker.length;
    content = content.slice(0, at) + '\n' + insertion + content.slice(at);
  } else if (mode === 'insert_before') {
    const marker = String(args.marker ?? '');
    const insertion = String(args.content ?? '');
    const index = content.indexOf(marker);
    if (index < 0) throw new Error(`Marker not found: ${marker}`);
    content = content.slice(0, index) + insertion + '\n' + content.slice(index);
  } else if (mode === 'line_replace') {
    const line = Number(args.line);
    if (!Number.isInteger(line) || line < 1) throw new Error('line_replace requires a positive 1-based line.');
    const lines = content.split(/\r?\n/);
    if (line > lines.length) throw new Error(`Line out of range: ${line}`);
    lines[line - 1] = String(args.content ?? '');
    content = lines.join('\n');
  } else if (mode === 'line_insert') {
    const line = Number(args.line);
    if (!Number.isInteger(line) || line < 1) throw new Error('line_insert requires a positive 1-based line.');
    const lines = content.split(/\r?\n/);
    lines.splice(Math.min(line - 1, lines.length), 0, String(args.content ?? ''));
    content = lines.join('\n');
  } else if (mode === 'line_delete') {
    const line = Number(args.line);
    if (!Number.isInteger(line) || line < 1) throw new Error('line_delete requires a positive 1-based line.');
    const lines = content.split(/\r?\n/);
    if (line > lines.length) throw new Error(`Line out of range: ${line}`);
    lines.splice(line - 1, 1);
    content = lines.join('\n');
  } else {
    throw new Error(`Unsupported script_patch mode: ${mode}`);
  }
  await writeText(root, rel, content);
  return { path: rel, mode, bytes: Buffer.byteLength(content, 'utf8') };
}

async function scenePatch(root: string, args: Record<string, unknown>) {
  const rel = String(args.path ?? '');
  if (!rel.endsWith('.tscn')) throw new Error('scene_patch path must end in .tscn');
  const content = await fs.readFile(safeProjectPath(root, rel), 'utf8');
  const mode = String(args.mode ?? 'replace');
  if (mode === 'raw_replace') {
    const from = String(args.from ?? '');
    const to = String(args.to ?? '');
    if (!from) throw new Error('raw_replace requires from.');
    const next = content.replaceAll(from, to);
    await writeText(root, rel, next);
    return { path: rel, replaced: content === next ? 0 : 1 };
  }
  if (mode === 'raw_append') {
    const next = content + (content.endsWith('\n') ? '' : '\n') + String(args.content ?? '') + '\n';
    await writeText(root, rel, next);
    return { path: rel, appended: true };
  }
  throw new Error(`Unsupported scene_patch mode: ${mode}`);
}

async function godotCli(root: string, args: Record<string, unknown>) {
  const mode = String(args.mode ?? 'validate');
  const timeoutMs = Number(args.timeoutMs ?? 60000);
  const allowed: string[] = [];
  if (mode === 'validate') allowed.push(...['--path', root, '--headless', '--editor', '--quit']);
  if (mode === 'run') allowed.push(...['--path', root]);
  if (mode === 'scene') allowed.push(...['--path', root, '--scene', String(args.scene ?? '')]);
  if (mode === 'check') allowed.push(...['--headless', '--path', root, '--check-only']);
  if (mode === 'export') {
    const preset = String(args.preset ?? '');
    const output = safeProjectPath(root, String(args.output ?? 'build/game'));
    allowed.push(...['--headless', '--path', root, String(args.debug ? '--export-debug' : '--export-release'), preset, output]);
  }
  if (allowed.length === 0) throw new Error(`Unsupported godot_cli mode: ${mode}`);
  return runGodot(allowed, root, timeoutMs);
}

function getPathValue(value: unknown, expression: string): unknown {
  if (!expression.startsWith('${') || !expression.endsWith('}')) return expression;
  const body = expression.slice(2, -1);
  const parts = body.split('.');
  let cur: any = value;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

function interpolateDeep<T>(value: T, context: Record<string, unknown>): T {
  if (typeof value === 'string') {
    const direct = getPathValue(context, value);
    return (direct !== undefined ? direct : value) as T;
  }
  if (Array.isArray(value)) return value.map(v => interpolateDeep(v, context)) as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = interpolateDeep(v, context);
    return out as T;
  }
  return value;
}

function testCondition(condition: Record<string, unknown> | undefined, context: Record<string, unknown>): boolean {
  if (!condition) return true;
  if (Array.isArray(condition.and)) return (condition.and as unknown[]).every(x => testCondition(x as Record<string, unknown>, context));
  if (Array.isArray(condition.or)) return (condition.or as unknown[]).some(x => testCondition(x as Record<string, unknown>, context));
  if (typeof condition.not === 'object' && condition.not) return !testCondition(condition.not as Record<string, unknown>, context);
  const value = condition.path ? getPathValue(context, String(condition.path)) : condition.value;
  if ('exists' in condition) return (value !== undefined) === Boolean(condition.exists);
  if ('equals' in condition) return value === interpolateDeep(condition.equals, context);
  if ('notEquals' in condition) return value !== interpolateDeep(condition.notEquals, context);
  if ('contains' in condition) return String(value ?? '').includes(String(interpolateDeep(condition.contains, context)));
  if ('truthy' in condition) return Boolean(value) === Boolean(condition.truthy);
  return true;
}

async function ensureProject(root: string, args: Record<string, unknown>) {
  try { await fs.access(safeProjectPath(root, 'project.godot')); return { created: false, path: 'project.godot' }; }
  catch { /* create below */ }
  const name = String(args.name ?? path.basename(root));
  const mainScene = typeof args.mainScene === 'string' ? String(args.mainScene) : '';
  const content = `[application]\nconfig/name=${JSON.stringify(name)}\n${mainScene ? `run/main_scene="${mainScene}"\n` : ''}\n[display]\nwindow/size/viewport_width=1280\nwindow/size/viewport_height=720\n`;
  await writeText(root, 'project.godot', content);
  return { created: true, path: 'project.godot' };
}

async function executeStep(root: string, step: AnyStep) {
  const a = step.args ?? {};
  switch (step.op) {
    case 'create_project': return ensureProject(root, a);
    case 'create_file': return workspaceAction(root, 'write', a);
    case 'read_file': return workspaceAction(root, 'read', a);
    case 'delete_file': return workspaceAction(root, 'delete', a);
    case 'create_directory': return workspaceAction(root, 'mkdir', a);
    case 'search_text': return workspaceAction(root, 'search', a);
    case 'create_script': return workspaceAction(root, 'write', { path: a.path, content: a.content ?? '' });
    case 'godot_script': return runGodotScriptTask({ projectRoot: root, script: String(a.script ?? ''), timeoutMs: Number(a.timeoutMs ?? 120000), args: Array.isArray(a.args) ? a.args.map(String) : [], resultFile: typeof a.resultFile === 'string' ? a.resultFile : undefined });
    case 'scene_operations': return sceneOperations(root, Array.isArray(a.operations) ? a.operations as any : [], Number(a.timeoutMs ?? 120000));
    case 'patch_script': return scriptPatch(root, a);
    case 'patch_scene': return scenePatch(root, a);
    case 'set_project_setting': {
      const make: GodotMake = { format: 'godot.make', version: 1, name: 'setting', actions: [{ type: 'project_setting', section: String(a.section), key: String(a.key), value: a.value }] } as GodotMake;
      const major = await getGodotMajor();
      return { changes: await applyMake(root, validateMake(make), false, major) };
    }
    case 'create_template': return executeStep(root, { op: 'template', args: { name: a.name, apply: true } });
    case 'run_game': return runGodotProject(root, typeof a.scene === 'string' ? a.scene : undefined, Number(a.timeoutMs ?? 30000));
    case 'test_game': return executeStep(root, { op: 'behavior', args: a });
    case 'record_video': return exportMp4(root, String(a.output ?? 'gjm-result.mp4'), Number(a.fps ?? 30));
    case 'inspect_runtime': return runtimeCommand(root, { op: 'runtime_info' });
    case 'runtime_tree': return runtimeCommand(root, { op: 'tree', path: String(a.path ?? '.') });
    case 'export_game': return projectAction(root, 'export', a);
    case 'workspace': return workspaceAction(root, String(a.op ?? 'list'), a);
    case 'project': return projectAction(root, String(a.op ?? 'info'), a);
    case 'git': return gitAction(root, Array.isArray(a.args) ? a.args.map(String) : ['status']);
    case 'godot': return godotCli(root, a);
    case 'make': {
      const make = validateMake(await loadJsonInput(root, String(a.file ?? 'godot.make.json'), typeof a.content === 'string' ? a.content : undefined, 'godot.make.json'));
      return { changes: await applyMake(root, make, Boolean(a.dryRun), await getGodotMajor()) };
    }
    case 'validate': return validateGodotProject(root);
    case 'behavior': {
      const behavior = validateBehavior(await loadJsonInput(root, String(a.file ?? 'Behavior.json'), typeof a.content === 'string' ? a.content : undefined, 'Behavior.json'));
      const run = await runBehavior(root, behavior);
      const frames = await locateFrames(root);
      const checkpoints = await locateCheckpoints(root);
      const assertions = await evaluateAssertions(root, behavior, run, frames, checkpoints);
      return { run, frames: frames.length, checkpoints: checkpoints.map(p => path.relative(root, p)), assertions: assertions.results, ok: run.code === 0 && assertions.ok };
    }
    case 'execute': return (await import('./workflow.js')).runWorkflow({ projectRoot: root, makeFile: typeof a.makeFile === 'string' ? a.makeFile : undefined, makeContent: typeof a.makeContent === 'string' ? a.makeContent : undefined, behaviorFile: typeof a.behaviorFile === 'string' ? a.behaviorFile : undefined, behaviorContent: typeof a.behaviorContent === 'string' ? a.behaviorContent : undefined, maxAttempts: Number(a.maxAttempts ?? 5), snapshot: a.snapshot !== false });
    case 'runtime_start': return startRuntime(root);
    case 'runtime': return runtimeCommand(root, a);
    case 'runtime_status': return readRuntime(root);
    case 'runtime_stop': return stopRuntime(root);
    case 'assets': return listAssets(root);
    case 'assets_import': return importAssets(root, Number(a.timeoutMs ?? 120000));
    case 'template': {
      const name = String(a.name ?? '');
      const major = await getGodotMajor();
      const actions = expandTemplates([name], major);
      const make: GodotMake = { format: 'godot.make', version: 1, name, actions } as GodotMake;
      if (a.apply === false) return { template: name, make };
      return { template: name, changes: await applyMake(root, validateMake(make), false, major) };
    }
    case 'snapshot_create': return createSnapshot(root, String(a.label ?? 'ai'));
    case 'snapshot_list': return listSnapshots(root);
    case 'snapshot_restore': return restoreSnapshot(root, String(a.id ?? ''));
    case 'snapshot_delete': return deleteSnapshot(root, String(a.id ?? ''));
    case 'diagnose': return diagnoseLastResult(root, Number(a.maxSnippetLines ?? 20));
    case 'prepare_fix': return prepareFixContext(root, Number(a.maxSnippetLines ?? 20));
    case 'apply_fix': return applyFix(root, String(a.makeContent ?? ''));
    case 'artifacts': return collectArtifacts(root);
    case 'read_result': return readLastResult(root);
    case 'doctor': return (await import('./doctor.js')).doctor();
    case 'environment': return (await import('./environment.js')).inspectEnvironment();
    case 'project_index': return (await import('./project-index.js')).buildProjectIndex(root, a as any);
    case 'transaction': return (await import('./transaction.js')).runTransaction({ projectRoot: root, steps: Array.isArray(a.steps) ? a.steps as AnyStep[] : [], keepSnapshot: a.keepSnapshot === true });
    case 'dependency_graph': return buildDependencyGraph(root, { maxFiles: Number(a.maxFiles ?? 2000) });
    case 'release': { const op = String(a.op ?? 'manifest'); if (op === 'manifest') return getReleaseManifest(root); if (op === 'package') return createReleasePackage(root, typeof a.output === 'string' ? a.output : undefined); return exportMatrix(root, Array.isArray(a.presets) ? a.presets.map(String) : [], String(a.mode ?? 'release'), Number(a.timeoutMs ?? 600000)); }
    case 'import_json': return (await import('./input-json.js')).importJsonContent(root, String(a.content ?? ''), (String(a.kind ?? 'make') === 'behavior' ? 'behavior' : 'make'));
    case 'script_patch': return scriptPatch(root, a);
    case 'scene_patch': return scenePatch(root, a);
    case 'record': {
      const outputName = String(a.output ?? 'gjm-result.mp4');
      const fps = Number(a.fps ?? 30);
      return exportMp4(root, outputName, fps);
    }
    case 'animation': return generateAnimation(root, a);
    case 'model': return generateModel(root, a);
    case 'rig': return generateRig(root, a);
    case 'shader': return createShader(root, a);
    case 'audio': return importAudio(root, a);
    case 'input': return configureInput(root, a);
    case 'network': return scaffoldNetwork(root, a);
    case 'autoplay': return autoplay(root, { behavior: typeof a.behavior === 'string' ? a.behavior : JSON.stringify(a.behavior ?? null), runs: Number(a.runs ?? 3), stopOnFailure: a.stopOnFailure !== false });
    case 'studio': return runStudioPlan(root, a);
    case 'session_start': return startSession(root, Number(a.maxAttempts ?? 5));
    case 'session_status': return readSession(root);
    case 'session_next': return nextAttempt(root);
    case 'session_update': return updateSession(root, a as Parameters<typeof updateSession>[1]);
    case 'session_stop': return stopSession(root);
    case 'audit': return auditProject(root, a);
    case 'texture': return generateTexture(root, a);
    case 'animation_edit': return editAnimation(root, a);
    case 'profile_compare': return profileCompare(root, a);
    case 'shader_validate': return shaderValidate(root, a);
    case 'autoplay_fuzz': return autoplayFuzz(root, a);
    case 'input_audit': return inputAudit(root, a);
    case 'release_readiness': return releaseReadiness(root);
    default: throw new Error(`Unknown GJM universal operation: ${step.op}`);
  }
}

export const GJM_OPERATIONS = [
  'create_project','create_file','read_file','delete_file','create_directory','search_text',
  'create_script','godot_script','scene_operations','patch_script','patch_scene','set_project_setting','create_template',
  'run_game','test_game','record_video','inspect_runtime','runtime_tree','export_game','workspace','project','git',
  'godot','make','validate','behavior','execute','runtime_start','runtime','runtime_status','runtime_stop',
  'assets','assets_import','template','snapshot_create','snapshot_list','snapshot_restore','snapshot_delete',
  'diagnose','prepare_fix','apply_fix','artifacts','read_result','doctor','environment','project_index','transaction',
  'import_json','script_patch','scene_patch','record','animation','animation_edit','model','rig','shader','shader_validate','audio','input','input_audit','network','autoplay','autoplay_fuzz','studio','texture','audit','profile_compare','release_readiness','dependency_graph','release','session_start','session_status','session_next','session_update','session_stop'
] as const;

export function validatePlan(steps: AnyStep[]) {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (let i=0;i<steps.length;i++) {
    const step=steps[i];
    const id=step.id ?? `step-${i+1}`;
    if (ids.has(id)) errors.push(`Duplicate step id: ${id}`);
    ids.add(id);
    if (!GJM_OPERATIONS.includes(step.op as any)) errors.push(`Unsupported operation: ${step.op}`);
  }
  return { ok: errors.length===0, errors, stepCount: steps.length, operations: steps.map(s=>s.op) };
}

export async function doAnything(input: AnythingRequest) {
  const root = normalizeProjectRoot(input.projectRoot);
  const steps = input.steps ?? [];
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('steps must contain at least one operation.');
  if (steps.length > 200) throw new Error('A maximum of 200 steps is allowed per call.');
  const plan = validatePlan(steps);
  if (!plan.ok) throw new Error(plan.errors.join('; '));
  const snapshot = input.snapshot !== false ? await createSnapshot(root, 'universal-auto') : undefined;
  const results: Array<Record<string, unknown>> = [];
  const context: Record<string, unknown> = { steps: {} };
  let failed = false;
  let rolledBack = false;
  for (let i = 0; i < steps.length; i++) {
    const original = steps[i];
    const id = original.id ?? `step-${i + 1}`;
    const step = { ...original, args: interpolateDeep(original.args ?? {}, context) } as AnyStep;
    if (!testCondition(original.when, context)) {
      const skipped = { index: i, id, op: step.op, ok: true, skipped: true, reason: 'condition=false' };
      results.push(skipped);
      (context.steps as Record<string, unknown>)[id] = skipped;
      continue;
    }
    const maxRetries = Math.max(0, Math.min(10, Number(step.retries ?? 0)));
    let lastError: unknown;
    let success = false;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await executeStep(root, step);
        const item = { index: i, id, op: step.op, ok: true, attempt: attempt + 1, result };
        results.push(item);
        (context.steps as Record<string, unknown>)[id] = item;
        success = true;
        break;
      } catch (error) {
        lastError = error;
        if (attempt < maxRetries) continue;
      }
    }
    if (!success) {
      const item = { index: i, id, op: step.op, ok: false, attempts: maxRetries + 1, error: lastError instanceof Error ? lastError.message : String(lastError) };
      results.push(item);
      (context.steps as Record<string, unknown>)[id] = item;
      failed = true;
      if (input.stopOnError !== false && step.continueOnError !== true) break;
    }
  }
  if (failed && input.rollbackOnError && snapshot) {
    await restoreSnapshot(root, snapshot.id);
    rolledBack = true;
  }
  return {
    ok: !failed,
    snapshot,
    rolledBack,
    completedSteps: results.filter(x => x.ok === true && !x.skipped).length,
    skippedSteps: results.filter(x => x.skipped === true).length,
    failedSteps: results.filter(x => x.ok === false).length,
    totalSteps: steps.length,
    results
  };
}
