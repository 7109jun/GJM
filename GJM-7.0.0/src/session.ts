import fs from 'node:fs/promises';
import path from 'node:path';

export interface GjmSession {
  id: string;
  startedAt: string;
  status: 'active' | 'completed' | 'failed' | 'stopped';
  attempt: number;
  maxAttempts: number;
  phase: string;
  lastCode?: string;
}

function sessionPath(root: string): string {
  return path.join(root, '.gjm_last_session.json');
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function startSession(root: string, maxAttempts = 5): Promise<GjmSession> {
  const session: GjmSession = {
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

export async function readSession(root: string): Promise<GjmSession | null> {
  try {
    return JSON.parse(await fs.readFile(sessionPath(root), 'utf8')) as GjmSession;
  } catch {
    return null;
  }
}

export async function updateSession(root: string, patch: Partial<GjmSession>): Promise<GjmSession> {
  const current = await readSession(root);
  if (!current) throw new Error('No active GJM session. Call gjm_session_start first.');
  const next = { ...current, ...patch };
  await fs.writeFile(sessionPath(root), JSON.stringify(next, null, 2) + '\n', 'utf8');
  return next;
}

export async function nextAttempt(root: string): Promise<GjmSession> {
  const current = await readSession(root);
  if (!current) throw new Error('No GJM session. Call gjm_session_start first.');
  if (current.status !== 'active') throw new Error(`GJM session is not active (${current.status}).`);
  const attempt = current.attempt + 1;
  if (attempt > current.maxAttempts) {
    const exhausted = await updateSession(root, { phase: 'max-attempts', lastCode: 'GJM-E302' });
    throw new Error(`Maximum GJM attempts exceeded (${exhausted.maxAttempts}).`);
  }
  return updateSession(root, { attempt, phase: 'attempt' });
}

export async function stopSession(root: string, status: Exclude<GjmSession['status'], 'active'> = 'stopped'): Promise<GjmSession> {
  return updateSession(root, { status, phase: status });
}
