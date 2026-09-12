import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';
import { resolveFfmpeg, runProcess } from './process.js';
export async function clearFrames(projectRoot) {
    await fs.rm(safeProjectPath(projectRoot, '.gjm_frames'), { recursive: true, force: true });
}
export async function locateFrames(projectRoot) {
    const dir = safeProjectPath(projectRoot, '.gjm_frames');
    const names = await fs.readdir(dir).catch(() => []);
    return names
        .filter((name) => /^frame_\d{6}\.png$/i.test(name))
        .sort()
        .map((name) => path.join(dir, name));
}
export async function exportMp4(projectRoot, outputName, fps) {
    const frames = await locateFrames(projectRoot);
    if (frames.length === 0)
        return { ok: false, message: 'No captured PNG frames found.' };
    const output = safeProjectPath(projectRoot, outputName);
    const result = await runProcess(resolveFfmpeg(), [
        '-y', '-framerate', String(fps),
        '-i', safeProjectPath(projectRoot, '.gjm_frames/frame_%06d.png'),
        '-c:v', 'libx264', '-pix_fmt', 'yuv420p', output
    ], { cwd: projectRoot, timeoutMs: 120000 });
    return {
        ok: result.code === 0,
        message: result.code === 0 ? 'MP4 export succeeded.' : 'FFmpeg export failed.',
        output: outputName,
        stdout: result.stdout,
        stderr: result.stderr,
        frameCount: frames.length
    };
}
export async function locateCheckpoints(projectRoot) {
    const dir = safeProjectPath(projectRoot, '.gjm_frames');
    const names = await fs.readdir(dir).catch(() => []);
    return names.filter((name) => /^checkpoint_\d{3}_.+\.png$/i.test(name)).sort().map((name) => path.join(dir, name));
}
//# sourceMappingURL=record.js.map