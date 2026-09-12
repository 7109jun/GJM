import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';

const LAST_RESULT = '.gjm_last_result.json';
const HISTORY_DIR = '.gjm_history';

export async function writeRunResult(projectRoot: string, result: unknown): Promise<void> {
  const payload = JSON.stringify(result, null, 2) + '\n';
  await fs.writeFile(safeProjectPath(projectRoot, LAST_RESULT), payload, 'utf8');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = safeProjectPath(projectRoot, path.join(HISTORY_DIR, stamp));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'result.json'), payload, 'utf8');
}

export async function readLastResult(projectRoot: string): Promise<unknown | null> {
  try {
    const text = await fs.readFile(safeProjectPath(projectRoot, LAST_RESULT), 'utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
