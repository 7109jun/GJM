import fs from 'node:fs/promises';
import path from 'node:path';
import { normalizeProjectRoot, safeProjectPath } from './fs-safe.js';
import { godotVersion } from './godot.js';
import { inspectEnvironment } from './environment.js';
import { readLastResult } from './results.js';
import { readSession } from './session.js';
import { listSnapshots } from './snapshots.js';
import { collectArtifacts } from './artifacts.js';
import { workspaceAction } from './omni.js';
import { readRuntime } from './runtime.js';

export async function collectContext(projectRoot: string, options: { includeFiles?: boolean; includeContent?: boolean; maxFiles?: number } = {}) {
  const root = normalizeProjectRoot(projectRoot);
  const includeFiles = options.includeFiles !== false;
  const includeContent = options.includeContent === true;
  const maxFiles = Math.max(1, Math.min(5000, Math.trunc(options.maxFiles ?? 300)));

  const [godot, environment, result, session, snapshots, artifacts, runtime] = await Promise.all([
    godotVersion().catch(() => null),
    inspectEnvironment().catch(() => null),
    readLastResult(root).catch(() => null),
    readSession(root).catch(() => null),
    listSnapshots(root).catch(() => []),
    collectArtifacts(root).catch(() => []),
    readRuntime(root).catch(() => null)
  ]);

  let files: unknown[] = [];
  if (includeFiles) {
    const listed = await workspaceAction(root, 'list', { path: '.', recursive: true }) as unknown[];
    files = listed.slice(0, maxFiles).map((item: any) => {
      if (!includeContent || item.type !== 'file') return item;
      try {
        const abs = safeProjectPath(root, item.path);
        const bytes = Number(item.size ?? 0);
        if (bytes > 200_000) return { ...item, contentOmitted: 'file_too_large' };
        return { ...item, content: requireRead(abs) };
      } catch { return { ...item, contentOmitted: 'unreadable' }; }
    });
  }

  let project: { exists: boolean; mainScene?: string | null; bytes?: number } | null = null;
  try {
    const raw = await fs.readFile(safeProjectPath(root, 'project.godot'), 'utf8');
    const mainScene = raw.match(/run\/main_scene[^\n]*=\s*"([^"]+)"/)?.[1] ?? null;
    project = { exists: true, mainScene, bytes: Buffer.byteLength(raw, 'utf8') };
  } catch { project = { exists: false }; }

  return {
    ok: true,
    projectRoot: root,
    project,
    engine: godot,
    environment,
    session,
    runtime,
    lastResult: result,
    snapshots,
    artifacts,
    files,
    generatedAt: new Date().toISOString()
  };
}

function requireRead(_path: string): string {
  // Content is intentionally omitted from synchronous listing. Callers that need file bodies
  // should use gjm_workspace(read). This helper exists to keep context collection bounded.
  return '[use gjm_workspace/read for file content]';
}
