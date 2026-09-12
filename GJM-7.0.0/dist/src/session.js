import fs from 'node:fs/promises';
import path from 'node:path';
function sessionPath(root) {
    return path.join(root, '.gjm_last_session.json');
}
function newId() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
export async function startSession(root, maxAttempts = 5) {
    const session = {
        id: newId(),
        startedAt: new Date().toISOString(),
        status: 'active',
        attempt: 0,
        maxAttempts: Math.max(1, Math.min(100, Math.floor(maxAttempts))),
        phase: 'created'
    };
    await fs.writeFile(sessionPath(root), JSON.stringify(session, null, 2) + '\n', 'utf8');
    return session;
}
export async function readSession(root) {
    try {
        return JSON.parse(await fs.readFile(sessionPath(root), 'utf8'));
    }
    catch {
        return null;
    }
}
export async function updateSession(root, patch) {
    const current = await readSession(root);
    if (!current)
        throw new Error('No active GJM session. Call gjm_session_start first.');
    const next = { ...current, ...patch };
    await fs.writeFile(sessionPath(root), JSON.stringify(next, null, 2) + '\n', 'utf8');
    return next;
}
export async function nextAttempt(root) {
    const current = await readSession(root);
    if (!current)
        throw new Error('No GJM session. Call gjm_session_start first.');
    if (current.status !== 'active')
        throw new Error(`GJM session is not active (${current.status}).`);
    const attempt = current.attempt + 1;
    if (attempt > current.maxAttempts) {
        const exhausted = await updateSession(root, { phase: 'max-attempts', lastCode: 'GJM-E302' });
        throw new Error(`Maximum GJM attempts exceeded (${exhausted.maxAttempts}).`);
    }
    return updateSession(root, { attempt, phase: 'attempt' });
}
export async function stopSession(root, status = 'stopped') {
    return updateSession(root, { status, phase: status });
}
//# sourceMappingURL=session.js.map