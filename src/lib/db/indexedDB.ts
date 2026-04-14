import { openDB, deleteDB, DBSchema, IDBPDatabase } from 'idb';

/**
 * IndexedDB Schema Definition
 */
interface OfflineDB extends DBSchema {
  // Active and completed workouts (offline)
  workouts: {
    key: string; // workoutId
    value: {
      id: string;
      userId: string;
      data: {
        exercises: any[];
        currentUnit: 'kg' | 'lb';
        workoutStartedAt: string;
        sessionMetrics?: any;
        startedAt: string;
        endedAt?: string;
        notes?: string;
      };
      createdAt: string;
      updatedAt: string;
      synced: boolean;
      deleted: boolean;
    };
    indexes: {
      'by-user': string;
      'by-synced': boolean;
      'by-user-synced': [string, boolean];
    };
  };

  // Queue of database operations to sync
  operations: {
    key: number; // Auto-increment
    value: {
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
    };
    indexes: {
      'by-workout': string;
      'by-synced': boolean;
      'by-user': string;
    };
  };

  // Cached exercise library (global + user custom)
  exercises: {
    key: string; // exerciseId
    value: any;
    indexes: {
      'by-user': string;
      'by-updated': string;
    };
  };

  // Cached workout templates
  templates: {
    key: string; // templateId
    value: any;
    indexes: {
      'by-user': string;
    };
  };

  // PR history for offline prefill
  prHistory: {
    key: string; // `${userId}-${exerciseId}`
    value: {
      userId: string;
      exerciseId: string;
      lastSession: {
        sets: any[];
        workoutDate: string;
      };
      prs: any[];
      updatedAt: string;
    };
  };

  // Workout history cache for offline prefill
  workout_history: {
    key: string; // `${userId}-${exerciseId}`
    value: {
      userId: string;
      exerciseId: string;
      exerciseName: string;
      lastSession: {
        workoutId: string | null;
        endedAt: string | null;
        sets: any[];
      };
      cachedAt: string;
    };
  };

  // Pending posts (with images as blobs)
  pendingPosts: {
    key: string; // postId
    value: {
      id: string;
      userId: string;
      workoutId: string;
      title: string;
      caption: string;
      imageBlobs: Blob[]; // Store actual image data
      isPrivate: boolean;
      showWorkoutDetails: boolean;
      createdAt: string;
      synced: boolean;
    };
    indexes: {
      'by-user': string;
      'by-synced': boolean;
      'by-user-synced': [string, boolean];
    };
  };

  // User profile cache for offline access
  user_profile: {
    key: string; // userId
    value: {
      userId: string;
      unit_default: 'kg' | 'lb';
      cachedAt: string;
    };
  };

  // Cached avatar blobs for persistent profile pictures
  avatar_cache: {
    key: string; // cacheKey (defaults to source URL)
    value: {
      cacheKey: string;
      sourceUrl: string;
      blob: Blob;
      updatedAt: string;
    };
    indexes: {
      'by-updated': string;
    };
  };

  // Cached exercise image blobs for offline workouts
  exercise_images: {
    key: string; // exerciseId
    value: {
      exerciseId: string;
      sourceUrl: string;
      blob: Blob;
      cachedAt: string;
    };
    indexes: {
      'by-cached': string;
    };
  };

  pendingImageDownloads: {
    key: string;
    value: {
      id: string;
      exerciseId: string;
      imageUrl: string;
      createdAt: string;
      attempts: number;
    };
    indexes: {
      'by-attempts': number;
    };
  };
}

let db: IDBPDatabase<OfflineDB> | null = null;

/**
 * Initialize IndexedDB with schema
 */
export const initDB = async (): Promise<IDBPDatabase<OfflineDB>> => {
  try {
    db = await openDB<OfflineDB>('weightstone-offline', 9, {
      upgrade(db, oldVersion, newVersion, transaction) {
        console.log('[IndexedDB] Upgrading schema:', { oldVersion, newVersion });

        // Version 1: Initial schema
        if (oldVersion < 1) {
        // Workouts store
        const workoutStore = db.createObjectStore('workouts', { keyPath: 'id' });
        workoutStore.createIndex('by-user', 'userId');
        workoutStore.createIndex('by-synced', 'synced');
        workoutStore.createIndex('by-user-synced', ['userId', 'synced']);

        // Operations queue
        const opsStore = db.createObjectStore('operations', {
          keyPath: 'id',
          autoIncrement: true
        });
        opsStore.createIndex('by-workout', 'workoutId');
        opsStore.createIndex('by-synced', 'synced');
        opsStore.createIndex('by-user', 'userId');

        // Exercises cache
        const exStore = db.createObjectStore('exercises', { keyPath: 'id' });
        exStore.createIndex('by-user', 'owner_user_id');
        exStore.createIndex('by-updated', 'updated_at');

        // Templates cache
        const tmplStore = db.createObjectStore('templates', { keyPath: 'id' });
        tmplStore.createIndex('by-user', 'user_id');

        // PR history cache
        db.createObjectStore('prHistory', { keyPath: 'key' });
      }

      // Version 2: Add pending posts
      if (oldVersion < 2 && oldVersion >= 1) {
        const postsStore = db.createObjectStore('pendingPosts', { keyPath: 'id' });
        postsStore.createIndex('by-user', 'userId');
        postsStore.createIndex('by-synced', 'synced');
      }

      // Version 3: Add workout history cache for offline prefill
      if (oldVersion < 3) {
        if (!db.objectStoreNames.contains('workout_history')) {
          db.createObjectStore('workout_history');
        }
      }

      // Version 4: Add composite index for pending posts
      if (oldVersion < 4) {
        const tx = transaction.objectStore('pendingPosts');
        if (!tx.indexNames.contains('by-user-synced')) {
          tx.createIndex('by-user-synced', ['userId', 'synced']);
        }
      }

      // Version 5: Add user profile cache
      if (oldVersion < 5) {
        if (!db.objectStoreNames.contains('user_profile')) {
          db.createObjectStore('user_profile', { keyPath: 'userId' });
        }
      }

      // Version 6: Add avatar cache store for persistent profile images
      if (oldVersion < 7) {
        if (!db.objectStoreNames.contains('avatar_cache')) {
          const avatarStore = db.createObjectStore('avatar_cache', { keyPath: 'cacheKey' });
          avatarStore.createIndex('by-updated', 'updatedAt');
        }
      }

      // Version 8: Add exercise_images store for offline exercise GIFs
      if (oldVersion < 8) {
        if (!db.objectStoreNames.contains('exercise_images')) {
          const exerciseImagesStore = db.createObjectStore('exercise_images', { keyPath: 'exerciseId' });
          exerciseImagesStore.createIndex('by-cached', 'cachedAt');
        }
      }

      // Version 9: Add pending image download queue
      if (oldVersion < 9) {
        if (!db.objectStoreNames.contains('pendingImageDownloads')) {
          const pendingImagesStore = db.createObjectStore('pendingImageDownloads', { keyPath: 'id' });
          pendingImagesStore.createIndex('by-attempts', 'attempts');
        }
      }
    },
    });
    return db;
  } catch (error) {
    console.error('[IndexedDB] Failed to initialize database:', error);

    // If upgrade fails, delete and recreate the database
    console.log('[IndexedDB] Attempting to delete and recreate database...');
    await deleteDB('weightstone-offline');

    // Retry initialization
    db = await openDB<OfflineDB>('weightstone-offline', 9, {
      upgrade(db, oldVersion, newVersion, transaction) {
        console.log('[IndexedDB] Creating fresh schema:', { oldVersion, newVersion });

        // Create all stores fresh
        const workoutStore = db.createObjectStore('workouts', { keyPath: 'id' });
        workoutStore.createIndex('by-user', 'userId');
        workoutStore.createIndex('by-synced', 'synced');
        workoutStore.createIndex('by-user-synced', ['userId', 'synced']);

        const opsStore = db.createObjectStore('operations', {
          keyPath: 'id',
          autoIncrement: true
        });
        opsStore.createIndex('by-workout', 'workoutId');
        opsStore.createIndex('by-synced', 'synced');
        opsStore.createIndex('by-user', 'userId');

        const exStore = db.createObjectStore('exercises', { keyPath: 'id' });
        exStore.createIndex('by-user', 'owner_user_id');
        exStore.createIndex('by-updated', 'updated_at');

        const tmplStore = db.createObjectStore('templates', { keyPath: 'id' });
        tmplStore.createIndex('by-user', 'user_id');

        db.createObjectStore('prHistory', { keyPath: 'key' });

        const postsStore = db.createObjectStore('pendingPosts', { keyPath: 'id' });
        postsStore.createIndex('by-user', 'userId');
        postsStore.createIndex('by-synced', 'synced');
        postsStore.createIndex('by-user-synced', ['userId', 'synced']);

        db.createObjectStore('workout_history');

        db.createObjectStore('user_profile', { keyPath: 'userId' });

        const avatarStore = db.createObjectStore('avatar_cache', { keyPath: 'cacheKey' });
        avatarStore.createIndex('by-updated', 'updatedAt');

        const exerciseImagesStore = db.createObjectStore('exercise_images', { keyPath: 'exerciseId' });
        exerciseImagesStore.createIndex('by-cached', 'cachedAt');

        const pendingImagesStore = db.createObjectStore('pendingImageDownloads', { keyPath: 'id' });
        pendingImagesStore.createIndex('by-attempts', 'attempts');
      },
    });

    console.log('[IndexedDB] Database recreated successfully');
    return db;
  }
};

// Track DB initialization promise to prevent race conditions
let dbInitPromise: Promise<IDBPDatabase<OfflineDB>> | null = null;

/**
 * Get database instance (initialize if needed)
 */
export const getDB = async (): Promise<IDBPDatabase<OfflineDB>> => {
  if (db) {
    return db;
  }

  // If initialization is in progress, wait for it
  if (dbInitPromise) {
    return dbInitPromise;
  }

  // Start initialization
  dbInitPromise = initDB();
  db = await dbInitPromise;
  dbInitPromise = null;
  return db;
};

/**
 * Clear all offline data (for testing or manual cleanup)
 */
export const clearAllOfflineData = async (userId: string) => {
  const db = await getDB();

  // Clear user's workouts
  const workouts = await db.getAllFromIndex('workouts', 'by-user', userId);
  for (const workout of workouts) {
    await db.delete('workouts', workout.id);
  }

  // Clear user's operations
  const ops = await db.getAllFromIndex('operations', 'by-user', userId);
  for (const op of ops) {
    await db.delete('operations', op.id!);
  }

  // Clear pending posts
  const posts = await db.getAllFromIndex('pendingPosts', 'by-user', userId);
  for (const post of posts) {
    await db.delete('pendingPosts', post.id);
  }

  console.log('[IndexedDB] Cleared all offline data for user:', userId);

  try {
    await db.clear('avatar_cache');
  } catch (error) {
    console.warn('[IndexedDB] Failed to clear avatar cache:', error);
  }
};

// ============================================================================
// SECURITY: Encrypted IndexedDB Operations
// ============================================================================

import {
  encryptRecord,
  decryptRecord,
  encryptRecords,
  decryptRecords,
  getEncryptionKeyForUser,
  clearEncryptionKeyCache,
  getStoresWithEncryption
} from './encryptedStorage';

/**
 * Put a record into IndexedDB with encryption for sensitive fields
 * SECURITY: Automatically encrypts sensitive fields before storage
 *
 * @param storeName - The IndexedDB store name
 * @param record - The record to store
 * @param userId - User ID for key derivation
 */
export async function putEncrypted<T extends Record<string, any>>(
  storeName: keyof OfflineDB,
  record: T,
  userId: string
): Promise<void> {
  const db = await getDB();
  const encryptionKey = await getEncryptionKeyForUser(userId);

  // Encrypt sensitive fields
  const encryptedRecord = await encryptRecord(storeName, record, encryptionKey);

  // Store in IndexedDB
  await db.put(storeName as any, encryptedRecord as any);
}

/**
 * Get a record from IndexedDB with decryption for sensitive fields
 * SECURITY: Automatically decrypts sensitive fields after retrieval
 *
 * @param storeName - The IndexedDB store name
 * @param key - The record key
 * @param userId - User ID for key derivation
 */
export async function getEncrypted<T extends Record<string, any>>(
  storeName: keyof OfflineDB,
  key: any,
  userId: string
): Promise<T | undefined> {
  const db = await getDB();
  const record = await db.get(storeName as any, key);

  if (!record) {
    return undefined;
  }

  const encryptionKey = await getEncryptionKeyForUser(userId);

  // Decrypt sensitive fields
  return await decryptRecord(storeName, record, encryptionKey) as T;
}

/**
 * Get all records from IndexedDB with decryption for sensitive fields
 * SECURITY: Automatically decrypts sensitive fields for all records
 *
 * @param storeName - The IndexedDB store name
 * @param userId - User ID for key derivation
 */
export async function getAllEncrypted<T extends Record<string, any>>(
  storeName: keyof OfflineDB,
  userId: string
): Promise<T[]> {
  const db = await getDB();
  const records = await db.getAll(storeName as any);

  if (records.length === 0) {
    return [];
  }

  const encryptionKey = await getEncryptionKeyForUser(userId);

  // Decrypt sensitive fields in all records
  return await decryptRecords(storeName, records, encryptionKey) as T[];
}

/**
 * Get records from an index with decryption for sensitive fields
 * SECURITY: Automatically decrypts sensitive fields for all records
 *
 * @param storeName - The IndexedDB store name
 * @param indexName - The index name
 * @param query - The query value
 * @param userId - User ID for key derivation
 */
export async function getAllFromIndexEncrypted<T extends Record<string, any>>(
  storeName: keyof OfflineDB,
  indexName: string,
  query: any,
  userId: string
): Promise<T[]> {
  const db = await getDB();
  const records = await db.getAllFromIndex(storeName as any, indexName, query);

  if (records.length === 0) {
    return [];
  }

  const encryptionKey = await getEncryptionKeyForUser(userId);

  // Decrypt sensitive fields in all records
  return await decryptRecords(storeName, records, encryptionKey) as T[];
}

/**
 * Clear encryption key cache (call on logout)
 * SECURITY: Ensures encryption keys are cleared from memory
 */
export function clearEncryptionCache(): void {
  clearEncryptionKeyCache();
}

/**
 * Get list of stores that have encryption enabled
 * Useful for migration and debugging
 */
export function getEncryptedStores(): string[] {
  return getStoresWithEncryption();
}

/**
 * Update clearAllOfflineData to also clear encryption cache
 */
const originalClearAllOfflineData = clearAllOfflineData;
export { originalClearAllOfflineData as clearAllOfflineDataWithoutEncryption };

// Override with encryption cache clearing
export const clearAllOfflineDataWithEncryption = async (userId: string) => {
  await originalClearAllOfflineData(userId);
  clearEncryptionCache();
};

export type { OfflineDB };
