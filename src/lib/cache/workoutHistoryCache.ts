import { getDB } from '@/lib/db/indexedDB';
import type { CompletedSession } from '@/lib/history';

/**
 * Cache last session data for exercises in IndexedDB
 * Used for offline prefill when historical data from Supabase is unavailable
 */

export interface CachedExerciseHistory {
  userId: string;
  exerciseId: string;
  exerciseName: string;
  lastSession: CompletedSession;
  cachedAt: string;
}

/**
 * Cache the last session data for an exercise
 * Call this when completing a workout (online mode)
 */
export const cacheExerciseHistory = async (
  userId: string,
  exerciseId: string,
  exerciseName: string,
  sessionData: CompletedSession,
  options?: { force?: boolean; skipIfExists?: boolean }
): Promise<void> => {
  try {
    const db = await getDB();
    const key = `${userId}-${exerciseId}`;
    const existing = await db.get('workout_history', key);
    const force = options?.force ?? false;
    const skipIfExists = options?.skipIfExists ?? false;

    if (!force) {
      if (skipIfExists && existing) {
        return;
      }

      if (
        existing?.lastSession?.workoutId &&
        sessionData?.workoutId &&
        existing.lastSession.workoutId === sessionData.workoutId
      ) {
        return;
      }
    }

    const cachedHistory: CachedExerciseHistory = {
      userId,
      exerciseId,
      exerciseName,
      lastSession: sessionData,
      cachedAt: new Date().toISOString(),
    };

    // Store with composite key: userId-exerciseId
    await db.put('workout_history', cachedHistory, key);

    console.log('[WorkoutHistoryCache] Cached exercise history:', exerciseId);
  } catch (error) {
    console.error('[WorkoutHistoryCache] Failed to cache exercise history:', error);
  }
};

/**
 * Get cached last session data for an exercise
 * Used for offline prefill
 */
export const getCachedExerciseHistory = async (
  userId: string,
  exerciseId: string
): Promise<CompletedSession | null> => {
  try {
    const db = await getDB();
    const cached = await db.get('workout_history', `${userId}-${exerciseId}`);

    if (cached) {
      console.log('[WorkoutHistoryCache] Retrieved cached history for:', exerciseId);
      return cached.lastSession;
    }

    return null;
  } catch (error) {
    console.error('[WorkoutHistoryCache] Failed to get cached history:', error);
    return null;
  }
};

/**
 * Cache history for multiple exercises at once
 * Call this when completing a workout
 */
export const cacheWorkoutHistory = async (
  userId: string,
  exercises: Array<{
    exerciseId: string;
    exerciseName: string;
    sessionData: CompletedSession;
  }>
): Promise<void> => {
  try {
    for (const ex of exercises) {
      await cacheExerciseHistory(userId, ex.exerciseId, ex.exerciseName, ex.sessionData, {
        force: true,
      });
    }
    console.log('[WorkoutHistoryCache] Cached history for', exercises.length, 'exercises');
  } catch (error) {
    console.error('[WorkoutHistoryCache] Failed to cache workout history:', error);
  }
};

/**
 * Clear old cached history (optional maintenance)
 * Can be called periodically to clean up old data
 */
export const clearOldHistory = async (daysToKeep: number = 90): Promise<void> => {
  try {
    const db = await getDB();
    const allHistory = await db.getAll('workout_history');

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

    for (const item of allHistory) {
      const cached = item as CachedExerciseHistory;
      if (new Date(cached.cachedAt) < cutoffDate) {
        await db.delete('workout_history', `${cached.userId}-${cached.exerciseId}`);
      }
    }

    console.log('[WorkoutHistoryCache] Cleared old history');
  } catch (error) {
    console.error('[WorkoutHistoryCache] Failed to clear old history:', error);
  }
};
