import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeProjectRoot, safeProjectPath } from './fs-safe.js';
import { workspaceAction } from './omni.js';

export interface ProjectIndexOptions {
  maxFiles?: number;
  includeSource?: boolean;
  maxSourceBytes?: number;
}

function rel(root: string, value: string): string {
  return path.relative(root, value).replaceAll(path.sep, '/');
}

function unique<T>(items: T[]): T[] { return [...new Set(items)]; }

async function readText(root: string, file: string, maxBytes: number): Promise<string | undefined> {
  try {
    const p = safeProjectPath(root, file);
    const stat = await fs.stat(p);
    if (!stat.isFile() || stat.size > maxBytes) return undefined;
    return await fs.readFile(p, 'utf8');
  } catch {
    return undefined;
  }
}

function extractScripts(text: string): string[] {
  return unique([...text.matchAll(/res:\/\/([^"\]\s]+\.gd)/g)].map(m => m[1]));
}

function extractExtResources(text: string): string[] {
  return unique([...text.matchAll(/path="res:\/\/([^"\]\s]+)"/g)].map(m => m[1]));
}

function extractNodes(text: string): Array<{ name: string; type: string; parent?: string }> {
  const out: Array<{ name: string; type: string; parent?: string }> = [];
  const re = /^\[node name="([^"]+)" type="([^"]+)"(?: parent="([^"]+)")?/gm;
  for (const m of text.matchAll(re)) out.push({ name: m[1], type: m[2], ...(m[3] ? { parent: m[3] } : {}) });
  return out;
}

function extractFunctions(text: string): string[] {
  return [...text.matchAll(/^\s*func\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(/gm)].map(m => m[1]);
}

function extractClasses(text: string): string[] {
  return [...text.matchAll(/^\s*class_name\s+([A-Za-z_][A-Za-z0-9_]*)/gm)].map(m => m[1]);
}

export async function buildProjectIndex(projectRoot: string, options: ProjectIndexOptions = {}) {
  const root = normalizeProjectRoot(projectRoot);
  const maxFiles = Math.max(1, Math.min(10000, Math.trunc(options.maxFiles ?? 2000)));
  const includeSource = options.includeSource === true;
  const maxSourceBytes = Math.max(1024, Math.min(2_000_000, Math.trunc(options.maxSourceBytes ?? 200_000)));
  const listed = await workspaceAction(root, 'list', { path: '.', recursive: true }) as Array<{ path?: string; type?: string; size?: number }>;
  const files = listed.filter(x => x.type === 'file' && typeof x.path === 'string').slice(0, maxFiles);
  const scenes: any[] = [];
  const scripts: any[] = [];
  const resources: string[] = [];
  const shaders: string[] = [];

  for (const item of files) {
    const file = String(item.path);
    if (file.endsWith('.tscn')) {
      const body = await readText(root, file, maxSourceBytes);
      if (body !== undefined) {
        scenes.push({ path: file, nodes: extractNodes(body), scripts: extractScripts(body), resources: extractExtResources(body) });
        resources.push(...extractExtResources(body));
      }
    } else if (file.endsWith('.gd')) {
      const body = await readText(root, file, maxSourceBytes);
      if (body !== undefined) scripts.push({ path: file, classes: extractClasses(body), functions: extractFunctions(body), ...(includeSource ? { source: body } : {}) });
    } else if (file.endsWith('.shader')) shaders.push(file);
  }

  return {
    ok: true,
    projectRoot: root,
    files: files.map(x => ({ path: String(x.path), type: x.type, size: x.size })),
    counts: { files: files.length, scenes: scenes.length, scripts: scripts.length, shaders: shaders.length },
    scenes,
    scripts,
    resources: unique(resources),
    shaders: unique(shaders),
    generatedAt: new Date().toISOString()
  };
}
