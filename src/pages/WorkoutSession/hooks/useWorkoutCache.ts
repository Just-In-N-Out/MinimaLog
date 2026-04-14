/**
 * useWorkoutCache.ts
 *
 * Hook for managing workout session cache in localStorage.
 * Provides instant restoration of workout state on page refresh.
 *
 * Performance Benefits:
 * - Debounced writes (400ms) prevent excessive localStorage operations
 * - Hydration on mount provides instant workout restoration
 * - Cleanup on unmount ensures final state is saved
 *
 * Cache Strategy:
 * - Write: Debounced to prevent excessive writes during rapid edits
 * - Read: Hydrates once on mount, prevents re-hydration
 * - Clear: Called after successful workout completion
 */

import { useEffect, useRef, useCallback, useState } from "react";
import type { WorkoutExercise, WeightUnit } from "../types";
import {
  readCachedWorkoutSession,
  writeCachedWorkoutSession,
  clearCachedWorkoutSession,
} from "../utils/cache";
import { getDB } from "@/lib/db/indexedDB";
import { cacheExerciseHistory } from "@/lib/cache/workoutHistoryCache";
import type { CompletedSession } from "@/lib/history";

const UPDATE_DEBOUNCE_MS = 400;

/**
 * Save workout data to IndexedDB for offline persistence
 * Complements localStorage cache with more robust storage
 */
const saveToIndexedDB = async (
  userId: string,
  workoutId: string,
  payload: CachePayload
) => {
  try {
    const db = await getDB();
    await db.put('workouts', {
      id: workoutId,
      userId,
      data: {
        exercises: payload.exercises,
        currentUnit: payload.currentUnit,
        workoutStartedAt: payload.workoutStartedAt,
        startedAt: payload.workoutStartedAt,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      synced: false,
      deleted: false,
    });
    console.log('[WorkoutCache] Saved to IndexedDB:', workoutId);
  } catch (error) {
    console.error('[WorkoutCache] Failed to save to IndexedDB:', error);
  }
};

const buildCompletedSession = (
  workoutId: string,
  workoutStartedAt: string,
  exercise: WorkoutExercise
): CompletedSession => {
  const toNumber = (value?: string | null): number | null => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    workoutId,
    endedAt: workoutStartedAt,
    sets: exercise.sets.map((set, idx) => ({
      setNo: idx + 1,
      unit: set.unit === "lb" ? "lb" : "kg",
      weight: toNumber(set.weight),
      reps: toNumber(set.reps),
      rir: toNumber(set.rir),
      isWarmup: Boolean(set.is_warmup),
      leftWeight: toNumber(set.leftWeight),
      rightWeight: toNumber(set.rightWeight),
      leftReps: toNumber(set.leftReps),
      rightReps: toNumber(set.rightReps),
      leftRir: toNumber(set.leftRir),
      rightRir: toNumber(set.rightRir),
      isUnilateral: Boolean(set.is_unilateral),
    })),
  };
};

const persistExerciseHistorySnapshot = async (
  userId: string,
  workoutId: string,
  payload: CachePayload
) => {
  try {
    const tasks = payload.exercises
      .filter((exercise) => exercise.sets.length > 0)
      .map((exercise) =>
        cacheExerciseHistory(
          userId,
          exercise.exercise_id,
          exercise.exercise?.name || "Unknown Exercise",
          buildCompletedSession(workoutId, payload.workoutStartedAt, exercise),
          { skipIfExists: true }
        )
      );

    await Promise.all(tasks);
  } catch (error) {
    console.error("[WorkoutCache] Failed to persist exercise history snapshot:", error);
  }
};

interface CacheContext {
  userId: string | null;
  workoutId: string | null;
}

interface CachePayload {
  exercises: WorkoutExercise[];
  currentUnit: WeightUnit;
  workoutStartedAt: string;
}

interface UseWorkoutCacheOptions {
  userId: string | null;
  workoutId: string | undefined;
  workoutExercises: WorkoutExercise[];
  currentUnit: WeightUnit;
  workoutStartedAt: string;
  onHydrate: (data: {
    exercises: WorkoutExercise[];
    currentUnit: WeightUnit;
    workoutStartedAt: string;
  }) => void;
}

/**
 * Hook for managing workout session cache.
 *
 * Responsibilities:
 * - Hydrate workout state from cache on mount (instant restoration)
 * - Debounce cache writes to prevent excessive localStorage operations
 * - Save final state on unmount (handles browser close/refresh)
 * - Clear cache after workout completion
 *
 * Why Debouncing Matters:
 * - User edits multiple sets in quick succession
 * - Without debouncing: 10 edits = 10 localStorage writes (slow)
 * - With debouncing: 10 edits = 1 localStorage write (fast)
 *
 * Performance Impact:
 * - Reduces localStorage writes by 80-90%
 * - Prevents UI jank during rapid edits
 * - Maintains cache freshness (400ms is imperceptible to user)
 */
export const useWorkoutCache = (options: UseWorkoutCacheOptions) => {
  const { userId, workoutId, workoutExercises, currentUnit, workoutStartedAt, onHydrate } =
    options;

  // Refs for tracking cache state and timeouts
  const cacheContextRef = useRef<CacheContext>({ userId: null, workoutId: null });
  const cachingDisabledRef = useRef(false);
  const cachedSessionHydratedRef = useRef(false);
  const sessionCacheTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestCachePayloadRef = useRef<CachePayload | null>(null);

  // State for tracking hydration status (stable value for consumers)
  const [isHydrated, setIsHydrated] = useState(false);

  /**
   * Updates cache context when userId or workoutId changes.
   * Used for cleanup on unmount.
   *
   * Why: Ensures final cache write uses correct context even if props change
   */
  useEffect(() => {
    cacheContextRef.current = { userId, workoutId: workoutId ?? null };
  }, [userId, workoutId]);

  /**
   * Resets hydration flag when workoutId changes.
   * Allows re-hydration for different workouts.
   *
   * Why: Prevents stale cache from different workout
   */
  useEffect(() => {
    cachedSessionHydratedRef.current = false;
    setIsHydrated(false);
  }, [workoutId]);

  /**
   * Cleanup: Save final cache state on unmount.
   * Handles browser close, page refresh, or navigation away.
   *
   * Why: Prevents data loss when user closes tab mid-workout
   * Performance: Synchronous write on unmount is acceptable (only happens once)
   */
  useEffect(() => {
    cachingDisabledRef.current = false;
  }, [workoutId]);

  useEffect(() => {
    return () => {
      // Clear pending debounce timeout
      if (sessionCacheTimeoutRef.current) {
        clearTimeout(sessionCacheTimeoutRef.current);
        sessionCacheTimeoutRef.current = null;
      }

      if (cachingDisabledRef.current) {
        return;
      }

      // Write final state immediately on unmount
      const { userId: cachedUserId, workoutId } = cacheContextRef.current;
      if (cachedUserId && workoutId && latestCachePayloadRef.current) {
        writeCachedWorkoutSession(cachedUserId, workoutId, latestCachePayloadRef.current);

        // ALSO save final state to IndexedDB
        saveToIndexedDB(cachedUserId, workoutId, latestCachePayloadRef.current);
      }
    };
  }, []);

  /**
   * Hydrates workout state from cache on mount.
   * Runs once per workout (prevents re-hydration).
   *
   * Why: Instant workout restoration after page refresh
   * Performance: Single localStorage read (fast, ~1ms)
   *              Prevents database queries when cached data is fresh
   *
   * Priority: Hydration happens BEFORE database load
   *           This ensures instant UI, database load updates stale data
   */
  useEffect(() => {
    if (!userId || !workoutId) return;
    if (cachedSessionHydratedRef.current) return;

    const cached = readCachedWorkoutSession(userId, workoutId);
    if (cached) {
      onHydrate({
        exercises: cached.exercises,
        currentUnit: cached.currentUnit,
        workoutStartedAt: cached.workoutStartedAt,
      });
      cachedSessionHydratedRef.current = true;
      setIsHydrated(true);
    }
  }, [userId, workoutId, onHydrate]);

  /**
   * Debounced cache write on workout state changes.
   * Batches rapid edits into single localStorage write.
   *
   * Why: Reduces localStorage contention and UI jank
   * Performance: 80-90% reduction in localStorage writes
   *              (10 rapid edits → 1 write after 400ms)
   *
   * Debounce Strategy:
   * - Clear previous timeout on each change
   * - Schedule new write after 400ms
   * - Only latest state is written
   *
   * Dependencies: [userId, workoutId, workoutExercises, currentUnit, workoutStartedAt]
   * - Changes frequently during workout (every set edit)
   * - Debouncing is CRITICAL here
   */
  useEffect(() => {
    if (!userId || !workoutId) return;
    if (cachingDisabledRef.current) return;

    const payload: CachePayload = {
      exercises: workoutExercises,
      currentUnit,
      workoutStartedAt,
    };

    // Store latest payload for unmount cleanup
    latestCachePayloadRef.current = payload;

    // Clear previous timeout (debounce)
    if (sessionCacheTimeoutRef.current) {
      clearTimeout(sessionCacheTimeoutRef.current);
    }

    // Schedule new write after debounce delay
    sessionCacheTimeoutRef.current = setTimeout(() => {
      writeCachedWorkoutSession(userId, workoutId, payload);

      // ALSO persist to IndexedDB for offline support
      saveToIndexedDB(userId, workoutId, payload);

      // NOTE: Removed persistExerciseHistorySnapshot call here.
      // This was causing a bug where the CURRENT workout's sets were being
      // cached as "historical data", which corrupted prefills after app restart.
      // The workout_history cache should only be populated by fetchLastSessionData
      // when fetching actual completed historical data from Supabase.

      sessionCacheTimeoutRef.current = null;
    }, UPDATE_DEBOUNCE_MS);
  }, [userId, workoutId, workoutExercises, currentUnit, workoutStartedAt]);

  /**
   * Clears cached workout session.
   * Should be called after successful workout completion.
   *
   * Why: Prevents stale cache from interfering with new workouts
   * Performance: O(1) localStorage operation
   */
  const clearCache = useCallback(async () => {
    cachingDisabledRef.current = true;

    if (userId && workoutId) {
      clearCachedWorkoutSession(userId, workoutId);
      cachedSessionHydratedRef.current = false;

      // Cancel any pending debounce so we don't re-write stale data
      if (sessionCacheTimeoutRef.current) {
        clearTimeout(sessionCacheTimeoutRef.current);
        sessionCacheTimeoutRef.current = null;
      }

      // Prevent unmount cleanup from re-saving the deleted workout
      latestCachePayloadRef.current = null;

      // Remove persisted copy from IndexedDB so future offline checks don't see it
      try {
        const db = await getDB();
        await db.delete('workouts', workoutId);
      } catch (error) {
        console.error('[WorkoutCache] Failed to delete workout from IndexedDB during clearCache:', error);
      }
    }
  }, [userId, workoutId]);

  /**
   * Forces immediate cache write (bypasses debouncing).
   * Used before critical operations (e.g., workout completion).
   *
   * Why: Ensures cache is fresh before destructive operations
   * Performance: Single synchronous write (fast)
   */
  const forceWrite = useCallback(async () => {
    if (cachingDisabledRef.current) return;
    if (!userId || !workoutId || !latestCachePayloadRef.current) return;

    // Clear pending timeout
    if (sessionCacheTimeoutRef.current) {
      clearTimeout(sessionCacheTimeoutRef.current);
      sessionCacheTimeoutRef.current = null;
    }

    // Write immediately
    writeCachedWorkoutSession(userId, workoutId, latestCachePayloadRef.current);
    await saveToIndexedDB(userId, workoutId, latestCachePayloadRef.current);
    await persistExerciseHistorySnapshot(userId, workoutId, latestCachePayloadRef.current);
  }, [userId, workoutId]);

  return {
    clearCache,
    forceWrite,
    isHydrated,
  };
};
