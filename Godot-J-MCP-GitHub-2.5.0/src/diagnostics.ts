import fs from 'node:fs/promises';
import path from 'node:path';
import { readLastResult } from './results.js';
import { safeProjectPath } from './fs-safe.js';

type Diagnostic = {
  kind: 'error' | 'warning' | 'info';
  source?: string;
  line?: number;
  message: string;
};

type Snippet = {
  file: string;
  startLine: number;
  endLine: number;
  content: string;
};

function collectText(result: unknown): string {
  const r = result as Record<string, unknown>;
  const parts = [r.message, r.stdout, r.stderr];
  return parts.filter((v): v is string => typeof v === 'string').join('\n');
}

function parseDiagnostics(text: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const location = trimmed.match(/res:\/\/([^:\s]+):(\d+)/i);
    const gjm = trimmed.match(/(GJM-[EW]\d{3})[^:]*:?\s*(.*)$/i);
    let message = trimmed;
    let source: string | undefined;
    let lineNo: number | undefined;
    if (location) {
      source = `res://${location[1]}`;
      lineNo = Number(location[2]);
    }
    const key = `${source ?? ''}:${lineNo ?? ''}:${message}`;
    if (seen.has(key)) continue;
    if (gjm || /error|failed|parse error|script error/i.test(trimmed)) {
      out.push({ kind: /warning/i.test(trimmed) ? 'warning' : 'error', source, line: lineNo, message });
      seen.add(key);
    }
    if (out.length >= 20) break;
  }
  return out;
}

async function snippet(projectRoot: string, source: string, lineNo: number, maxLines: number): Promise<Snippet | undefined> {
  const relative = source.replace(/^res:\/\//, '');
  const file = safeProjectPath(projectRoot, relative);
  try {
    const content = await fs.readFile(file, 'utf8');
    const lines = content.split(/\r?\n/);
    const index = Math.max(0, Math.min(lines.length - 1, lineNo - 1));
    const radius = Math.floor(maxLines / 2);
    const start = Math.max(0, index - radius);
    const end = Math.min(lines.length, start + maxLines);
    return { file: relative, startLine: start + 1, endLine: end, content: lines.slice(start, end).map((v, i) => `${start + i + 1}: ${v}`).join('\n') };
  } catch {
    return undefined;
  }
}

export async function diagnoseLastResult(projectRoot: string, maxSnippetLines = 12): Promise<Record<string, unknown>> {
  const result = await readLastResult(projectRoot);
  const diagnostics = parseDiagnostics(collectText(result));
  const snippets: Snippet[] = [];
  for (const d of diagnostics) {
    if (d.source && d.line) {
      const s = await snippet(projectRoot, d.source, d.line, maxSnippetLines);
      if (s) snippets.push(s);
    }
  }
  const r = result as Record<string, unknown>;
  const ok = r.ok === true;
  const next = ok
    ? { action: 'none', message: 'Latest GJM run is successful.' }
    : r.phase === 'validate'
      ? { action: 'fix_make', message: 'Fix godot.make.json or generated Godot files, then rerun gjm_pipeline.' }
      : r.phase === 'behavior-request'
        ? { action: 'provide_behavior', message: 'Provide Behavior.json or behaviorContent, then rerun gjm_pipeline.' }
        : r.phase === 'assert'
          ? { action: 'fix_behavior_or_game', message: 'Adjust Behavior.json or the game implementation to satisfy the failed assertions.' }
          : r.phase === 'export'
            ? { action: 'fix_ffmpeg', message: 'Check FFmpeg availability and captured frames, then rerun MP4 export.' }
            : { action: 'inspect_diagnostics', message: 'Inspect the diagnostics and rerun the pipeline after applying a fix.' };

  return {
    ok,
    code: r.code,
    phase: r.phase,
    diagnostics,
    snippets,
    next,
    resultPath: path.posix.join('.gjm_last_result.json')
  };
}
