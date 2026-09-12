import fs from 'node:fs/promises';
import path from 'node:path';
import { collectContext } from './context.js';
import { buildProjectIndex } from './project-index.js';
import { buildDependencyGraph } from './dependency-graph.js';
import { readLastResult } from './results.js';
import { readSession } from './session.js';
function textFile(pathname) {
    return new Set(['.gd', '.ts', '.js', '.json', '.tscn', '.tres', '.cfg', '.txt', '.md', '.shader', '.gdshader', '.cs']).has(path.extname(pathname).toLowerCase());
}
export async function buildContextPack(root, options = {}) {
    const maxFiles = Math.min(Math.max(Number(options.maxFiles ?? 40), 1), 200);
    const maxFileBytes = Math.min(Math.max(Number(options.maxFileBytes ?? 20000), 256), 200000);
    const includeContent = options.includeContent !== false;
    const [context, index, graph, lastResult, session] = await Promise.all([
        collectContext(root),
        buildProjectIndex(root),
        buildDependencyGraph(root),
        readLastResult(root),
        readSession(root)
    ]);
    const files = [];
    async function walk(dir, rel = '.') {
        if (files.length >= maxFiles)
            return;
        for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
            if (files.length >= maxFiles)
                break;
            if (entry.name === '.git' || entry.name === '.godot' || entry.name === '.gjm_snapshots')
                continue;
            const abs = path.join(dir, entry.name);
            const child = rel === '.' ? entry.name : path.join(rel, entry.name);
            if (entry.isDirectory())
                await walk(abs, child);
            else if (entry.isFile() && textFile(child)) {
                const stat = await fs.stat(abs);
                const item = { path: child.replaceAll(path.sep, '/'), size: stat.size };
                if (includeContent && stat.size <= maxFileBytes) {
                    try {
                        item.content = await fs.readFile(abs, 'utf8');
                    }
                    catch { }
                }
                files.push(item);
            }
        }
    }
    await walk(root);
    return {
        format: 'gjm.context-pack',
        version: 1,
        projectRoot: root,
        context,
        index,
        dependencyGraph: graph,
        lastResult,
        session,
        files,
        limits: { maxFiles, maxFileBytes, includeContent }
    };
}
//# sourceMappingURL=context-pack.js.map