import { supabase } from '@/integrations/supabase/client';
import {
  getPendingOperations,
  markOperationSynced,
  markOperationError,
  QueuedOperation,
} from '@/lib/db/operationQueue';
import { getDB } from '@/lib/db/indexedDB';
import { Network, type PluginListenerHandle } from '@capacitor/network';
import { Capacitor } from '@capacitor/core';

export interface SyncResult {
  success: number;
  failed: number;
  skipped: number;
  errors: Array<{ operation: QueuedOperation; error: string }>;
  idMappings: Map<string, string>; // temp ID -> real ID mappings
}

/**
 * Main sync function - processes all pending operations
 */
export const syncOfflineData = async (userId: string): Promise<SyncResult> => {
  // Map temp IDs to real IDs (for cross-operation references and UI updates)
  const idMap = new Map<string, string>();

  const results: SyncResult = {
    success: 0,
    failed: 0,
    skipped: 0,
    errors: [],
    idMappings: idMap,
  };

  try {
    // Get all pending operations sorted by timestamp
    const operations = await getPendingOperations(userId);

    if (operations.length === 0) {
      console.log('[SyncEngine] No pending operations');
      return results;
    }

    console.log(`[SyncEngine] Syncing ${operations.length} operations`);

    // Process operations sequentially (order matters)
    for (const op of operations) {
      try {
        // Skip if retry count too high
        if (op.retryCount && op.retryCount > 5) {
          console.warn('[SyncEngine] Skipping operation (too many retries):', op.id);
          results.skipped++;
          continue;
        }

        // Resolve temp IDs in operation data
        const resolvedData = resolveTempIds(op.data, idMap);

        // Execute operation based on type
        let realId: string | null = null;

        switch (op.type) {
          case 'insert':
            realId = await syncInsertOperation(op, resolvedData);
            break;
          case 'update':
            await syncUpdateOperation(op, resolvedData);
            break;
          case 'delete':
            await syncDeleteOperation(op, resolvedData);
            break;
        }

        // Track ID mapping for temp IDs
        const dataIdStr = op.data.id?.toString() || '';
        const isTempId = dataIdStr.startsWith('temp-') || dataIdStr.includes('-template-');

        if (realId && op.data.id && isTempId) {
          idMap.set(op.data.id.toString(), realId);
          console.log('[SyncEngine] Mapped temp ID:', { tempId: op.data.id.toString(), realId });
        }

        // Mark as synced
        await markOperationSynced(op.id!);
        results.success++;

        console.log('[SyncEngine] Synced operation:', {
          id: op.id,
          type: op.type,
          table: op.table,
        });
      } catch (error: any) {
        console.error('[SyncEngine] Operation failed:', {
          operation: op,
          error: error.message,
        });

        await markOperationError(op.id!, error.message);
        results.failed++;
        results.errors.push({ operation: op, error: error.message });
      }
    }

    // Update workout sync status if all operations succeeded
    if (results.failed === 0) {
      await markWorkoutsSynced(userId);
    }

    // Notify listeners (UI) about completed sync so local caches can reconcile IDs
    if (typeof window !== 'undefined' && (results.success > 0 || idMap.size > 0)) {
      try {
        window.dispatchEvent(
          new CustomEvent('sync-complete', {
            detail: {
              success: results.success,
              failed: results.failed,
              idMappings: Object.fromEntries(idMap),
            },
          })
        );
      } catch (eventError) {
        console.warn('[SyncEngine] Failed to dispatch sync-complete event:', eventError);
      }
    }

    console.log('[SyncEngine] Sync complete:', results);
    return results;
  } catch (error: any) {
    console.error('[SyncEngine] Sync failed:', error);
    throw error;
  }
};

/**
 * Sync INSERT operation
 */
const syncInsertOperation = async (
  op: QueuedOperation,
  data: any
): Promise<string | null> => {
  // Remove temp ID before inserting
  const insertData = { ...data };
  const idStr = insertData.id?.toString() || '';

  // Check if this is a temp ID:
  // - Starts with 'temp-' (sets, PRs, etc)
  // - Contains '-template-' (workout_exercises from templates)
  const isTempId = idStr.startsWith('temp-') || idStr.includes('-template-');

  if (insertData.id && isTempId) {
    delete insertData.id;
  }

  const { data: result, error } = await supabase
    .from(op.table)
    .insert(insertData)
    .select('id')
    .single();

  if (error) throw error;

  return result?.id?.toString() || null;
};

/**
 * Sync UPDATE operation
 */
const syncUpdateOperation = async (
  op: QueuedOperation,
  data: any
): Promise<void> => {
  const { id, ...updates } = data;

  const { error } = await supabase
    .from(op.table)
    .update(updates)
    .eq('id', id);

  if (error) throw error;
};

/**
 * Sync DELETE operation
 */
const syncDeleteOperation = async (
  op: QueuedOperation,
  data: any
): Promise<void> => {
  const { error } = await supabase
    .from(op.table)
    .delete()
    .eq('id', data.id);

  if (error) throw error;
};

/**
 * Resolve temporary IDs to real IDs using ID map
 */
const resolveTempIds = (data: any, idMap: Map<string, string>): any => {
  if (!data) return data;

  const resolved = { ...data };

  // Check all ID fields
  const idFields = ['id', 'workout_id', 'exercise_id', 'workout_exercise_id', 'template_id'];

  for (const field of idFields) {
    if (resolved[field] && typeof resolved[field] === 'string') {
      const tempId = resolved[field];
      if ((tempId.startsWith('temp-') || tempId.includes('-template-')) && idMap.has(tempId)) {
        resolved[field] = idMap.get(tempId);
        console.log('[SyncEngine] Resolved temp ID:', { field, tempId, realId: resolved[field] });
      }
    }
  }

  return resolved;
};

/**
 * Mark all user's workouts as synced in IndexedDB
 */
const markWorkoutsSynced = async (userId: string): Promise<void> => {
  const db = await getDB();

  // Get all workouts for user, then filter by synced status
  // This avoids issues with composite index queries on boolean values
  const allWorkouts = await db.getAllFromIndex('workouts', 'by-user', userId);
  const unsyncedWorkouts = allWorkouts.filter(w => !w.synced);

  for (const workout of unsyncedWorkouts) {
    workout.synced = true;
    await db.put('workouts', workout);
  }

  console.log('[SyncEngine] Marked workouts as synced:', unsyncedWorkouts.length);
};

// Auto-sync listener handle
let autoSyncListenerHandle: PluginListenerHandle | null = null;

/**
 * Auto-sync on network reconnection or quality improvement
 */
export const setupAutoSync = (userId: string) => {
  const triggerSync = async () => {
    console.log('[SyncEngine] Network quality improved, starting auto-sync');
    try {
      // Sync workout data first
      const result = await syncOfflineData(userId);

      // Then sync pending posts (after workouts are synced)
      if (result.success > 0) {
        const postsSynced = await syncPendingPosts(userId);
        console.log(`[SyncEngine] Synced ${postsSynced} pending posts`);
      }

      // Show notification
      if (result.success > 0) {
        // Trigger toast notification (handled by UI component)
        window.dispatchEvent(new CustomEvent('sync-complete', {
          detail: result
        }));
      }
    } catch (error) {
      console.error('[SyncEngine] Auto-sync failed:', error);
    }
  };

  const isNative = Capacitor.isNativePlatform();

  if (isNative) {
    // On native platforms, listen to Capacitor Network plugin
    // This catches cellular→WiFi transitions that don't fire browser 'online' event
    Network.addListener('networkStatusChange', async (status) => {
      console.log('[SyncEngine] Network status changed:', status);

      // Trigger sync when connection becomes available or improves to high quality
      // Note: iOS returns 'cellular' for all cellular connections (3G/4G/5G)
      const highQualityTypes = ['wifi', 'cellular', '3g', '4g', '5g', 'ethernet'];
      const isHighQuality = highQualityTypes.includes(status.connectionType.toLowerCase());

      if (status.connected && isHighQuality) {
        await triggerSync();
      }
    }).then(handle => {
      autoSyncListenerHandle = handle;
      console.log('[SyncEngine] Capacitor network listener registered');
    }).catch(error => {
      console.error('[SyncEngine] Failed to register Capacitor listener:', error);
    });
  } else {
    // On web, use browser's online event (fallback)
    window.addEventListener('online', triggerSync);
    console.log('[SyncEngine] Browser online listener registered');
  }
};

/**
 * Cleanup sync listeners (call on logout or app close)
 */
export const cleanupAutoSync = async () => {
  if (autoSyncListenerHandle) {
    await autoSyncListenerHandle.remove();
    autoSyncListenerHandle = null;
    console.log('[SyncEngine] Removed Capacitor network listener');
  }
};

/**
 * Sync pending posts with image uploads
 */
export const syncPendingPosts = async (userId: string): Promise<number> => {
  const db = await getDB();

  // Get all posts for user, then filter by synced status
  // This avoids issues with composite index queries on boolean values
  const allPosts = await db.getAllFromIndex('pendingPosts', 'by-user', userId);
  const pendingPosts = allPosts.filter(p => !p.synced);

  let syncedCount = 0;

  if (pendingPosts.length === 0) {
    console.log('[PostSync] No pending posts to sync');
    return 0;
  }

  console.log(`[PostSync] Found ${pendingPosts.length} pending posts to sync`);

  for (const post of pendingPosts) {
    try {
      // Check if workout exists in Supabase now
      const { data: workoutExists } = await supabase
        .from('workouts')
        .select('id')
        .eq('id', post.workoutId)
        .single();

      if (!workoutExists) {
        console.log(`[PostSync] Workout ${post.workoutId} not synced yet, skipping post ${post.id}`);
        continue;
      }

      console.log(`[PostSync] Syncing post ${post.id} for workout ${post.workoutId}`);

      // Upload images first
      const imageUrls: string[] = [];

      if (post.imageBlobs && post.imageBlobs.length > 0) {
        for (let i = 0; i < post.imageBlobs.length; i++) {
          const blob = post.imageBlobs[i];
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 9);
          const fileName = `${post.userId}/${timestamp}-${i}-${randomSuffix}.jpeg`;

          // Upload to Supabase Storage
          const { error: uploadError } = await supabase.storage
            .from('post-images')
            .upload(fileName, blob, {
              contentType: 'image/jpeg',
              upsert: false,
            });

          if (uploadError) {
            console.error(`[PostSync] Failed to upload image ${i}:`, uploadError);
            throw uploadError;
          }

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('post-images')
            .getPublicUrl(fileName);

          imageUrls.push(urlData.publicUrl);
        }
      }

      // Create post with image URLs
      const { data: createdPost, error: postError } = await supabase
        .from('posts')
        .insert({
          user_id: post.userId,
          workout_id: post.workoutId,
          title: post.title,
          caption: post.caption || null,
          image_urls: imageUrls.length > 0 ? imageUrls : null,
          show_workout_details: post.showWorkoutDetails,
        })
        .select()
        .single();

      if (postError) throw postError;

      // Remove from IndexedDB (synced successfully)
      await db.delete('pendingPosts', post.id);

      syncedCount++;
      console.log(`[PostSync] Successfully synced post ${post.id}`);

      // Dispatch event to refresh feed
      window.dispatchEvent(
        new CustomEvent('post:created', {
          detail: { postId: createdPost.id, workoutId: post.workoutId }
        })
      );
    } catch (error: any) {
      console.error('[PostSync] Failed to sync post:', post.id, error);
    }
  }

  console.log(`[PostSync] Synced ${syncedCount} posts`);
  return syncedCount;
};
