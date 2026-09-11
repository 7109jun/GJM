import fs from 'node:fs';
import path from 'node:path';
import type { CommandResult } from './types.js';
import { resolveGodot, runProcess } from './process.js';

let cachedMajor: number | undefined;

export async function godotVersion(): Promise<{ major: number; version: string }> {
  const result = await runProcess(resolveGodot(), ['--version'], { timeoutMs: 15000 });
  if (result.code !== 0) throw new Error(`Godot version check failed: ${result.stderr || result.stdout}`);
  const version = result.stdout.trim().split(/\s+/)[0];
  const major = Number.parseInt(version.split('.')[0], 10);
  if (!Number.isInteger(major)) throw new Error(`Unable to parse Godot version: ${version}`);
  cachedMajor = major;
  return { major, version };
}

export async function getGodotMajor(): Promise<number> {
  if (cachedMajor !== undefined) return cachedMajor;
  return (await godotVersion()).major;
}


export function runGodot(args: string[], cwd: string, timeoutMs: number): Promise<CommandResult> {
  const godot = resolveGodot();
  const display = process.env.DISPLAY;
  let displayReady = false;
  if (display && process.platform === 'linux') {
    const match = display.match(/^:(\d+)/);
    displayReady = !!match && fs.existsSync(`/tmp/.X11-unix/X${match[1]}`);
  } else if (display) {
    displayReady = true;
  }
  if (process.platform === 'linux' && process.env.GJM_XVFB !== '0' && !displayReady) {
    return runProcess('xvfb-run', ['-a', godot, ...args], { cwd, timeoutMs });
  }
  return runProcess(godot, args, { cwd, timeoutMs });
}

export async function validateGodotProject(projectRoot: string): Promise<CommandResult> {
  const major = await getGodotMajor();
  const args = major >= 4
    ? ['--headless', '--path', projectRoot, '--editor', '--quit']
    : ['--path', projectRoot, '--editor', '--quit'];
  return runGodot(args, projectRoot, 120000);
}

export async function runGodotProject(projectRoot: string, scene?: string, timeoutMs = 30000): Promise<CommandResult> {
  const args = ['--path', projectRoot];
  if (scene) {
    if ((await getGodotMajor()) >= 4) args.push('--scene', scene);
    else args.push(scene);
  }
  return runGodot(args, projectRoot, timeoutMs);
}

export function gjmErrorCode(result: CommandResult): string {
  if (result.timedOut || result.code === -2) return 'GJM-E302';
  if (result.code !== 0) return 'GJM-E201';
  return 'GJM-OK';
}

export function projectPath(root: string, value: string): string {
  return path.resolve(root, value);
}
