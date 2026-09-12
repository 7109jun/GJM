import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { safeProjectPath, normalizeProjectRoot } from './fs-safe.js';
import { runGodot } from './godot.js';
const execFileAsync = promisify(execFile);
const EXCLUDED_DIRS = new Set(['.git', '.godot', '.gjm_snapshots', '.gjm_frames', '.gjm_history', '.gjm_tasks']);
async function walk(root, dir, out) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
        if (EXCLUDED_DIRS.has(e.name))
            continue;
        const abs = path.join(dir, e.name);
        if (e.isDirectory())
            await walk(root, abs, out);
        else if (e.isFile())
            out.push(path.relative(root, abs).replaceAll(path.sep, '/'));
    }
}
async function sha256File(file) {
    const hash = crypto.createHash('sha256');
    hash.update(await fs.readFile(file));
    return hash.digest('hex');
}
export async function getReleaseManifest(projectRoot) {
    const root = normalizeProjectRoot(projectRoot);
    const files = [];
    await walk(root, root, files);
    files.sort();
    const entries = [];
    for (const rel of files) {
        const abs = safeProjectPath(root, rel);
        const st = await fs.stat(abs);
        entries.push({ path: rel, size: st.size, sha256: await sha256File(abs) });
    }
    return { root, fileCount: entries.length, files: entries };
}
export async function createReleasePackage(projectRoot, requestedOutput) {
    const root = normalizeProjectRoot(projectRoot);
    const outputRel = requestedOutput ?? `build/gjm-release-${Date.now()}.zip`;
    if (!outputRel.endsWith('.zip'))
        throw new Error('Release output must end with .zip');
    const output = safeProjectPath(root, outputRel);
    await fs.mkdir(path.dirname(output), { recursive: true });
    const staging = `${output}.staging`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    const files = [];
    await walk(root, root, files);
    for (const rel of files) {
        const src = safeProjectPath(root, rel);
        const dst = path.join(staging, rel);
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
    }
    const manifest = await getReleaseManifest(staging);
    await fs.writeFile(path.join(staging, 'GJM-RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2));
    await fs.rm(output, { force: true });
    await execFileAsync('zip', ['-qr', output, '.'], { cwd: staging, maxBuffer: 10 * 1024 * 1024 });
    await fs.rm(staging, { recursive: true, force: true });
    const st = await fs.stat(output);
    return { ok: true, output: outputRel, bytes: st.size, sha256: await sha256File(output), fileCount: files.length };
}
export async function exportMatrix(projectRoot, presets, mode, timeoutMs) {
    const root = normalizeProjectRoot(projectRoot);
    if (presets.length === 0)
        throw new Error('presets must contain at least one Godot export preset name.');
    const results = [];
    for (const preset of presets) {
        const safeName = preset.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const ext = /web/i.test(preset) ? '.zip' : /windows/i.test(preset) ? '.exe' : /linux/i.test(preset) ? '.x86_64' : '.build';
        const outputRel = `build/releases/${safeName}${ext}`;
        const output = safeProjectPath(root, outputRel);
        await fs.mkdir(path.dirname(output), { recursive: true });
        const args = ['--path', root, '--headless', mode === 'debug' ? '--export-debug' : '--export-release', preset, output];
        const result = await runGodot(args, root, timeoutMs);
        results.push({ preset, output: outputRel, code: result.code, stdout: result.stdout, stderr: result.stderr, timedOut: result.timedOut });
    }
    return { ok: results.every(r => r.code === 0), results };
}
//# sourceMappingURL=release.js.map