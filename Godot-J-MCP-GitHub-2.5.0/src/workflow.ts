import path from 'node:path';
import { applyMake } from './make.js';
import { validateMake, validateBehavior } from './validate.js';
import { loadJsonInput } from './input-json.js';
import { getGodotMajor, validateGodotProject } from './godot.js';
import { runBehavior } from './behavior-runner.js';
import { exportMp4, locateFrames, locateCheckpoints } from './record.js';
import { evaluateAssertions } from './assertions.js';
import { writeRunResult } from './results.js';
import { collectArtifacts, artifactLinks } from './artifacts.js';
import { GJM_CODES } from './errors.js';
import { nextAttempt, readSession, startSession, updateSession } from './session.js';
import { createSnapshot } from './snapshots.js';

export interface WorkflowInput {
  projectRoot: string;
  makeFile?: string;
  makeContent?: string;
  behaviorFile?: string;
  behaviorContent?: string;
  mp4?: string;
  maxAttempts?: number;
  sessionId?: string;
  snapshot?: boolean;
}

export async function runWorkflow(input: WorkflowInput) {
  const root = path.resolve(input.projectRoot);
  let session = await readSession(root);
  if (!session || session.status !== 'active') {
    session = await startSession(root, input.maxAttempts ?? 5);
  }
  if (input.sessionId && session.id !== input.sessionId) {
    throw new Error('Unknown or expired sessionId.');
  }
  session = await nextAttempt(root);
  const startedAt = new Date().toISOString();
  const startedMs = Date.now();
  const make = validateMake(await loadJsonInput(root, input.makeFile ?? 'godot.make.json', input.makeContent, 'godot.make.json'));
  const major = await getGodotMajor();
  const snapshot = input.snapshot !== false ? await createSnapshot(root, `attempt-${session.attempt}`) : undefined;
  const changes = await applyMake(root, make, false, major);
  const validation = await validateGodotProject(root);
  if (validation.code !== 0) {
    const result = {
      ok: false, phase: 'validate', code: validation.timedOut ? GJM_CODES.GODOT_TIMEOUT : GJM_CODES.GODOT_RUNTIME,
      session, snapshot, changes, exitCode: validation.code, stdout: validation.stdout, stderr: validation.stderr,
      startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs
    };
    await writeRunResult(root, result);
    await updateSession(root, { status: 'active', phase: 'validate-failed', lastCode: result.code });
    return result;
  }
  let behavior;
  try {
    behavior = validateBehavior(await loadJsonInput(root, input.behaviorFile ?? 'Behavior.json', input.behaviorContent, 'Behavior.json'));
  } catch {
    return { ok: true, phase: 'behavior-request', code: GJM_CODES.BEHAVIOR_REQUIRED, session, snapshot, changes,
      message: 'Godot project is valid. AI must provide Behavior.json before runtime execution.' };
  }
  const run = await runBehavior(root, behavior);
  const fps = behavior.capture?.fps ?? 30;
  const frames = await locateFrames(root);
  const checkpoints = await locateCheckpoints(root);
  const assertions = await evaluateAssertions(root, behavior, run, frames, checkpoints);
  if (run.code !== 0) {
    const result = { ok: false, phase: 'behavior', code: GJM_CODES.BEHAVIOR_RUNTIME, session, snapshot, changes,
      exitCode: run.code, stdout: run.stdout, stderr: run.stderr, assertions: assertions.results };
    await writeRunResult(root, result);
    await updateSession(root, { status: 'active', phase: 'behavior-failed', lastCode: result.code });
    return result;
  }
  if (!assertions.ok) {
    const result = { ok: false, phase: 'assert', code: GJM_CODES.ASSERTION_FAILED, session, snapshot, changes,
      frames: frames.length, checkpoints: checkpoints.map(p => path.relative(root, p)), assertions: assertions.results };
    await writeRunResult(root, result);
    await updateSession(root, { status: 'active', phase: 'assert-failed', lastCode: result.code });
    return result;
  }
  const video = await exportMp4(root, input.mp4 ?? behavior.capture?.outputName ?? 'gjm-result.mp4', fps);
  const artifacts = await collectArtifacts(root);
  const result = { ok: video.ok, phase: video.ok ? 'complete' : 'export', code: video.ok ? GJM_CODES.OK : GJM_CODES.FFMPEG_FAILED,
    session, snapshot, changes, frames: frames.length, checkpoints: checkpoints.map(p => path.relative(root, p)), assertions: assertions.results,
    video, artifacts, artifactLinks: artifactLinks(root, artifacts), startedAt, finishedAt: new Date().toISOString(), elapsedMs: Date.now() - startedMs };
  await writeRunResult(root, result);
  const finalSession = await updateSession(root, { status: video.ok ? 'completed' : 'failed', phase: result.phase, lastCode: result.code });
  result.session = finalSession;
  await writeRunResult(root, result);
  return result;
}
