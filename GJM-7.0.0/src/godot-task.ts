import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { safeProjectPath, writeText } from './fs-safe.js';
import { getGodotMajor, runGodot } from './godot.js';

export interface GodotScriptTaskInput {
  projectRoot: string;
  script: string;
  timeoutMs?: number;
  args?: string[];
  resultFile?: string;
}

function gdQuote(s: string): string { return JSON.stringify(s); }

function dedent(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  while (lines.length && lines[0].trim() === '') lines.shift();
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
  const indents = lines.filter(l => l.trim()).map(l => (l.match(/^\s*/) ?? [''])[0].length);
  const minIndent = indents.length ? Math.min(...indents) : 0;
  return lines.map(l => l.slice(Math.min(minIndent, l.length))).join('\n');
}

function wrapTaskScript(body: string, resultFile: string, major: number, args: string[]): string {
  body = dedent(body);
  const argv = args.map(gdQuote).join(', ');
  if (major >= 4) {
    return `extends SceneTree\n\nfunc _init():\n    var task_args = [${argv}]\n    var result = null\n${body.split('\n').map(l => `    ${l}`).join('\n')}\n    if result != null:\n        var gjm_out = FileAccess.open(${gdQuote(resultFile)}, FileAccess.WRITE)\n        if gjm_out:\n            gjm_out.store_string(JSON.stringify(result))\n            gjm_out.close()\n    quit()\n`;
  }
  return `extends SceneTree\n\nfunc _init():\n    var task_args = [${argv}]\n    var result = null\n${body.split('\n').map(l => `    ${l}`).join('\n')}\n    if result != null:\n        var gjm_out = File.new()\n        if gjm_out.open(${gdQuote(resultFile)}, File.WRITE) == OK:\n            gjm_out.store_string(to_json(result))\n            gjm_out.close()\n    quit()\n`;
}

export async function runGodotScriptTask(input: GodotScriptTaskInput) {
  const root = path.resolve(input.projectRoot);
  const major = await getGodotMajor();
  const relScript = '.gjm_tasks/task-' + randomUUID() + '.gd';
  const relResult = input.resultFile ?? '.gjm_tasks/result-' + randomUUID() + '.json';
  const scriptPath = safeProjectPath(root, relScript);
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await writeText(root, relScript, wrapTaskScript(input.script, `res://${relResult}`, major, input.args ?? []));
  try {
    const args = major >= 4
      ? ['--headless', '--path', root, '--script', `res://${relScript}`, '--']
      : ['--path', root, '--script', `res://${relScript}`, '--'];
    args.push(...(input.args ?? []));
    const run = await runGodot(args, root, input.timeoutMs ?? 120000);
    let result: unknown = null;
    try { result = JSON.parse(await fs.readFile(safeProjectPath(root, relResult), 'utf8')); } catch {}
    return { ok: run.code === 0, code: run.code === 0 ? 'GJM-OK' : 'GJM-E206', exitCode: run.code, stdout: run.stdout, stderr: run.stderr, result, script: relScript, resultFile: relResult };
  } finally {
    await fs.rm(safeProjectPath(root, relScript), { force: true }).catch(() => {});
  }
}
