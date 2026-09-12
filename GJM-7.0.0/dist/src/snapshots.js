import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
const DIR = '.gjm_snapshots';
const SKIP = new Set(['.git', '.godot', '.gjm_snapshots']);
function snapshotRoot(projectRoot) { return path.join(projectRoot, DIR); }
function safeName(id) { return id.replace(/[^A-Za-z0-9._-]/g, '_'); }
async function copyTree(src, dst) {
    const stat = await fs.lstat(src);
    if (stat.isDirectory()) {
        await fs.mkdir(dst, { recursive: true });
        for (const entry of await fs.readdir(src, { withFileTypes: true })) {
            if (SKIP.has(entry.name))
                continue;
            await copyTree(path.join(src, entry.name), path.join(dst, entry.name));
        }
    }
    else if (stat.isSymbolicLink()) {
        const target = await fs.readlink(src);
        await fs.symlink(target, dst);
    }
    else {
        await fs.copyFile(src, dst);
    }
}
async function removeTree(target) {
    await fs.rm(target, { recursive: true, force: true });
}
export async function createSnapshot(projectRoot, label) {
    const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const dir = path.join(snapshotRoot(projectRoot), safeName(id));
    await fs.mkdir(snapshotRoot(projectRoot), { recursive: true });
    await copyTree(projectRoot, dir);
    const meta = { id, createdAt: new Date().toISOString(), label, path: dir };
    await fs.writeFile(path.join(dir, '.gjm-snapshot.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');
    return meta;
}
export async function listSnapshots(projectRoot) {
    try {
        await fs.access(snapshotRoot(projectRoot));
    }
    catch {
        return [];
    }
    const result = [];
    for (const entry of await fs.readdir(snapshotRoot(projectRoot), { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        try {
            result.push(JSON.parse(await fs.readFile(path.join(snapshotRoot(projectRoot), entry.name, '.gjm-snapshot.json'), 'utf8')));
        }
        catch { /* ignore incomplete snapshot */ }
    }
    return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function restoreSnapshot(projectRoot, id) {
    const snapshots = await listSnapshots(projectRoot);
    const snap = snapshots.find(x => x.id === id);
    if (!snap)
        throw new Error(`Snapshot not found: ${id}`);
    for (const entry of await fs.readdir(projectRoot, { withFileTypes: true })) {
        if (entry.name === DIR)
            continue;
        await removeTree(path.join(projectRoot, entry.name));
    }
    for (const entry of await fs.readdir(snap.path, { withFileTypes: true })) {
        if (entry.name === '.gjm-snapshot.json')
            continue;
        await copyTree(path.join(snap.path, entry.name), path.join(projectRoot, entry.name));
    }
    return snap;
}
export async function deleteSnapshot(projectRoot, id) {
    const snapshots = await listSnapshots(projectRoot);
    const snap = snapshots.find(x => x.id === id);
    if (!snap)
        return false;
    await removeTree(snap.path);
    return true;
}
//# sourceMappingURL=snapshots.js.map