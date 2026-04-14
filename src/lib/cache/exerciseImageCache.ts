import type { IDBPDatabase } from "idb";
import { getDB, type OfflineDB } from "@/lib/db/indexedDB";

const isBrowser = typeof window !== "undefined";

const EXERCISE_IMAGE_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 days
const EXERCISE_IMAGE_CACHE_MAX_ENTRIES = 2000; // Allow full catalog (~500-600MB)

export interface ExerciseImageCacheEntry {
  exerciseId: string;
  sourceUrl: string;
  blob: Blob;
  cachedAt: string;
}

/**
 * Get cached exercise image from IndexedDB
 */
export const getCachedExerciseImage = async (
  exerciseId: string
): Promise<ExerciseImageCacheEntry | null> => {
  if (!isBrowser || !exerciseId) return null;

  try {
    // Normalize ID to string for consistency
    const normalizedId = String(exerciseId);

    const db = await getDB();
    
    // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("exercise_images")) {
        return null;
      }
    } catch (error) {
      console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
      return null;
    }

    const entry = await db.get("exercise_images", normalizedId);
    if (!entry) return null;

    // Check if cache entry is expired
    const age = Date.now() - new Date(entry.cachedAt).getTime();
    if (age > EXERCISE_IMAGE_CACHE_TTL_MS) {
      // Delete expired entry
      await db.delete("exercise_images", normalizedId);
      return null;
    }

    return entry;
  } catch (error) {
    console.warn("[ExerciseImageCache] Failed to read entry:", error);
    return null;
  }
};

/**
 * Save exercise image blob to IndexedDB cache
 */
export const saveExerciseImageToCache = async (
  exerciseId: string,
  sourceUrl: string,
  blob: Blob
): Promise<void> => {
  if (!isBrowser || !exerciseId || !sourceUrl || !blob) return;

  try {
    // Normalize ID to string for consistency
    const normalizedId = String(exerciseId);

    const db = await getDB();
    
    // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("exercise_images")) {
        console.warn("[ExerciseImageCache] exercise_images store does not exist!");
        return;
      }
    } catch (error) {
      console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
      return;
    }

    const payload: ExerciseImageCacheEntry = {
      exerciseId: normalizedId,
      sourceUrl,
      blob,
      cachedAt: new Date().toISOString(),
    };

    await db.put("exercise_images", payload);
    console.log(`[ExerciseImageCache] Successfully saved to IndexedDB: ${normalizedId}`);

    // Prune old entries if we exceed the limit
    await pruneExerciseImageCache(db);
  } catch (error) {
    console.error(`[ExerciseImageCache] Failed to persist entry for ${exerciseId}:`, error);
    throw error; // Re-throw so we can track failures
  }
};

/**
 * Download exercise image from URL and cache it
 */
export const downloadAndCacheExerciseImage = async (
  exerciseId: string,
  imageUrl: string
): Promise<Blob | null> => {
  if (!isBrowser || !exerciseId || !imageUrl) return null;

  try {
    // Check if already cached
    const cached = await getCachedExerciseImage(exerciseId);
    if (cached) {
      return cached.blob;
    }

    // Use XMLHttpRequest instead of fetch to bypass CapacitorHttp issues with blobs
    // CapacitorHttp intercepts fetch and doesn't properly handle blob responses
    const blob = await new Promise<Blob>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', imageUrl, true);
      xhr.responseType = 'blob';

      xhr.onload = () => {
        if (xhr.status === 200) {
          resolve(xhr.response);
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Request timeout'));

      xhr.send();
    });

    // Verify blob has data
    if (!blob || blob.size === 0) {
      console.warn(`[ExerciseImageCache] Blob is empty for ${exerciseId}, URL: ${imageUrl}`);
      return null;
    }

    console.log(`[ExerciseImageCache] Downloaded image for ${exerciseId}: ${blob.size} bytes, type: ${blob.type}`);

    // Save to cache
    await saveExerciseImageToCache(exerciseId, imageUrl, blob);

    return blob;
  } catch (error) {
    console.warn(`[ExerciseImageCache] Failed to download and cache image for ${exerciseId}:`, error);
    return null;
  }
};

/**
 * Download all exercise images for offline use
 * Returns progress callback with (current, total)
 */
export const downloadAllExerciseImages = async (
  exercises: Array<{ id: string; image_url: string | null }>,
  onProgress?: (current: number, total: number) => void
): Promise<{ success: number; failed: number; skipped: number }> => {
  if (!isBrowser) {
    return { success: 0, failed: 0, skipped: 0 };
  }

  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Filter exercises that have image URLs
  const exercisesWithImages = exercises.filter(ex => ex.image_url);
  const total = exercisesWithImages.length;

  console.log(`[ExerciseImageCache] Starting download of ${total} exercise images...`);

  // Download in batches to avoid overwhelming the browser
  const BATCH_SIZE = 10;
  let batchNumber = 0;

  for (let i = 0; i < exercisesWithImages.length; i += BATCH_SIZE) {
    const batch = exercisesWithImages.slice(i, i + BATCH_SIZE);
    batchNumber++;
    console.log(`[ExerciseImageCache] Processing batch ${batchNumber} (${i}-${i + batch.length}/${total})`);

    await Promise.all(
      batch.map(async (exercise) => {
        try {
          // Normalize ID to string to ensure consistency
          const exerciseId = String(exercise.id);

          // Check if already cached
          const cached = await getCachedExerciseImage(exerciseId);
          if (cached) {
            skipped++;
            if (onProgress) onProgress(success + failed + skipped, total);
            return;
          }

          // Download and cache
          const blob = await downloadAndCacheExerciseImage(exerciseId, exercise.image_url!);
          if (blob) {
            success++;
            console.log(`[ExerciseImageCache] ✓ Downloaded ${exerciseId} (${success}/${total})`);
          } else {
            failed++;
            console.warn(`[ExerciseImageCache] ✗ Failed ${exerciseId}`);
          }
        } catch (error) {
          console.error(`[ExerciseImageCache] ✗ Error caching ${exercise.id}:`, error);
          failed++;
        }

        if (onProgress) onProgress(success + failed + skipped, total);
      })
    );
  }

  console.log(`[ExerciseImageCache] Download complete:`, { success, failed, skipped, total });

  // Verify what's actually in IndexedDB
  const db = await getDB();
  
  // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
  try {
    if (db.objectStoreNames.contains("exercise_images")) {
      const actualCount = await db.count("exercise_images");
      console.log(`[ExerciseImageCache] Actual count in IndexedDB: ${actualCount}`);
    }
  } catch (error) {
    console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
  }

  return { success, failed, skipped };
};

/**
 * Get cache statistics
 */
export const getExerciseImageCacheStats = async (): Promise<{
  count: number;
  estimatedSizeMB: number;
}> => {
  if (!isBrowser) {
    return { count: 0, estimatedSizeMB: 0 };
  }

  try {
    const db = await getDB();
    
    // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("exercise_images")) {
        console.warn("[ExerciseImageCache] exercise_images store does not exist in getStats");
        return { count: 0, estimatedSizeMB: 0 };
      }
    } catch (error) {
      console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
      return { count: 0, estimatedSizeMB: 0 };
    }

    const allEntries = await db.getAll("exercise_images");
    const count = allEntries.length;

    console.log(`[ExerciseImageCache] getStats: ${count} entries found`);
    if (count > 0 && count < 50) {
      // Log first few entries to see what's stored
      console.log("[ExerciseImageCache] Sample entries:", allEntries.slice(0, 5).map(e => ({
        id: e.exerciseId,
        url: e.sourceUrl?.substring(0, 50),
        blobSize: e.blob?.size
      })));
    }

    // Estimate size (average ~300KB per GIF)
    const estimatedSizeMB = Math.round((count * 300) / 1024 * 10) / 10;

    return { count, estimatedSizeMB };
  } catch (error) {
    console.error("[ExerciseImageCache] Failed to get stats:", error);
    return { count: 0, estimatedSizeMB: 0 };
  }
};

/**
 * Clear all cached exercise images
 */
export const clearExerciseImageCache = async (): Promise<void> => {
  if (!isBrowser) return;

  try {
    const db = await getDB();
    
    // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
    try {
      if (db.objectStoreNames.contains("exercise_images")) {
        await db.clear("exercise_images");
        console.log("[ExerciseImageCache] Cache cleared");
      }
    } catch (error) {
      console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
    }
  } catch (error) {
    console.warn("[ExerciseImageCache] Failed to clear cache:", error);
  }
};

/**
 * Remove old entries when cache exceeds max size (LRU pruning)
 */
const pruneExerciseImageCache = async (database?: IDBPDatabase<OfflineDB>): Promise<void> => {
  if (!isBrowser) return;

  try {
    const db = database ?? (await getDB());
    
    // SAFETY: Check if exercise_images store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("exercise_images")) {
        return;
      }
    } catch (error) {
      console.warn("[ExerciseImageCache] Error checking objectStoreNames:", error);
      return;
    }

    const total = await db.count("exercise_images");
    if (total <= EXERCISE_IMAGE_CACHE_MAX_ENTRIES) return;

    const excess = total - EXERCISE_IMAGE_CACHE_MAX_ENTRIES;

    // Delete oldest entries
    const tx = db.transaction("exercise_images", "readwrite");
    const index = tx.store.index("by-cached");

    let cursor = await index.openCursor(); // Opens cursor in ascending order (oldest first)
    let removed = 0;

    while (cursor && removed < excess) {
      await cursor.delete();
      removed += 1;
      cursor = await cursor.continue();
    }

    await tx.done;
    console.log(`[ExerciseImageCache] Pruned ${removed} old entries`);
  } catch (error) {
    console.warn("[ExerciseImageCache] Failed to prune cache:", error);
  }
};

export const __exerciseImageCacheInternals = {
  EXERCISE_IMAGE_CACHE_TTL_MS,
  EXERCISE_IMAGE_CACHE_MAX_ENTRIES,
};
