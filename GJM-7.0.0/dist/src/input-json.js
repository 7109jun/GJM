import fs from 'node:fs/promises';
import path from 'node:path';
import { safeProjectPath } from './fs-safe.js';
export async function loadJsonFile(root, relative) {
    return JSON.parse(await fs.readFile(safeProjectPath(root, relative), 'utf8'));
}
export async function loadJsonInput(root, file, content, label) {
    if (content !== undefined) {
        if (!content.trim())
            throw new Error(`${label} content is empty.`);
        try {
            return JSON.parse(content);
        }
        catch (error) {
            throw new Error(`${label} content is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    return loadJsonFile(root, file ?? (label === 'godot.make.json' ? 'godot.make.json' : 'Behavior.json'));
}
export function displayInputSource(file, content) {
    return content !== undefined ? '<inline JSON>' : path.normalize(file ?? '');
}
function jsonDestination(kind, destination) {
    if (destination)
        return destination;
    return kind === 'make' ? 'godot.make.json' : 'Behavior.json';
}
export async function importJsonFile(root, sourceFile, kind, destination) {
    const source = path.resolve(sourceFile);
    const stat = await fs.stat(source);
    if (!stat.isFile())
        throw new Error('Uploaded source is not a regular file.');
    if (stat.size > 4 * 1024 * 1024)
        throw new Error('JSON upload is larger than 4 MiB.');
    const lower = source.toLowerCase();
    if (!lower.endsWith('.json'))
        throw new Error('GJM JSON uploads must use the .json extension.');
    const raw = await fs.readFile(source, 'utf8');
    try {
        JSON.parse(raw);
    }
    catch (error) {
        throw new Error(`Uploaded JSON is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const relativeDestination = path.normalize(jsonDestination(kind, destination));
    const target = safeProjectPath(root, relativeDestination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, raw, 'utf8');
    return { kind, source, destination: relativeDestination, bytes: Buffer.byteLength(raw, 'utf8') };
}
export async function importJsonContent(root, content, kind, destination) {
    if (!content.trim())
        throw new Error('JSON content is empty.');
    try {
        JSON.parse(content);
    }
    catch (error) {
        throw new Error(`JSON content is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    const relativeDestination = path.normalize(jsonDestination(kind, destination));
    const target = safeProjectPath(root, relativeDestination);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, 'utf8');
    return { kind, source: '<inline JSON>', destination: relativeDestination, bytes: Buffer.byteLength(content, 'utf8') };
}
//# sourceMappingURL=input-json.js.map