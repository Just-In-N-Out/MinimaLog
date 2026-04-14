import { getDB } from './indexedDB';
import { encryptRecord, decryptRecord, getEncryptionKeyForUser } from './encryptedStorage';

export interface QueuedOperation {
  id?: number;
  workoutId: string;
  type: 'insert' | 'update' | 'delete';
  table: string;
  data: any;
  timestamp: string;
  userId: string;
  synced: boolean;
  error?: string;
  retryCount?: number;
}

/**
 * Add operation to sync queue
 * SECURITY: Encrypts the data field before storing
 */
export const queueOperation = async (
  op: Omit<QueuedOperation, 'id' | 'synced' | 'retryCount'>
): Promise<number> => {
  const db = await getDB();
  const encryptionKey = await getEncryptionKeyForUser(op.userId);

  const operationToQueue = {
    ...op,
    synced: false,
    retryCount: 0,
  };

  // Encrypt sensitive fields (data field) before storing
  const encryptedOperation = await encryptRecord('operations', operationToQueue, encryptionKey);

  const id = await db.add('operations', encryptedOperation);
  console.log('[OperationQueue] Queued operation:', { id, type: op.type, table: op.table });
  return id;
};

/**
 * Get all pending operations for a user (sorted by timestamp)
 * SECURITY: Decrypts the data field after retrieval
 */
export const getPendingOperations = async (userId: string): Promise<QueuedOperation[]> => {
  const db = await getDB();
  const encryptionKey = await getEncryptionKeyForUser(userId);

  // Get all operations for the user, then filter by synced status
  // This avoids issues with boolean index queries
  const userOps = await db.getAllFromIndex('operations', 'by-user', userId);
  const pendingOps = userOps.filter(op => !op.synced);

  // Decrypt sensitive fields (data field) in all operations
  const decryptedOps = await Promise.all(
    pendingOps.map(op => decryptRecord('operations', op, encryptionKey))
  );

  // Sort by timestamp (oldest first)
  return decryptedOps.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
};

/**
 * Mark operation as successfully synced
 */
export const markOperationSynced = async (id: number): Promise<void> => {
  const db = await getDB();
  const op = await db.get('operations', id);
  if (op) {
    op.synced = true;
    await db.put('operations', op);
    console.log('[OperationQueue] Marked operation as synced:', id);
  }
};

/**
 * Mark operation as failed with error
 */
export const markOperationError = async (id: number, error: string): Promise<void> => {
  const db = await getDB();
  const op = await db.get('operations', id);
  if (op) {
    op.error = error;
    op.retryCount = (op.retryCount || 0) + 1;
    await db.put('operations', op);
    console.error('[OperationQueue] Operation failed:', { id, error, retryCount: op.retryCount });
  }
};

/**
 * Clear old synced operations (cleanup)
 */
export const clearSyncedOperations = async (beforeDate: string): Promise<number> => {
  const db = await getDB();

  // Get all operations, then filter by synced status and date
  // This avoids issues with boolean index queries
  const allOps = await db.getAll('operations');
  const oldSyncedOps = allOps.filter(op => op.synced && op.timestamp < beforeDate);

  for (const op of oldSyncedOps) {
    await db.delete('operations', op.id!);
  }

  console.log('[OperationQueue] Cleared old synced operations:', oldSyncedOps.length);
  return oldSyncedOps.length;
};

/**
 * Get pending operation count for UI badge
 */
export const getPendingOperationCount = async (userId: string): Promise<number> => {
  const ops = await getPendingOperations(userId);
  return ops.length;
};

const referencesAnyId = (data: any, ids: Set<string>): boolean => {
  if (!data || ids.size === 0) return false;
  const candidates = [
    data.id,
    data.workout_id,
    data.workoutId,
    data.workout_exercise_id,
    data.workoutExerciseId,
    data.exercise_id,
    data.parent_id,
    data.set_id,
  ];
  return candidates.some((value) => value && ids.has(String(value)));
};

/**
 * Remove queued operations that reference specific temp IDs.
 * Useful when optimistic items are deleted before syncing.
 * SECURITY: Decrypts data field to check references
 */
export const removeQueuedOperationsForIds = async (
  workoutId: string,
  targetIds: string[],
  userId: string
): Promise<number> => {
  if (!workoutId || targetIds.length === 0) {
    return 0;
  }

  const ids = new Set(targetIds.map((id) => String(id)));
  const db = await getDB();
  const encryptionKey = await getEncryptionKeyForUser(userId);
  const operations = await db.getAllFromIndex('operations', 'by-workout', workoutId);
  let removed = 0;

  for (const op of operations) {
    if (op.id === undefined) continue;

    // Decrypt the operation to check references in the data field
    const decryptedOp = await decryptRecord('operations', op, encryptionKey);

    if (referencesAnyId(decryptedOp.data, ids)) {
      await db.delete('operations', op.id);
      removed++;
    }
  }

  if (removed > 0) {
    console.log('[OperationQueue] Removed queued operations referencing IDs:', {
      workoutId,
      ids: Array.from(ids),
      removed,
    });
  }

  return removed;
};
