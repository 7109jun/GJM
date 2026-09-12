import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath, writeText } from './fs-safe.js';
import { runGodotScriptTask } from './godot-task.js';
import { expandTemplates } from './templates.js';
function q(value) { return JSON.stringify(value); }
function gv(value, refs, godotMajor = 4) {
    if (value && typeof value === 'object' && !Array.isArray(value) && '$type' in value) {
        const tv = value;
        const v = tv.value;
        const arr = Array.isArray(v) ? v : [];
        switch (tv.$type) {
            case 'Vector2': return `Vector2(${arr[0] ?? 0}, ${arr[1] ?? 0})`;
            case 'Vector3': return `Vector3(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0})`;
            case 'Vector2i': return `Vector2i(${arr[0] ?? 0}, ${arr[1] ?? 0})`;
            case 'Vector3i': return `Vector3i(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0})`;
            case 'Color': return `Color(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0}, ${arr[3] ?? 1})`;
            case 'Rect2': return `Rect2(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0}, ${arr[3] ?? 0})`;
            case 'Rect2i': return `Rect2i(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0}, ${arr[3] ?? 0})`;
            case 'Plane': return `Plane(Vector3(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0}), ${arr[3] ?? 0})`;
            case 'Quaternion': return `Quaternion(${arr[0] ?? 0}, ${arr[1] ?? 0}, ${arr[2] ?? 0}, ${arr[3] ?? 1})`;
            case 'Basis': return `Basis(Vector3(${arr[0] ?? 1}, ${arr[1] ?? 0}, ${arr[2] ?? 0}), Vector3(${arr[3] ?? 0}, ${arr[4] ?? 1}, ${arr[5] ?? 0}), Vector3(${arr[6] ?? 0}, ${arr[7] ?? 0}, ${arr[8] ?? 1}))`;
            case 'Transform2D': return `Transform2D(${arr.map((x) => Number(x) || 0).slice(0, 6).join(', ')})`;
            case 'Transform3D': return `Transform3D(${arr.map((x) => Number(x) || 0).slice(0, 12).join(', ')})`;
            case 'NodePath': return `NodePath(${q(String(tv.value ?? ''))})`;
            case 'SubResource': {
                const id = String(tv.value ?? '');
                return godotMajor >= 4 ? `SubResource(${q(id)})` : `SubResource(${refs?.sub?.get(id) ?? (Number(id) || 1)})`;
            }
            case 'ExtResource': {
                const id = String(tv.value ?? '');
                return godotMajor >= 4 ? `ExtResource(${q(id)})` : `ExtResource(${refs?.ext?.get(id) ?? (Number(id) || 1)})`;
            }
        }
    }
    if (value === null)
        return 'null';
    if (typeof value === 'boolean')
        return value ? 'true' : 'false';
    if (typeof value === 'number')
        return Number.isFinite(value) ? String(value) : 'null';
    if (typeof value === 'string')
        return q(value);
    if (Array.isArray(value))
        return `[${value.map(v => gv(v, refs, godotMajor)).join(', ')}]`;
    return `{ ${Object.entries(value).map(([k, v]) => `${q(k)}: ${gv(v, refs, godotMajor)}`).join(', ')} }`;
}
function collectResources(action) {
    const paths = new Set();
    for (const resource of action.resources ?? [])
        if (resource.path)
            paths.add(resource.path);
    if (action.script)
        paths.add(action.script);
    if (action.root?.script)
        paths.add(action.root.script);
    const walk = (node) => {
        if (node.script)
            paths.add(node.script);
        for (const child of node.children ?? [])
            walk(child);
    };
    for (const node of action.nodes ?? [])
        walk(node);
    const result = new Map();
    let i = 1;
    for (const resource of paths)
        result.set(resource, `${i++}_script`);
    return result;
}
function emitNode(lines, node, resources, subresources, godotMajor) {
    const parent = node.parent ?? '.';
    lines.push('', `[node name=${q(node.name)} type=${q(node.type)} parent=${q(parent)}]`);
    if (node.script) {
        const id = resources.get(node.script) ?? '1_script';
        lines.push(`script = ${godotMajor >= 4 ? `ExtResource(\"${id}\")` : `ExtResource(${id.replace(/\D/g, '') || '1'})`}`);
    }
    for (const [key, value] of Object.entries(node.properties ?? {}))
        lines.push(`${key} = ${gv(value, { sub: subresources, ext: new Map([...resources.values()].map((id, i) => [id, i + 1])) }, godotMajor)}`);
    for (const child of node.children ?? [])
        emitNode(lines, { ...child, parent: child.parent ?? node.name }, resources, subresources, godotMajor);
}
export function sceneText(action, godotMajor = 4) {
    const root = action.root ?? {};
    const rootName = root.name ?? 'Main';
    const rootType = root.type ?? 'Node';
    const nodes = action.nodes ?? [];
    const resources = collectResources(action);
    const lines = [];
    const subresourceList = action.subresources ?? [];
    const subresourceIds = new Map(subresourceList.map((s, i) => [s.id, i + 1]));
    const loadSteps = 1 + resources.size + subresourceList.length;
    const format = godotMajor >= 4 ? 3 : 2;
    lines.push(`[gd_scene${loadSteps > 1 ? ` load_steps=${loadSteps}` : ''} format=${format}]`);
    let rid = 1;
    for (const [resource, id] of resources) {
        void rid++;
        const declared = (action.resources ?? []).find(r => r.path === resource);
        const type = declared?.type ?? 'Script';
        if (godotMajor >= 4)
            lines.push(`[ext_resource type=\"${type}\" path=${q(resource)} id=${q(id)}]`);
        else
            lines.push(`[ext_resource path=${q(resource)} type=\"${type}\" id=\"${id}\"]`);
    }
    for (const sub of subresourceList) {
        const subIdText = godotMajor >= 4 ? q(sub.id) : String(subresourceIds.get(sub.id) ?? 1);
        lines.push('', `[sub_resource type=${q(sub.type)} id=${subIdText}]`);
        for (const [key, value] of Object.entries(sub.properties ?? {}))
            lines.push(`${key} = ${gv(value, { sub: subresourceIds, ext: new Map([...resources.values()].map((id, i) => [id, i + 1])) }, godotMajor)}`);
    }
    lines.push('', `[node name=${q(rootName)} type=${q(rootType)}]`);
    const rootScript = root.script ?? action.script;
    if (rootScript) {
        const id = resources.get(rootScript) ?? '1_script';
        lines.push(`script = ${godotMajor >= 4 ? `ExtResource("${id}")` : `ExtResource(${id.replace(/\D/g, '') || '1'})`}`);
    }
    const refs = { sub: subresourceIds, ext: new Map([...resources.values()].map((id, i) => [id, i + 1])) };
    for (const [key, value] of Object.entries(root.properties ?? {}))
        lines.push(`${key} = ${gv(value, refs, godotMajor)}`);
    for (const node of nodes)
        emitNode(lines, node, resources, subresourceIds, godotMajor);
    for (const c of action.connections ?? []) {
        const binds = c.binds ? ` binds=${gv(c.binds, refs, godotMajor)}` : '';
        const flags = c.flags !== undefined ? ` flags=${c.flags}` : '';
        lines.push('', `[connection signal=${q(c.signal)} from=${q(c.from)} to=${q(c.to)} method=${q(c.method)}${binds}${flags}]`);
    }
    return `${lines.join('\n')}\n`;
}
function settingValue(value) { return gv(value); }
async function mergeInputAction(root, name, deadzone, events) {
    const file = safeProjectPath(root, 'project.godot');
    await ensureProjectFile(root);
    const raw = await fs.readFile(file, 'utf8');
    const lines = raw.split(/\r?\n/);
    let section = lines.indexOf('[input]');
    if (section < 0) {
        while (lines.length && lines.at(-1) === '')
            lines.pop();
        lines.push('', '[input]');
        section = lines.length - 1;
    }
    let end = lines.length;
    for (let i = section + 1; i < lines.length; i++)
        if (/^\[[^\]]+\]$/.test(lines[i])) {
            end = i;
            break;
        }
    const eventText = events.length ? `Array([${events.map(e => gv(e)).join(', ')}])` : 'Array([])';
    const line = `${name}={\"deadzone\":${deadzone},\"events\":${eventText}}`;
    const idx = lines.findIndex((l, i) => i > section && i < end && l.startsWith(`${name}=`));
    if (idx >= 0)
        lines[idx] = line;
    else
        lines.splice(end, 0, line);
    await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}
async function ensureProjectFile(root, projectName, godotMajor = 4) {
    const file = safeProjectPath(root, 'project.godot');
    try {
        await fs.access(file);
        return;
    }
    catch { /* create below */ }
    const name = projectName?.trim() || 'GJM Project';
    const initial = `; Engine configuration file.\n; Generated by Godot-J-MCP (GJM).\n\nconfig_version=${godotMajor >= 4 ? 5 : 4}\n\n[application]\nconfig/name=${q(name)}\n\n[display]\n\n`;
    await fs.writeFile(file, initial, 'utf8');
}
async function mergeProjectSetting(root, section, key, value) {
    const file = safeProjectPath(root, 'project.godot');
    await ensureProjectFile(root);
    const text = await fs.readFile(file, 'utf8');
    const lines = text.split(/\r?\n/);
    const header = `[${section}]`;
    let start = lines.indexOf(header);
    if (start < 0) {
        while (lines.length && lines.at(-1) === '')
            lines.pop();
        if (lines.length)
            lines.push('');
        lines.push(header, `${key}=${settingValue(value)}`);
        await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
        return;
    }
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\[[^\]]+\]$/.test(lines[i])) {
            end = i;
            break;
        }
    }
    const existing = lines.findIndex((line, i) => i > start && i < end && new RegExp(`^${key.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&')}=`).test(line));
    if (existing >= 0)
        lines[existing] = `${key}=${settingValue(value)}`;
    else
        lines.splice(end, 0, `${key}=${settingValue(value)}`);
    await fs.writeFile(file, `${lines.join('\n')}\n`, 'utf8');
}
function featureNode(kind, godotMajor, name, parent = '.', properties = {}, script) {
    const major4 = godotMajor >= 4;
    const base = {
        name,
        type: 'Node',
        parent,
        properties: { ...properties },
        ...(script ? { script } : {})
    };
    switch (kind) {
        case '2d_root': return { ...base, type: 'Node2D' };
        case '3d_root': return { ...base, type: major4 ? 'Node3D' : 'Spatial' };
        case 'hybrid_root': return { ...base, type: 'Node' };
        case 'player_2d': return { ...base, type: major4 ? 'CharacterBody2D' : 'KinematicBody2D' };
        case 'player_3d': return { ...base, type: major4 ? 'CharacterBody3D' : 'KinematicBody' };
        case 'static_body_2d': return { ...base, type: 'StaticBody2D' };
        case 'rigid_body_2d': return { ...base, type: 'RigidBody2D' };
        case 'static_body_3d': return { ...base, type: major4 ? 'StaticBody3D' : 'StaticBody' };
        case 'rigid_body_3d': return { ...base, type: major4 ? 'RigidBody3D' : 'RigidBody' };
        case 'collision_shape_2d': return { ...base, type: 'CollisionShape2D' };
        case 'collision_shape_3d': return { ...base, type: major4 ? 'CollisionShape3D' : 'CollisionShape' };
        case 'camera_2d': return { ...base, type: 'Camera2D' };
        case 'camera_3d': return { ...base, type: major4 ? 'Camera3D' : 'Camera' };
        case 'directional_light': return { ...base, type: major4 ? 'DirectionalLight3D' : 'DirectionalLight' };
        case 'omni_light': return { ...base, type: major4 ? 'OmniLight3D' : 'OmniLight' };
        case 'spot_light': return { ...base, type: major4 ? 'SpotLight3D' : 'OmniLight' };
        case 'world_environment': return { ...base, type: 'WorldEnvironment' };
        case 'particles_2d': return { ...base, type: 'Particles2D' };
        case 'particles_3d': return { ...base, type: major4 ? 'GPUParticles3D' : 'Particles' };
        case 'audio_player': return { ...base, type: 'AudioStreamPlayer' };
        case 'audio_2d': return { ...base, type: 'AudioStreamPlayer2D' };
        case 'audio_3d': return { ...base, type: major4 ? 'AudioStreamPlayer3D' : 'AudioStreamPlayer3D' };
        case 'animation_player': return { ...base, type: 'AnimationPlayer' };
        case 'timer': return { ...base, type: 'Timer' };
        case 'http_request': return { ...base, type: 'HTTPRequest' };
        case 'navigation_2d': return { ...base, type: major4 ? 'NavigationRegion2D' : 'Navigation2D' };
        case 'navigation_3d': return { ...base, type: major4 ? 'NavigationRegion3D' : 'Navigation' };
        case 'sprite_2d': return { ...base, type: major4 ? 'Sprite2D' : 'Sprite' };
        case 'mesh_instance_3d': return { ...base, type: major4 ? 'MeshInstance3D' : 'MeshInstance' };
        case 'ui_label': return { ...base, type: 'Label' };
        case 'ui_button': return { ...base, type: 'Button' };
        case 'ui_panel': return { ...base, type: 'Panel' };
        case 'ui_root': return { ...base, type: 'Control' };
        case 'line_2d': return { ...base, type: 'Line2D' };
        case 'line_3d': return { ...base, type: major4 ? 'Line3D' : 'ImmediateGeometry' };
    }
}
function expandFeature(action, godotMajor) {
    const major4 = godotMajor >= 4;
    const path = action.scene ?? 'main.tscn';
    if (action.kind === '2d_root' || action.kind === '3d_root' || action.kind === 'hybrid_root') {
        const type = action.kind === '3d_root' ? (major4 ? 'Node3D' : 'Spatial') : action.kind === '2d_root' ? 'Node2D' : 'Node';
        return { type: 'scene', path, root: { name: action.name ?? 'Main', type, script: action.script, properties: action.properties }, nodes: [] };
    }
    const node = featureNode(action.kind, godotMajor, action.name ?? action.kind, action.parent ?? '.', action.properties, action.script);
    return { type: 'scene', path, root: { name: 'Main', type: 'Node' }, nodes: [node] };
}
function coalesceFeatures(actions, godotMajor) {
    const expandedActions = [];
    for (const action of actions) {
        if (action.type === 'template')
            expandedActions.push(...expandTemplates([action.name], godotMajor));
        else
            expandedActions.push(action);
    }
    const out = [];
    const featureScenes = new Map();
    const flush = (scene) => {
        const value = featureScenes.get(scene);
        if (value) {
            out.push(value);
            featureScenes.delete(scene);
        }
    };
    for (const action of expandedActions) {
        if (action.type === 'feature') {
            const expanded = expandFeature(action, godotMajor);
            const existing = featureScenes.get(expanded.path);
            if (!existing)
                featureScenes.set(expanded.path, expanded);
            else {
                const isRootFeature = action.kind === '2d_root' || action.kind === '3d_root' || action.kind === 'hybrid_root';
                if (isRootFeature)
                    existing.root = expanded.root;
                else
                    existing.nodes = [...(existing.nodes ?? []), ...(expanded.nodes ?? [])];
            }
            continue;
        }
        if (action.type === 'scene') {
            const fragment = featureScenes.get(action.path);
            if (fragment) {
                action.nodes = [...(action.nodes ?? []), ...(fragment.nodes ?? [])];
                featureScenes.delete(action.path);
            }
            out.push(action);
            continue;
        }
        out.push(action);
    }
    for (const scene of [...featureScenes.keys()])
        flush(scene);
    return out;
}
export async function applyMake(root, make, dryRun, godotMajor = 4) {
    const changes = [];
    if (!dryRun)
        await ensureProjectFile(root, make.project?.name ?? make.name, godotMajor);
    for (const action of coalesceFeatures(make.actions, godotMajor)) {
        switch (action.type) {
            case 'directory':
                safeProjectPath(root, action.path);
                changes.push({ type: action.type, path: action.path });
                if (!dryRun)
                    await fs.mkdir(safeProjectPath(root, action.path), { recursive: true });
                break;
            case 'file':
            case 'script':
            case 'shader':
            case 'resource':
                safeProjectPath(root, action.path);
                changes.push({ type: action.type, path: action.path });
                if (!dryRun)
                    await writeText(root, action.path, action.content);
                break;
            case 'asset_base64':
                safeProjectPath(root, action.path);
                changes.push({ type: action.type, path: action.path, bytes: Math.floor((action.content.length * 3) / 4) });
                if (!dryRun) {
                    const raw = action.content.replace(/^data:[^;]+;base64,/, '');
                    const data = Buffer.from(raw, 'base64');
                    if (data.length > 32 * 1024 * 1024)
                        throw new Error('asset_base64 exceeds 32 MiB.');
                    await fs.mkdir(path.dirname(safeProjectPath(root, action.path)), { recursive: true });
                    await fs.writeFile(safeProjectPath(root, action.path), data);
                }
                break;
            case 'copy':
                safeProjectPath(root, action.from);
                safeProjectPath(root, action.to);
                changes.push({ type: action.type, from: action.from, to: action.to });
                if (!dryRun) {
                    await fs.mkdir(path.dirname(safeProjectPath(root, action.to)), { recursive: true });
                    await fs.cp(safeProjectPath(root, action.from), safeProjectPath(root, action.to), { recursive: true, force: true });
                }
                break;
            case 'scene':
                safeProjectPath(root, action.path);
                changes.push({ type: action.type, path: action.path, nodes: action.nodes?.length ?? 0, resources: action.resources?.length ?? 0 });
                if (!dryRun)
                    await writeText(root, action.path, sceneText(action, godotMajor));
                break;
            case 'scene_raw':
                safeProjectPath(root, action.path);
                changes.push({ type: action.type, path: action.path });
                if (!dryRun)
                    await writeText(root, action.path, action.content);
                break;
            case 'input_action':
                changes.push({ type: action.type, name: action.name });
                if (!dryRun)
                    await mergeInputAction(root, action.name, action.deadzone ?? 0.5, action.events ?? []);
                break;
            case 'autoload':
                changes.push({ type: action.type, name: action.name, path: action.path });
                if (!dryRun)
                    await mergeProjectSetting(root, 'autoload', action.name, action.enabled === false ? '""' : action.path);
                break;
            case 'godot_script':
                changes.push({ type: action.type, resultFile: action.resultFile ?? null });
                if (!dryRun) {
                    const task = await runGodotScriptTask({ projectRoot: root, script: action.script, timeoutMs: action.timeoutMs, args: action.args, resultFile: action.resultFile });
                    if (!task.ok)
                        throw new Error(`GJM godot_script failed (exit ${task.exitCode}): ${task.stderr || task.stdout}`);
                    changes[changes.length - 1].task = task;
                }
                break;
            case 'project_setting':
                safeProjectPath(root, 'project.godot');
                changes.push({ type: action.type, section: action.section, key: action.key });
                if (!dryRun)
                    await mergeProjectSetting(root, action.section, action.key, action.value);
                break;
            case 'feature': {
                const expanded = expandFeature(action, godotMajor);
                safeProjectPath(root, expanded.path);
                changes.push({ type: action.type, kind: action.kind, scene: expanded.path });
                if (!dryRun)
                    await writeText(root, expanded.path, sceneText(expanded, godotMajor));
                break;
            }
        }
    }
    return changes;
}
//# sourceMappingURL=make.js.map