import { spawn } from 'node:child_process';
export function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: { ...process.env, ...options.env },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
            detached: process.platform !== 'win32'
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        let timer;
        const finish = (result) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            resolve(result);
        };
        child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', (error) => {
            if (settled)
                return;
            settled = true;
            if (timer)
                clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code, signal) => finish({ code: code ?? -1, signal: signal ?? undefined, stdout, stderr }));
        if (options.timeoutMs && options.timeoutMs > 0) {
            timer = setTimeout(() => {
                try {
                    if (process.platform !== 'win32' && child.pid)
                        process.kill(-child.pid, 'SIGTERM');
                    else
                        child.kill();
                }
                catch {
                    try {
                        child.kill();
                    }
                    catch { /* already exited */ }
                }
                finish({ code: -2, stdout, stderr, timedOut: true, signal: 'SIGTERM' });
            }, options.timeoutMs);
        }
    });
}
export function resolveGodot() {
    return process.env.GODOT_BIN || (process.platform === 'win32' ? 'godot.exe' : 'godot');
}
export function resolveFfmpeg() {
    return process.env.FFMPEG_BIN || (process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
}
//# sourceMappingURL=process.js.map