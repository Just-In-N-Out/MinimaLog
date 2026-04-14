import { getDB } from '@/lib/db/indexedDB';
import { supabase } from '@/integrations/supabase/client';
import { queueOperation } from '@/lib/db/operationQueue';

const CACHE_VERSION = 'images-v2';
const CACHE_VERSION_KEY = 'weightstone:exercise-cache-version';

/**
 * Cache all exercises (global + user custom) to IndexedDB
 * Call this on app start and periodically (daily)
 */
export const cacheExercises = async (userId: string): Promise<number> => {
  try {
    const db = await getDB();

    const PAGE_SIZE = 500;
    const allExercises: any[] = [];
    let from = 0;

    while (true) {
      const { data, error } = await supabase
        .from('exercises')
        .select('*')
        .or(`owner_user_id.is.null,owner_user_id.eq.${userId}`)
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw error;
      }

      if (!data || data.length === 0) {
        break;
      }

      allExercises.push(...data);

      if (data.length < PAGE_SIZE) {
        break;
      }

      from += PAGE_SIZE;
    }

    // Store in IndexedDB
    const tx = db.transaction('exercises', 'readwrite');
    for (const ex of allExercises) {
      await tx.store.put(ex);
    }
    await tx.done;

    console.log('[ExerciseCache] Cached exercises:', allExercises.length);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(CACHE_VERSION_KEY, CACHE_VERSION);
    }
    return allExercises.length;
  } catch (error) {
    console.error('[ExerciseCache] Failed to cache exercises:', error);
    return 0;
  }
};

/**
 * Get exercises from IndexedDB (for offline use)
 */
export const getExercisesOffline = async (userId: string): Promise<any[]> => {
  const db = await getDB();
  const all = await db.getAll('exercises');

  // Filter for global exercises + user's custom exercises
  return all.filter(ex =>
    !ex.owner_user_id || ex.owner_user_id === userId
  );
};

/**
 * Add custom exercise offline
 */
export const addCustomExerciseOffline = async (
  userId: string,
  exercise: any
): Promise<any> => {
  const db = await getDB();

  // Generate temporary ID
  const tempId = `temp-ex-${Date.now()}`;
  const offlineExercise = {
    ...exercise,
    id: tempId,
    owner_user_id: userId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  // Store in IndexedDB
  await db.put('exercises', offlineExercise);

  // Queue for sync
  await queueOperation({
    workoutId: 'N/A', // Not tied to specific workout
    type: 'insert',
    table: 'exercises',
    data: offlineExercise,
    timestamp: new Date().toISOString(),
    userId,
  });

  console.log('[ExerciseCache] Created custom exercise offline:', tempId);
  return offlineExercise;
};

/**
 * Check if exercise cache needs refresh (call on app start)
 */
export const shouldRefreshExerciseCache = async (): Promise<boolean> => {
  const db = await getDB();
  const exercises = await db.getAll('exercises');

  if (typeof window !== 'undefined') {
    const currentVersion = window.localStorage.getItem(CACHE_VERSION_KEY);
    if (currentVersion !== CACHE_VERSION) {
      return true;
    }
  }

  if (exercises.length === 0) return true;

  // Refresh if cache is older than 24 hours
  const oldestExercise = exercises.reduce((oldest, ex) => {
    const exDate = new Date(ex.updated_at || 0);
    const oldestDate = new Date(oldest.updated_at || 0);
    return exDate < oldestDate ? ex : oldest;
  }, exercises[0]);

  const cacheAge = Date.now() - new Date(oldestExercise.updated_at).getTime();
  const oneDayMs = 24 * 60 * 60 * 1000;

  return cacheAge > oneDayMs;
};
