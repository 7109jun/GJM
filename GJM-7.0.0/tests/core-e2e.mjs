#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = path.resolve(new URL('..', import.meta.url).pathname);
const root = path.resolve(process.argv[2] ?? path.join(repo, '.gjm-test-project'));
const godot = process.env.GODOT_BIN || (process.platform === 'win32' ? 'godot.exe' : 'godot');
const core = path.join(repo, 'dist');

if (!process.env.GJM_SKIP_BUILD) {
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], { cwd: repo, stdio: 'inherit' });
  if (build.status !== 0) process.exit(build.status ?? 1);
}

await fs.rm(root, { recursive: true, force: true });
await fs.mkdir(root, { recursive: true });

const make = JSON.parse(await fs.readFile(path.join(repo, 'examples', 'godot.make.json'), 'utf8'));
const behavior = JSON.parse(await fs.readFile(path.join(repo, 'examples', 'Behavior.json'), 'utf8'));

const { validateMake, validateBehavior } = await import(path.join(core, 'src', 'validate.js'));
const { applyMake } = await import(path.join(core, 'src', 'make.js'));
const { getGodotMajor, validateGodotProject } = await import(path.join(core, 'src', 'godot.js'));
const { runBehavior } = await import(path.join(core, 'src', 'behavior-runner.js'));
const { locateFrames, locateCheckpoints, exportMp4 } = await import(path.join(core, 'src', 'record.js'));
const { evaluateAssertions } = await import(path.join(core, 'src', 'assertions.js'));

validateMake(make);
validateBehavior(behavior);

process.env.GODOT_BIN = godot;
const major = await getGodotMajor();
const changes = await applyMake(root, make, false, major);
const validation = await validateGodotProject(root);
if (validation.code !== 0) {
  console.error(validation.stderr || validation.stdout);
  process.exit(2);
}

const runtime = await runBehavior(root, behavior);
if (runtime.code !== 0) {
  console.error(runtime.stderr || runtime.stdout);
  process.exit(3);
}

const frames = await locateFrames(root);
const checkpoints = await locateCheckpoints(root);
const assertionResult = await evaluateAssertions(root, behavior, runtime, frames, checkpoints);
if (!assertionResult.ok) {
  console.error(JSON.stringify(assertionResult, null, 2));
  process.exit(4);
}

const video = await exportMp4(root, behavior.capture?.outputName ?? 'gjm-result.mp4', behavior.capture?.fps ?? 30);
if (!video.ok) {
  console.error(video.stderr || video.message);
  process.exit(5);
}

const stat = await fs.stat(path.join(root, video.output));
console.log(JSON.stringify({
  ok: true,
  godotMajor: major,
  changeCount: changes.length,
  validationExit: validation.code,
  behaviorExit: runtime.code,
  frameCount: frames.length,
  checkpointCount: checkpoints.length,
  assertionsPassed: assertionResult.results.filter(r => r.ok).length,
  assertionCount: assertionResult.results.length,
  mp4: video.output,
  mp4Bytes: stat.size
}, null, 2));
