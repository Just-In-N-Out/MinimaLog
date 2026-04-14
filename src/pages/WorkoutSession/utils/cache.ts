/**
 * cache.ts
 *
 * LocalStorage caching utilities for workout sessions.
 * Provides persistence across page refreshes and browser crashes.
 *
 * Performance Benefits:
 * - Instant restoration of workout state on page reload
 * - Prevents data loss during accidental navigation
 * - Debounced writes reduce localStorage contention
 *
 * Cache Structure:
 * {
 *   [userId]: {
 *     [workoutId]: {
 *       exercises: [...],
 *       currentUnit: "kg",
 *       workoutStartedAt: "ISO timestamp",
 *       updatedAt: "ISO timestamp"
 *     }
 *   }
 * }
 */

import type { CachedWorkoutSession, WeightUnit } from "../types";

export const WORKOUT_SESSION_CACHE_KEY = "weightstone:workout-session-cache:v1";

/**
 * Reads cached workout session from localStorage.
 * Handles malformed data gracefully with fallbacks.
 *
 * Why: Enables instant workout restoration after page refresh
 * Performance: Single localStorage read (fast, ~1ms)
 *
 * @param userId - User ID for cache isolation
 * @param workoutId - Workout ID to retrieve
 * @returns Cached session or null if not found/invalid
 */
export const readCachedWorkoutSession = (
  userId: string,
  workoutId: string
): CachedWorkoutSession | null => {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.localStorage.getItem(WORKOUT_SESSION_CACHE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed === null) return null;

    const userCache = parsed[userId];
    if (!userCache || typeof userCache !== "object") return null;

    const entry = userCache[workoutId];
    if (!entry || typeof entry !== "object") return null;

    // Normalize unit with fallback to kg
    const fallbackUnit: WeightUnit = entry.currentUnit === "lb" ? "lb" : "kg";

    // Normalize exercises and sets structure
    const exercises = Array.isArray(entry.exercises) ? entry.exercises : [];
    const normalizedExercises = exercises.map((exercise: any) => ({
      ...exercise,
      isUnilateral: Boolean(exercise.isUnilateral ?? exercise.is_unilateral),
      baseExerciseId:
        exercise.baseExerciseId ?? exercise.base_exercise_id ?? exercise.exercise_id,
      baseExerciseInfo: exercise.baseExerciseInfo ?? null,
      togglePending: false,
      // Preserve exercise metadata including image_url
      exercise: exercise.exercise ? {
        ...exercise.exercise,
        image_url: exercise.exercise.image_url ?? null,
      } : exercise.exercise,
      sets: Array.isArray(exercise.sets)
        ? exercise.sets.map((set: any) => ({
            ...set,
            unit: set?.unit === "lb" ? "lb" : fallbackUnit,
            is_unilateral: Boolean(set?.is_unilateral),
            // Handle snake_case to camelCase conversion
            leftWeight:
              typeof set?.leftWeight === "string"
                ? set.leftWeight
                : set?.left_weight?.toString() ?? "",
            rightWeight:
              typeof set?.rightWeight === "string"
                ? set.rightWeight
                : set?.right_weight?.toString() ?? "",
            leftReps:
              typeof set?.leftReps === "string" ? set.leftReps : set?.left_reps?.toString() ?? "",
            rightReps:
              typeof set?.rightReps === "string"
                ? set.rightReps
                : set?.right_reps?.toString() ?? "",
            leftRir:
              typeof set?.leftRir === "string" ? set.leftRir : set?.left_rir?.toString() ?? "",
            rightRir:
              typeof set?.rightRir === "string" ? set.rightRir : set?.right_rir?.toString() ?? "",
            // Preserve edit state flags (default to false to maintain prefilled styling)
            weightEdited: typeof set?.weightEdited === "boolean" ? set.weightEdited : false,
            repsEdited: typeof set?.repsEdited === "boolean" ? set.repsEdited : false,
            rirEdited: typeof set?.rirEdited === "boolean" ? set.rirEdited : false,
            warmupEdited: typeof set?.warmupEdited === "boolean" ? set.warmupEdited : false,
            lastSession: set?.lastSession
              ? {
                  ...set.lastSession,
                  unit: set?.lastSession?.unit === "lb" ? "lb" : "kg",
                }
              : undefined,
          }))
        : [],
    }));

    return {
      exercises: normalizedExercises,
      currentUnit: fallbackUnit,
      workoutStartedAt: typeof entry.workoutStartedAt === "string" ? entry.workoutStartedAt : "",
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
    };
  } catch (error) {
    console.warn("Failed to read cached workout session", error);
    return null;
  }
};

/**
 * Writes workout session to localStorage cache.
 * Should be called with debouncing to prevent excessive writes.
 *
 * Why: Preserves workout state across page refreshes
 * Performance: Single localStorage write (fast, ~2-5ms)
 * Note: Caller should implement debouncing (typically 400ms)
 *
 * @param userId - User ID for cache isolation
 * @param workoutId - Workout ID to cache
 * @param payload - Workout data to cache
 */
export const writeCachedWorkoutSession = (
  userId: string,
  workoutId: string,
  payload: Pick<CachedWorkoutSession, "exercises" | "currentUnit" | "workoutStartedAt">
) => {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(WORKOUT_SESSION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const base = parsed && typeof parsed === "object" && parsed !== null ? parsed : {};
    const userCache = base[userId] && typeof base[userId] === "object" ? base[userId] : {};

    // Create new cache entry with updated timestamp
    const nextUserCache = {
      ...userCache,
      [workoutId]: {
        exercises: payload.exercises,
        currentUnit: payload.currentUnit,
        workoutStartedAt: payload.workoutStartedAt,
        updatedAt: new Date().toISOString(),
      },
    };

    const next = { ...base, [userId]: nextUserCache };
    window.localStorage.setItem(WORKOUT_SESSION_CACHE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Failed to cache workout session", error);
  }
};

/**
 * Clears cached workout session from localStorage.
 * Should be called after successful workout completion.
 *
 * Why: Prevents stale cache from interfering with new workouts
 * Performance: Single localStorage operation
 * Cleanup: Removes empty user caches to prevent localStorage bloat
 *
 * @param userId - User ID
 * @param workoutId - Workout ID to clear
 */
export const clearCachedWorkoutSession = (userId: string, workoutId: string) => {
  if (typeof window === "undefined") return;

  try {
    const raw = window.localStorage.getItem(WORKOUT_SESSION_CACHE_KEY);
    if (!raw) return;

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || parsed === null) return;

    const userCache = parsed[userId];
    if (!userCache || typeof userCache !== "object") return;
    if (!userCache[workoutId]) return;

    // Remove this workout from user's cache
    const { [workoutId]: _removed, ...remainingSessions } = userCache;
    const next = { ...parsed, [userId]: remainingSessions };

    // Cleanup: remove user entry if no sessions remain
    const userHasSessions = Object.keys(remainingSessions).length > 0;
    if (!userHasSessions) {
      delete next[userId];
    }

    // Cleanup: remove entire cache key if no users remain
    if (Object.keys(next).length === 0) {
      window.localStorage.removeItem(WORKOUT_SESSION_CACHE_KEY);
    } else {
      window.localStorage.setItem(WORKOUT_SESSION_CACHE_KEY, JSON.stringify(next));
    }
  } catch (error) {
    console.warn("Failed to clear cached workout session", error);
  }
};
