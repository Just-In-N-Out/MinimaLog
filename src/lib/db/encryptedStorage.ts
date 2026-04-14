/**
 * Encrypted IndexedDB Storage Wrapper
 *
 * Provides selective encryption for sensitive data in IndexedDB
 * SECURITY: Encrypts sensitive fields while keeping lookup keys in plaintext
 */

import { deriveKeyFromUserId } from '../crypto';

// Fields that should be encrypted in each store
const ENCRYPTED_FIELDS: Record<string, string[]> = {
  workouts: [], // Workout metadata doesn't contain sensitive info
  workout_exercises: [], // Exercise metadata is not sensitive
  sets: [], // Set data (reps, weight) is not considered sensitive PII
  operations: ['data'], // Sync operations might contain sensitive data
  user_profile: ['email', 'ai_tips_consent'], // Profile data that's sensitive
  avatar_cache: ['blob'], // Cached avatar images
  prHistory: [], // Personal records are workout data, not PII
  pendingPosts: ['image_blob'], // Image blobs in pending posts
  exercise_cache: [], // Exercise definitions are not sensitive
  exercise_images: ['blob'], // Cached exercise images
};

/**
 * Check if a field should be encrypted for a given store
 */
function shouldEncryptField(storeName: string, fieldName: string): boolean {
  const encryptedFields = ENCRYPTED_FIELDS[storeName] || [];
  return encryptedFields.includes(fieldName);
}

/**
 * Encrypt sensitive fields in an object
 * Only encrypts fields specified in ENCRYPTED_FIELDS for the store
 * If encryptionKey is null (WebCrypto unavailable), returns record unencrypted
 */
export async function encryptRecord<T extends Record<string, any>>(
  storeName: string,
  record: T,
  encryptionKey: CryptoKey | null
): Promise<T> {
  const encryptedFields = ENCRYPTED_FIELDS[storeName] || [];

  // If no fields need encryption, return as-is
  if (encryptedFields.length === 0) {
    return record;
  }

  // If encryption key is null (WebCrypto unavailable), return unencrypted
  if (!encryptionKey) {
    console.warn(`[EncryptedStorage] Storing ${storeName} record unencrypted (WebCrypto unavailable)`);
    return record;
  }

  const result = { ...record };

  // Import encryption function only when needed
  const { encryptObject } = await import('../crypto');

  // Encrypt each specified field
  for (const field of encryptedFields) {
    if (field in result && result[field] != null) {
      try {
        // Store encrypted data with a marker
        result[field] = await encryptObject(
          { _encrypted: true, value: result[field] },
          encryptionKey
        );
      } catch (error) {
        console.error(`Failed to encrypt field ${field}:`, error);
        // Keep original value if encryption fails
      }
    }
  }

  return result;
}

/**
 * Decrypt sensitive fields in an object
 * Only decrypts fields specified in ENCRYPTED_FIELDS for the store
 * If encryptionKey is null (WebCrypto unavailable), returns record as-is (unencrypted)
 */
export async function decryptRecord<T extends Record<string, any>>(
  storeName: string,
  record: T,
  encryptionKey: CryptoKey | null
): Promise<T> {
  const encryptedFields = ENCRYPTED_FIELDS[storeName] || [];

  // If no fields need decryption, return as-is
  if (encryptedFields.length === 0) {
    return record;
  }

  // If encryption key is null (WebCrypto unavailable), return as-is (unencrypted)
  if (!encryptionKey) {
    console.warn(`[EncryptedStorage] Reading ${storeName} record as unencrypted (WebCrypto unavailable)`);
    return record;
  }

  const result = { ...record };

  // Import decryption function only when needed
  const { decryptObject } = await import('../crypto');

  // Decrypt each specified field
  for (const field of encryptedFields) {
    if (field in result && typeof result[field] === 'string') {
      try {
        const decrypted = await decryptObject<{ _encrypted?: boolean; value: any }>(
          result[field],
          encryptionKey
        );

        // Verify it was actually encrypted
        if (decrypted._encrypted) {
          result[field] = decrypted.value;
        }
      } catch (error) {
        // If decryption fails, the field might not be encrypted yet (migration case)
        // Keep the original value
        console.warn(`Field ${field} could not be decrypted, using as-is`);
      }
    }
  }

  return result;
}

/**
 * Encrypt an array of records
 * If encryptionKey is null (WebCrypto unavailable), returns records unencrypted
 */
export async function encryptRecords<T extends Record<string, any>>(
  storeName: string,
  records: T[],
  encryptionKey: CryptoKey | null
): Promise<T[]> {
  // Process in batches to avoid blocking the main thread
  const batchSize = 10;
  const results: T[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const encryptedBatch = await Promise.all(
      batch.map(record => encryptRecord(storeName, record, encryptionKey))
    );
    results.push(...encryptedBatch);

    // Yield to the event loop every batch
    if (i + batchSize < records.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
}

/**
 * Decrypt an array of records
 * If encryptionKey is null (WebCrypto unavailable), returns records as-is (unencrypted)
 */
export async function decryptRecords<T extends Record<string, any>>(
  storeName: string,
  records: T[],
  encryptionKey: CryptoKey | null
): Promise<T[]> {
  // Process in batches to avoid blocking the main thread
  const batchSize = 10;
  const results: T[] = [];

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const decryptedBatch = await Promise.all(
      batch.map(record => decryptRecord(storeName, record, encryptionKey))
    );
    results.push(...decryptedBatch);

    // Yield to the event loop every batch
    if (i + batchSize < records.length) {
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  return results;
}

/**
 * Get or create encryption key for the current user
 * Uses user ID to derive a consistent key
 * Returns null if WebCrypto is unavailable
 */
let cachedEncryptionKey: CryptoKey | null = null;
let cachedUserId: string | null = null;

export async function getEncryptionKeyForUser(userId: string): Promise<CryptoKey | null> {
  // Return cached key if it's for the same user
  if (cachedUserId === userId) {
    return cachedEncryptionKey;
  }

  // Derive new key from user ID
  const key = await deriveKeyFromUserId(userId);

  if (!key) {
    console.warn('[EncryptedStorage] WebCrypto unavailable, encryption will be disabled');
  }

  // Cache the key (may be null)
  cachedEncryptionKey = key;
  cachedUserId = userId;

  return key;
}

/**
 * Clear cached encryption key (call on logout)
 */
export function clearEncryptionKeyCache(): void {
  cachedEncryptionKey = null;
  cachedUserId = null;
}

/**
 * Migration helper: Check if a record needs encryption
 * Returns true if the record has unencrypted sensitive fields
 */
export function recordNeedsEncryption(storeName: string, record: Record<string, any>): boolean {
  const encryptedFields = ENCRYPTED_FIELDS[storeName] || [];

  if (encryptedFields.length === 0) {
    return false;
  }

  // Check if any sensitive field exists and is not encrypted
  for (const field of encryptedFields) {
    if (field in record && record[field] != null) {
      // If it's not a string, it's definitely not encrypted
      if (typeof record[field] !== 'string') {
        return true;
      }
      // If it's a string but can't be base64 decoded, it might not be encrypted
      // We'll be conservative and assume it needs encryption
      return true;
    }
  }

  return false;
}

/**
 * Get list of stores that have encrypted fields
 */
export function getStoresWithEncryption(): string[] {
  return Object.entries(ENCRYPTED_FIELDS)
    .filter(([_, fields]) => fields.length > 0)
    .map(([storeName, _]) => storeName);
}
