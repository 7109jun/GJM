import { createSnapshot, restoreSnapshot, deleteSnapshot } from './snapshots.js';
import { doAnything, type AnyStep } from './ai-anything.js';

export interface TransactionRequest {
  projectRoot: string;
  steps: AnyStep[];
  keepSnapshot?: boolean;
}

export async function runTransaction(input: TransactionRequest) {
  const snapshot = await createSnapshot(input.projectRoot, 'transaction');
  try {
    const result = await doAnything({
      projectRoot: input.projectRoot,
      steps: input.steps,
      snapshot: false,
      stopOnError: true,
      rollbackOnError: false
    });
    if (!result.ok) {
      await restoreSnapshot(input.projectRoot, snapshot.id);
      return { ...result, transactional: true, committed: false, rolledBack: true, snapshot };
    }
    if (input.keepSnapshot !== true) await deleteSnapshot(input.projectRoot, snapshot.id);
    return { ...result, transactional: true, committed: true, rolledBack: false, snapshot: input.keepSnapshot === true ? snapshot : undefined };
  } catch (error) {
    await restoreSnapshot(input.projectRoot, snapshot.id);
    return { ok: false, transactional: true, committed: false, rolledBack: true, snapshot, error: error instanceof Error ? error.message : String(error) };
  }
}
