import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { safeProjectPath, ensureParent } from './fs-safe.js';
import { runGodot, getGodotMajor } from './godot.js';
import { autoplay as runAutoplay } from './game-studio.js';
const IGNORE = new Set(['.git', '.godot', '.import', 'node_modules', 'dist', '.gjm', '.gjm_tasks']);
const TEXT_EXT = new Set(['.gd', '.cs', '.tscn', '.tres', '.godot', '.cfg', '.json', '.shader', '.gdshader', '.md', '.txt', '.yml', '.yaml', '.toml', '.ini', '.import']);
function sha256(data) { return createHash('sha256').update(data).digest('hex'); }
function now() { return new Date().toISOString(); }
async function walk(root, rel = '') {
    const dir = safeProjectPath(root, rel || '.');
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
        if (IGNORE.has(e.name))
            continue;
        const child = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory())
            out.push(...await walk(root, child));
        else
            out.push(child.replaceAll('\\', '/'));
    }
    return out;
}
function lineCount(s) { return s.length ? s.split(/\r?\n/).length : 0; }
function countMatches(s, re) { return (s.match(re) ?? []).length; }
function parseScene(text) {
    const nodes = [];
    const resources = [];
    for (const line of text.split(/\r?\n/)) {
        const n = line.match(/^\[node\s+name="([^"]+)"(?:\s+type="([^"]+)")?(?:\s+parent="([^"]*)")?/);
        if (n)
            nodes.push({ name: n[1], type: n[2] ?? 'Node', parent: n[3] ?? '' });
        const r = line.match(/^\[ext_resource\s+path="([^"]+)".*type="([^"]+)"/);
        if (r)
            resources.push({ path: r[1], type: r[2] });
    }
    return { nodeCount: nodes.length, resourceCount: resources.length, nodes: nodes.slice(0, 500), resources: resources.slice(0, 500) };
}
function parseScript(text) {
    const classes = [...text.matchAll(/(?:class_name|class)\s+([A-Za-z_][\w]*)/g)].map(m => m[1]);
    const funcs = [...text.matchAll(/func\s+([A-Za-z_][\w]*)\s*\(/g)].map(m => m[1]);
    const signals = [...text.matchAll(/signal\s+([A-Za-z_][\w]*)/g)].map(m => m[1]);
    const extendsMatch = text.match(/^\s*extends\s+([^\s]+)/m);
    const todo = countMatches(text, /\b(?:TODO|FIXME|HACK)\b/gi);
    const open = (text.match(/[({\[]/g) ?? []).length;
    const close = (text.match(/[)}\]]/g) ?? []).length;
    return { extends: extendsMatch?.[1] ?? null, classes, funcs, signals, todo, delimiterBalance: open - close };
}
export async function auditProject(root, options = {}) {
    const maxFiles = Math.max(1, Math.min(20000, Number(options.maxFiles ?? 5000)));
    const files = (await walk(root)).slice(0, maxFiles);
    const summary = {};
    const issues = [];
    const details = {};
    for (const rel of files) {
        const ext = path.extname(rel).toLowerCase() || '<none>';
        summary[ext] = (summary[ext] ?? 0) + 1;
        const p = safeProjectPath(root, rel);
        const stat = await fs.stat(p);
        if (stat.size > 10 * 1024 * 1024)
            issues.push({ severity: 'warning', code: 'large-file', path: rel, bytes: stat.size });
        if (TEXT_EXT.has(ext) && stat.size <= 2 * 1024 * 1024) {
            const text = await fs.readFile(p, 'utf8');
            if (ext === '.tscn')
                details[rel] = parseScene(text);
            if (ext === '.gd' || ext === '.gdshader') {
                const parsed = parseScript(text);
                details[rel] = parsed;
                if (parsed.delimiterBalance !== 0)
                    issues.push({ severity: 'error', code: 'delimiter-balance', path: rel, delta: parsed.delimiterBalance });
                if (parsed.todo > 0)
                    issues.push({ severity: 'info', code: 'todo-marker', path: rel, count: parsed.todo });
            }
            if (ext === '.godot') {
                const lines = text.split(/\r?\n/).filter(Boolean);
                details[rel] = { lines: lines.length, projectSettings: countMatches(text, /^\[[^\]]+\]/gm) };
            }
        }
    }
    let project = null;
    try {
        project = await fs.readFile(safeProjectPath(root, 'project.godot'), 'utf8');
    }
    catch { }
    return {
        ok: issues.every(i => i.severity !== 'error'), code: issues.some(i => i.severity === 'error') ? 'GJM-E400' : 'GJM-OK',
        generatedAt: now(), root, fileCount: files.length, truncated: files.length >= maxFiles,
        summary, issues, projectPresent: project !== null, details
    };
}
function crc32(buf) {
    let c = 0xffffffff;
    for (const b of buf) {
        c ^= b;
        for (let k = 0; k < 8; k++)
            c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);
    }
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const t = Buffer.from(type, 'ascii');
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    t.copy(out, 4);
    data.copy(out, 8);
    out.writeUInt32BE(crc32(Buffer.concat([t, data])), 8 + data.length);
    return out;
}
function pngRgba(width, height, pixels) {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0;
        pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
export async function generateTexture(root, options = {}) {
    const width = Math.max(1, Math.min(2048, Number(options.width ?? 256)));
    const height = Math.max(1, Math.min(2048, Number(options.height ?? 256)));
    const kind = String(options.kind ?? 'gradient');
    const out = String(options.output ?? `textures/gjm-${kind}.png`);
    const c1 = String(options.color1 ?? '#101828');
    const c2 = String(options.color2 ?? '#4aa3ff');
    const parse = (c) => { const s = c.replace('#', '').padEnd(6, '0'); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16), 255]; };
    const a = parse(c1), b = parse(c2), pixels = Buffer.alloc(width * height * 4);
    let seed = Number(options.seed ?? 1337) >>> 0;
    const rnd = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 0xffffffff; };
    for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4, t = kind === 'checker' ? ((x >> 4) + (y >> 4)) % 2 : y / Math.max(1, height - 1);
            let r = a[0] + (b[0] - a[0]) * t, g = a[1] + (b[1] - a[1]) * t, bl = a[2] + (b[2] - a[2]) * t;
            if (kind === 'noise') {
                r = rnd() * 255;
                g = rnd() * 255;
                bl = rnd() * 255;
            }
            if (kind === 'solid') {
                r = a[0];
                g = a[1];
                bl = a[2];
            }
            pixels[i] = Math.round(r);
            pixels[i + 1] = Math.round(g);
            pixels[i + 2] = Math.round(bl);
            pixels[i + 3] = 255;
        }
    const png = pngRgba(width, height, pixels);
    await ensureParent(safeProjectPath(root, out));
    await fs.writeFile(safeProjectPath(root, out), png);
    return { ok: true, code: 'GJM-OK', path: out, width, height, kind, bytes: png.length, sha256: sha256(png) };
}
export async function editAnimation(root, options) {
    const file = String(options.file ?? 'animations/clip.gjm.animation.json');
    const p = safeProjectPath(root, file);
    const data = JSON.parse(await fs.readFile(p, 'utf8'));
    const action = String(options.action ?? 'add_key');
    const trackIndex = Math.max(0, Number(options.trackIndex ?? 0));
    if (!Array.isArray(data.tracks))
        data.tracks = [];
    if (!data.tracks[trackIndex])
        data.tracks[trackIndex] = { property: String(options.property ?? 'position'), keys: [] };
    const keys = Array.isArray(data.tracks[trackIndex].keys) ? data.tracks[trackIndex].keys : [];
    if (action === 'add_key')
        keys.push({ time: Number(options.time ?? 0), value: options.value ?? [0, 0, 0] });
    else if (action === 'remove_key') {
        const t = Number(options.time ?? -1);
        data.tracks[trackIndex].keys = keys.filter((k) => Number(k.time) !== t);
    }
    else if (action === 'move_key') {
        const from = Number(options.fromTime ?? -1);
        const to = Number(options.time ?? 0);
        for (const k of keys)
            if (Number(k.time) === from)
                k.time = to;
    }
    else if (action === 'set_value') {
        const t = Number(options.time ?? -1);
        for (const k of keys)
            if (Number(k.time) === t)
                k.value = options.value;
    }
    else if (action === 'sort')
        keys.sort((a, b) => Number(a.time) - Number(b.time));
    else
        throw new Error(`Unsupported animation edit: ${action}`);
    data.tracks[trackIndex].keys = keys.sort((a, b) => Number(a.time) - Number(b.time));
    data.updatedAt = now();
    await fs.writeFile(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
    return { ok: true, code: 'GJM-OK', file, action, trackIndex, keyCount: data.tracks[trackIndex].keys.length, duration: Math.max(0, ...data.tracks.flatMap((t) => Array.isArray(t.keys) ? t.keys.map((k) => Number(k.time) || 0) : [])) };
}
export async function profileCompare(root, options = {}) {
    const aFile = String(options.baseline ?? '.gjm_profile.json');
    const bFile = String(options.current ?? '.gjm_profile.current.json');
    const a = JSON.parse(await fs.readFile(safeProjectPath(root, aFile), 'utf8'));
    const b = JSON.parse(await fs.readFile(safeProjectPath(root, bFile), 'utf8'));
    const delta = (k) => ({ baseline: a[k], current: b[k], delta: Number(b[k] ?? 0) - Number(a[k] ?? 0), percent: a[k] ? ((Number(b[k]) - Number(a[k])) / Number(a[k])) * 100 : null });
    return { ok: true, code: 'GJM-OK', metrics: { fps: delta('fps'), frames: delta('frames'), physics_frames: delta('physics_frames'), node_count: delta('node_count'), process_nodes: delta('process_nodes') }, regressed: (Number(b.fps ?? 0) < Number(a.fps ?? 0) * 0.9) || (Number(b.node_count ?? 0) > Number(a.node_count ?? 0) * 1.25) };
}
export async function shaderValidate(root, options = {}) {
    const shader = String(options.shader ?? '');
    const file = String(options.file ?? '');
    if (!shader && !file)
        throw new Error('shaderValidate requires shader or file.');
    const code = shader || await fs.readFile(safeProjectPath(root, file), 'utf8');
    const major = options.godotMajor === undefined ? await getGodotMajor() : Number(options.godotMajor);
    const token = Date.now().toString(36);
    const scene = '.gjm_tasks/shader-validate-' + token + '.tscn';
    const runner = '.gjm_tasks/shader-run-' + token + '.gd';
    await ensureParent(safeProjectPath(root, scene));
    await ensureParent(safeProjectPath(root, runner));
    const shaderText = JSON.stringify(code);
    const sceneText = major >= 4
        ? `[gd_scene load_steps=4 format=3]\n\n[ext_resource path="res://${runner}" type="Script" id="1_runner"]\n\n[sub_resource type="Shader" id="Shader_gjm"]\ncode = ${shaderText}\n\n[sub_resource type="ShaderMaterial" id="ShaderMaterial_gjm"]\nshader = SubResource("Shader_gjm")\n\n[node name="Root" type="Node2D"]\nscript = ExtResource("1_runner")\n\n[node name="Probe" type="ColorRect" parent="."]\noffset_right = 64.0\noffset_bottom = 64.0\nmaterial = SubResource("ShaderMaterial_gjm")\ncolor = Color(1, 1, 1, 1)\n`
        : `[gd_scene load_steps=4 format=2]\n\n[ext_resource path="res://${runner}" type="Script" id=1]
\n[sub_resource type="Shader" id=1]\ncode = ${shaderText}\n\n[sub_resource type="ShaderMaterial" id=2]\nshader = SubResource(1)\n\n[node name="Root" type="Node2D"]\nscript = ExtResource(1)\n\n[node name="Probe" type="ColorRect" parent="."]\nmargin_right = 64.0\nmargin_bottom = 64.0\nmaterial = SubResource(2)\ncolor = Color(1, 1, 1, 1)\n`;
    const runnerText = major >= 4
        ? `extends Node2D\nfunc _ready():\n    print("GJM_SHADER_OK ", get_node("Probe").material != null)\n    get_tree().quit()\n`
        : `extends Node2D\nfunc _ready():\n    print("GJM_SHADER_OK ", get_node("Probe").material != null)\n    get_tree().quit()\n`;
    await fs.writeFile(safeProjectPath(root, scene), sceneText, 'utf8');
    await fs.writeFile(safeProjectPath(root, runner), runnerText, 'utf8');
    try {
        const args = major >= 4 ? ['--headless', '--path', root, `res://${scene}`] : ['--path', root, `res://${scene}`];
        const r = await runGodot(args, root, Number(options.timeoutMs ?? 15000));
        const diagnostics = `${r.stdout}\n${r.stderr}`;
        const failed = /SCRIPT ERROR:|Parse Error:|Shader Error:|shader.*error|ERROR:.*shader|Failed loading resource/i.test(diagnostics);
        const ok = r.code === 0 && !failed && r.stdout.includes('GJM_SHADER_OK');
        return { ok, code: ok ? 'GJM-OK' : 'GJM-E401', exitCode: r.code, file, stdout: r.stdout, stderr: r.stderr };
    }
    finally {
        await fs.rm(safeProjectPath(root, scene), { force: true }).catch(() => { });
        await fs.rm(safeProjectPath(root, runner), { force: true }).catch(() => { });
    }
}
export async function autoplayFuzz(root, options) {
    const base = typeof options.behavior === 'string' ? options.behavior : JSON.stringify(options.behavior);
    const runs = Math.max(1, Math.min(50, Number(options.runs ?? 10)));
    let seed = Number(options.seed ?? 42) >>> 0;
    const rnd = () => { seed = (1103515245 * seed + 12345) >>> 0; return seed / 0xffffffff; };
    const reports = [];
    for (let i = 0; i < runs; i++) {
        const b = JSON.parse(base);
        const actions = Array.isArray(b.actions) ? b.actions : [];
        const variant = [...actions];
        const count = Math.min(8, Math.max(1, Math.floor(rnd() * 5) + 1));
        const keys = ['left', 'right', 'up', 'down', 'space', 'enter'];
        for (let j = 0; j < count; j++)
            variant.push({ type: 'key_press', key: keys[Math.floor(rnd() * keys.length)], frames: Math.floor(rnd() * 4) + 1 });
        b.actions = variant;
        b.name = `fuzz-${i + 1}`;
        reports.push(await runAutoplay(root, { behavior: JSON.stringify(b), runs: 1, stopOnFailure: true }));
    }
    const failed = reports.filter((r) => !r.ok).length;
    return { ok: failed === 0, code: failed === 0 ? 'GJM-OK' : 'GJM-E402', seed: rnd(), runs, failed, reports };
}
export async function inputAudit(root, options = {}) {
    const wanted = Array.isArray(options.actions) ? options.actions.map(String) : [];
    const project = await fs.readFile(safeProjectPath(root, 'project.godot'), 'utf8');
    const actions = [];
    const re = /^([^\s]+\/[^\n=]+)=/gm;
    const inputIndex = project.indexOf('[input]');
    const block = inputIndex >= 0 ? project.slice(inputIndex) : '';
    for (const line of block.split(/\r?\n/)) {
        const m = line.match(/^([^\s=]+)=/);
        if (m)
            actions.push(m[1]);
    }
    const missing = wanted.filter(a => !actions.includes(a));
    return { ok: missing.length === 0, code: missing.length === 0 ? 'GJM-OK' : 'GJM-E403', actions, requested: wanted, missing };
}
export async function releaseReadiness(root) {
    const audit = await auditProject(root, { maxFiles: 10000 });
    const checks = [];
    checks.push({ name: 'project.godot', ok: Boolean(audit.projectPresent), required: true, detail: audit.projectPresent });
    checks.push({ name: 'no_static_errors', ok: Boolean(audit.ok), required: true, detail: audit.issues.filter((x) => x.severity === 'error') });
    try {
        const git = await fs.access(safeProjectPath(root, '.git'));
        checks.push({ name: 'git', ok: true, required: false, detail: Boolean(git) });
    }
    catch {
        checks.push({ name: 'git', ok: false, required: false, detail: 'not a git working tree' });
    }
    let size = 0;
    for (const rel of await walk(root)) {
        try {
            size += (await fs.stat(safeProjectPath(root, rel))).size;
        }
        catch { }
    }
    checks.push({ name: 'project_size', ok: size < 2 * 1024 * 1024 * 1024, required: true, detail: size });
    return { ok: checks.filter(c => c.required).every(c => c.ok), code: checks.filter(c => c.required).every(c => c.ok) ? 'GJM-OK' : 'GJM-E404', generatedAt: now(), checks, projectBytes: size };
}
//# sourceMappingURL=power.js.map