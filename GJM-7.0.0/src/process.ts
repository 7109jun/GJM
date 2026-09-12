import { spawn } from 'node:child_process';
import type { CommandResult } from './types.js';

export function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      detached: process.platform !== 'win32'
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;

    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => finish({ code: code ?? -1, signal: signal ?? undefined, stdout, stderr }));

    if (options.timeoutMs && options.timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM');
          else child.kill();
        } catch {
          try { child.kill(); } catch { /* already exited */ }
        }
        finish({ code: -2, stdout, stderr, timedOut: true, signal: 'SIGTERM' });
      }, options.timeoutMs);
    }
  });
}

export function resolveGodot(): string {
  return process.env.GODOT_BIN || (process.platform === 'win32' ? 'godot.exe' : 'godot');
}

export function resolveFfmpeg(): string {
  return process.env.FFMPEG_BIN || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}
