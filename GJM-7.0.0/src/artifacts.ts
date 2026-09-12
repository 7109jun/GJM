import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';

export interface GjmArtifact {
  kind: 'result' | 'video' | 'frame' | 'checkpoint' | 'other';
  path: string;
  size: number;
  relativePath: string;
}

async function statSafe(file: string) {
  try { return await fs.stat(file); } catch { return null; }
}

export async function collectArtifacts(projectRoot: string): Promise<GjmArtifact[]> {
  const out: GjmArtifact[] = [];
  const root = path.resolve(projectRoot);
  const add = async (full: string, kind: GjmArtifact['kind']) => {
    const st = await statSafe(full);
    if (!st?.isFile()) return;
    out.push({ kind, path: full, size: st.size, relativePath: path.relative(root, full) });
  };

  await add(safeProjectPath(root, '.gjm_last_result.json'), 'result');
  const rootNames = await fs.readdir(root).catch(() => []);
  for (const name of rootNames) {
    if (/^.+\.mp4$/i.test(name)) await add(path.join(root, name), 'video');
  }

  const dir = safeProjectPath(root, '.gjm_frames');
  for (const name of await fs.readdir(dir).catch(() => [])) {
    if (/^frame_\d{6}\.png$/i.test(name)) await add(path.join(dir, name), 'frame');
    else if (/^checkpoint_\d{3}_.+\.png$/i.test(name)) await add(path.join(dir, name), 'checkpoint');
  }

  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export function artifactLinks(projectRoot: string, artifacts: GjmArtifact[]) {
  return artifacts.map(a => ({ kind: a.kind, relativePath: a.relativePath, fileUri: `file://${encodeURI(a.path)}` }));
}
