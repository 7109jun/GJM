import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeProjectPath, writeText } from './fs-safe.js';
import { runGodot, godotVersion } from './godot.js';
import type { JsonValue } from './types.js';

const execFileAsync = promisify(execFile);

async function statKind(p: string): Promise<'file'|'directory'|'other'|'missing'> {
  try {
    const s = await fs.stat(p);
    if (s.isFile()) return 'file';
    if (s.isDirectory()) return 'directory';
    return 'other';
  } catch { return 'missing'; }
}

async function workspaceList(root: string, relative = '.', recursive = false) {
  const base = relative === '.' ? root : safeProjectPath(root, relative);
  const out: Array<{ path: string; type: string; size?: number }> = [];
  async function visit(dir: string, rel: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === '.godot' || entry.name === '.gjm_snapshots') continue;
      const abs = path.join(dir, entry.name);
      const childRel = rel === '.' ? entry.name : path.join(rel, entry.name);
      if (entry.isDirectory()) {
        out.push({ path: childRel.replaceAll(path.sep, '/'), type: 'directory' });
        if (recursive) await visit(abs, childRel);
      } else if (entry.isFile()) {
        const st = await fs.stat(abs);
        out.push({ path: childRel.replaceAll(path.sep, '/'), type: 'file', size: st.size });
      }
    }
  }
  if ((await statKind(base)) !== 'directory') throw new Error(`Directory not found: ${relative}`);
  await visit(base, relative === '.' ? '.' : relative);
  return out;
}

async function workspaceSearch(root: string, query: string, relative = '.', maxResults = 100) {
  if (!query) throw new Error('query is required.');
  const files = await workspaceList(root, relative, true);
  const matches: Array<{ path: string; line: number; text: string }> = [];
  for (const entry of files) {
    if (entry.type !== 'file' || (entry.size ?? 0) > 2_000_000) continue;
    const ext = path.extname(entry.path).toLowerCase();
    const textExts = new Set(['.gd','.ts','.js','.json','.tscn','.cfg','.txt','.md','.tres','.shader','.cs','.gdshader']);
    if (!textExts.has(ext)) continue;
    let text = '';
    try { text = await fs.readFile(safeProjectPath(root, entry.path), 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(query.toLowerCase())) {
        matches.push({ path: entry.path, line: i + 1, text: lines[i].slice(0, 500) });
        if (matches.length >= maxResults) return matches;
      }
    }
  }
  return matches;
}

async function projectSettings(root: string) {
  const file = safeProjectPath(root, 'project.godot');
  const raw = await fs.readFile(file, 'utf8');
  const result: Record<string, Record<string, string>> = {};
  let section = '';
  for (const line of raw.split(/\r?\n/)) {
    const header = line.match(/^\[([^\]]+)\]$/);
    if (header) { section = header[1]; result[section] ??= {}; continue; }
    const m = line.match(/^([^;=#\s][^=]*)=(.*)$/);
    if (m && section) result[section][m[1].trim()] = m[2].trim();
  }
  return result;
}

async function git(root: string, args: string[]) {
  const allowed = new Set(['status','diff','log','branch','rev-parse','add','commit','restore','checkout']);
  if (!allowed.has(args[0])) throw new Error(`Unsupported git operation: ${args[0]}`);
  if (args.includes('-C')) throw new Error('Do not pass git -C. GJM supplies the project root.');
  const result = await execFileAsync('git', args, { cwd: root, maxBuffer: 10 * 1024 * 1024 });
  return { code: 0, stdout: result.stdout, stderr: result.stderr };
}

export async function workspaceAction(root: string, op: string, payload: Record<string, unknown>) {
  switch (op) {
    case 'list':
      return workspaceList(root, String(payload.path ?? '.'), Boolean(payload.recursive));
    case 'read': {
      const p = safeProjectPath(root, String(payload.path));
      return { path: String(payload.path), content: await fs.readFile(p, 'utf8') };
    }
    case 'write': {
      const rel = String(payload.path);
      const content = String(payload.content ?? '');
      await writeText(root, rel, content);
      return { path: rel, bytes: Buffer.byteLength(content, 'utf8') };
    }
    case 'mkdir': {
      const rel = String(payload.path);
      await fs.mkdir(safeProjectPath(root, rel), { recursive: true });
      return { path: rel };
    }
    case 'delete': {
      const rel = String(payload.path);
      await fs.rm(safeProjectPath(root, rel), { recursive: true, force: false });
      return { path: rel, deleted: true };
    }
    case 'copy': {
      const from = safeProjectPath(root, String(payload.from));
      const to = safeProjectPath(root, String(payload.to));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.cp(from, to, { recursive: true, force: true });
      return { from: String(payload.from), to: String(payload.to) };
    }
    case 'move': {
      const from = safeProjectPath(root, String(payload.from));
      const to = safeProjectPath(root, String(payload.to));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(from, to);
      return { from: String(payload.from), to: String(payload.to) };
    }
    case 'search':
      return workspaceSearch(root, String(payload.query ?? ''), String(payload.path ?? '.'), Number(payload.maxResults ?? 100));
    default: throw new Error(`Unknown workspace operation: ${op}`);
  }
}

export async function projectAction(root: string, op: string, payload: Record<string, unknown>) {
  switch (op) {
    case 'info':
      return { root, godot: await godotVersion(), settings: await projectSettings(root) };
    case 'settings':
      return projectSettings(root);
    case 'run':
      return runGodot(['--path', root], root, Number(payload.timeoutMs ?? 30000));
    case 'export': {
      const preset = String(payload.preset);
      const output = safeProjectPath(root, String(payload.output));
      const mode = String(payload.mode ?? 'release');
      const args = ['--headless', '--path', root, mode === 'debug' ? '--export-debug' : '--export-release', preset, output];
      return runGodot(args.slice(1), root, Number(payload.timeoutMs ?? 600000));
    }
    default: throw new Error(`Unknown project operation: ${op}`);
  }
}

export async function gitAction(root: string, args: string[]) { return git(root, args); }
