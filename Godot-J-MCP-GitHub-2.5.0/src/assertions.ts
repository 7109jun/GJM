import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';
import type { BehaviorFile, CommandResult } from './types.js';

export interface AssertionResult {
  index: number;
  type: string;
  ok: boolean;
  message: string;
  expected?: unknown;
  actual?: unknown;
}

async function exists(root: string, relative: string): Promise<boolean> {
  try { await fs.access(safeProjectPath(root, relative)); return true; }
  catch { return false; }
}

export async function evaluateAssertions(
  projectRoot: string,
  behavior: BehaviorFile,
  command: CommandResult,
  frames: string[],
  checkpoints: string[]
): Promise<{ ok: boolean; results: AssertionResult[] }> {
  const assertions = behavior.assertions ?? [];
  const results: AssertionResult[] = [];

  for (let i = 0; i < assertions.length; i++) {
    const a = assertions[i];
    switch (a.type) {
      case 'frames_min': {
        const ok = frames.length >= a.value;
        results.push({ index: i, type: a.type, ok, message: ok ? `Frame count ${frames.length} >= ${a.value}.` : `Frame count ${frames.length} < ${a.value}.`, expected: a.value, actual: frames.length });
        break;
      }
      case 'checkpoint': {
        const needle = `_` + a.name.replace(/[\\/\s]+/g, '_') + '.png';
        const ok = checkpoints.some(p => path.basename(p).endsWith(needle));
        results.push({ index: i, type: a.type, ok, message: ok ? `Checkpoint "${a.name}" exists.` : `Checkpoint "${a.name}" was not found.`, expected: a.name });
        break;
      }
      case 'stdout_contains': {
        const ok = command.stdout.includes(a.value);
        results.push({ index: i, type: a.type, ok, message: ok ? 'stdout contains expected text.' : 'stdout does not contain expected text.', expected: a.value });
        break;
      }
      case 'stderr_not_contains': {
        const ok = !command.stderr.includes(a.value);
        results.push({ index: i, type: a.type, ok, message: ok ? 'stderr does not contain forbidden text.' : 'stderr contains forbidden text.', expected: a.value });
        break;
      }
      case 'file_exists': {
        const ok = await exists(projectRoot, a.path);
        results.push({ index: i, type: a.type, ok, message: ok ? `File exists: ${a.path}` : `File not found: ${a.path}`, expected: a.path });
        break;
      }
      case 'file_contains': {
        let actual = '';
        try { actual = await fs.readFile(safeProjectPath(projectRoot, a.path), 'utf8'); } catch { /* handled as assertion failure */ }
        const ok = actual.includes(a.value);
        results.push({ index: i, type: a.type, ok, message: ok ? `File contains expected text: ${a.path}` : `File does not contain expected text: ${a.path}`, expected: a.value });
        break;
      }
    }
  }

  return { ok: results.every(r => r.ok), results };
}
