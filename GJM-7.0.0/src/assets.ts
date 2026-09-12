import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';
import { runGodot, getGodotMajor } from './godot.js';

export type AssetKind = 'model' | 'texture' | 'audio' | 'font' | 'shader' | 'data' | 'other';
export interface AssetInfo { relativePath: string; size: number; extension: string; kind: AssetKind; }

const model = new Set(['.glb','.gltf','.obj','.dae','.fbx','.blend']);
const texture = new Set(['.png','.jpg','.jpeg','.webp','.svg','.bmp','.tga','.hdr','.exr']);
const audio = new Set(['.wav','.ogg','.mp3','.flac']);
const font = new Set(['.ttf','.otf','.woff','.woff2']);
const shader = new Set(['.gdshader','.shader']);
const data = new Set(['.json','.csv','.txt','.tres','.res']);

function kindOf(ext: string): AssetKind {
  const e = ext.toLowerCase();
  if (model.has(e)) return 'model';
  if (texture.has(e)) return 'texture';
  if (audio.has(e)) return 'audio';
  if (font.has(e)) return 'font';
  if (shader.has(e)) return 'shader';
  if (data.has(e)) return 'data';
  return 'other';
}

async function walk(root: string, dir: string, out: AssetInfo[]) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const st = await fs.stat(full);
      out.push({ relativePath: path.relative(root, full), size: st.size, extension: ext, kind: kindOf(ext) });
    }
  }
}

export async function listAssets(root: string): Promise<AssetInfo[]> {
  const out: AssetInfo[] = [];
  await walk(path.resolve(root), path.resolve(root), out);
  out.sort((a,b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

export async function importAssets(root: string, timeoutMs = 120000) {
  const major = await getGodotMajor();
  const args = major >= 4
    ? ['--headless', '--path', root, '--editor', '--quit']
    : ['--path', root, '--editor', '--quit'];
  return runGodot(args, root, timeoutMs);
}

export async function ensureAssetPath(root: string, relative: string) {
  const p = safeProjectPath(root, relative);
  await fs.mkdir(path.dirname(p), { recursive: true });
  return p;
}
