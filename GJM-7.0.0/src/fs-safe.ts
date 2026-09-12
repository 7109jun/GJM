import fs from 'node:fs/promises';
import path from 'node:path';

export function normalizeProjectRoot(input: string): string {
  const root = path.resolve(input);
  return root;
}

export async function assertGodotProject(root: string): Promise<void> {
  const projectFile = path.join(root, 'project.godot');
  const stat = await fs.stat(projectFile).catch(() => null);
  if (!stat?.isFile()) {
    throw new Error(`Not a Godot project: ${projectFile} was not found.`);
  }
}

export function safeProjectPath(root: string, relative: string): string {
  if (!relative || path.isAbsolute(relative)) {
    throw new Error('Path must be a non-empty relative project path.');
  }
  const resolved = path.resolve(root, relative);
  const rel = path.relative(root, resolved);
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes project root: ${relative}`);
  }
  return resolved;
}

export async function ensureParent(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function writeText(root: string, relative: string, content: string): Promise<void> {
  const filePath = safeProjectPath(root, relative);
  await ensureParent(filePath);
  await fs.writeFile(filePath, content, 'utf8');
}
