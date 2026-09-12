import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';
async function exists(root, relative) {
    try {
        await fs.access(safeProjectPath(root, relative));
        return true;
    }
    catch {
        return false;
    }
}
function parseMarkers(stdout) {
    const out = [];
    for (const line of stdout.split(/\r?\n/)) {
        if (!line.startsWith('GJM_NODE '))
            continue;
        try {
            out.push(JSON.parse(line.slice('GJM_NODE '.length)));
        }
        catch { /* ignore malformed marker */ }
    }
    return out;
}
function deepEqual(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
}
export async function evaluateAssertions(projectRoot, behavior, command, frames, checkpoints) {
    const assertions = behavior.assertions ?? [];
    const results = [];
    const markers = parseMarkers(command.stdout);
    for (let i = 0; i < assertions.length; i++) {
        const a = assertions[i];
        switch (a.type) {
            case 'frames_min': {
                const ok = frames.length >= a.value;
                results.push({ index: i, type: a.type, ok, message: ok ? `Frame count ${frames.length} >= ${a.value}.` : `Frame count ${frames.length} < ${a.value}.`, expected: a.value, actual: frames.length });
                break;
            }
            case 'checkpoint': {
                const needle = '_' + a.name.replace(/[\\/\s]+/g, '_') + '.png';
                const ok = checkpoints.some(p => path.basename(p).endsWith(needle));
                results.push({ index: i, type: a.type, ok, message: ok ? `Checkpoint "${a.name}" exists.` : `Checkpoint "${a.name}" was not found.`, expected: a.name });
                break;
            }
            case 'stdout_contains': {
                const ok = command.stdout.includes(a.value);
                results.push({ index: i, type: a.type, ok, message: ok ? 'stdout contains expected text.' : 'stdout does not contain expected text.', expected: a.value });
                break;
            }
            case 'stdout_regex': {
                let ok = false;
                try {
                    ok = new RegExp(a.pattern, 'm').test(command.stdout);
                }
                catch { /* invalid regex = false */ }
                results.push({ index: i, type: a.type, ok, message: ok ? 'stdout matches expected regex.' : 'stdout does not match expected regex.', expected: a.pattern });
                break;
            }
            case 'stderr_not_contains': {
                const ok = !command.stderr.includes(a.value);
                results.push({ index: i, type: a.type, ok, message: ok ? 'stderr does not contain forbidden text.' : 'stderr contains forbidden text.', expected: a.value });
                break;
            }
            case 'exit_code': {
                const ok = command.code === a.value;
                results.push({ index: i, type: a.type, ok, message: ok ? `Process exit code ${command.code} matches ${a.value}.` : `Process exit code ${command.code} does not match ${a.value}.`, expected: a.value, actual: command.code });
                break;
            }
            case 'file_exists': {
                const ok = await exists(projectRoot, a.path);
                results.push({ index: i, type: a.type, ok, message: ok ? `File exists: ${a.path}` : `File not found: ${a.path}`, expected: a.path });
                break;
            }
            case 'file_contains': {
                let actual = '';
                try {
                    actual = await fs.readFile(safeProjectPath(projectRoot, a.path), 'utf8');
                }
                catch { /* handled below */ }
                const ok = actual.includes(a.value);
                results.push({ index: i, type: a.type, ok, message: ok ? `File contains expected text: ${a.path}` : `File does not contain expected text: ${a.path}`, expected: a.value });
                break;
            }
            case 'node_exists': {
                const found = markers.find(m => m.path === a.path || m.label === a.path);
                const ok = Boolean(found?.exists === true);
                results.push({ index: i, type: a.type, ok, message: ok ? `Node exists: ${a.path}` : `Node not found: ${a.path}`, expected: a.path, actual: found?.exists ?? false });
                break;
            }
            case 'node_property': {
                const found = markers.find(m => m.path === a.path || m.label === a.path);
                const actual = found?.properties && typeof found.properties === 'object' ? found.properties[a.property] : undefined;
                const ok = found?.exists === true && deepEqual(actual, a.equals);
                results.push({ index: i, type: a.type, ok, message: ok ? `Node property matches: ${a.path}.${a.property}` : `Node property mismatch: ${a.path}.${a.property}`, expected: a.equals, actual });
                break;
            }
        }
    }
    return { ok: results.every(r => r.ok), results };
}
//# sourceMappingURL=assertions.js.map