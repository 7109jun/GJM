import { access } from 'node:fs/promises';
import { resolveFfmpeg, resolveGodot, runProcess } from './process.js';

export async function checkExecutable(command: string, versionArg = '--version'): Promise<{ ok: boolean; version?: string; error?: string }> {
  try {
    const r = await runProcess(command, [versionArg], { timeoutMs: 15000 });
    if (r.code !== 0) return { ok: false, error: r.stderr || r.stdout || `exit ${r.code}` };
    return { ok: true, version: (r.stdout || '').trim().split(/\r?\n/)[0] };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function inspectEnvironment() {
  const [godot, ffmpeg] = await Promise.all([
    checkExecutable(resolveGodot()),
    checkExecutable(resolveFfmpeg(), '-version')
  ]);
  let xvfb = false;
  if (process.platform === 'linux') {
    try { await access('/usr/bin/xvfb-run'); xvfb = true; } catch {}
  }
  return { platform: process.platform, node: process.version, godot, ffmpeg, xvfb };
}
