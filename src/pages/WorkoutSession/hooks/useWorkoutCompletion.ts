/**
 * useWorkoutCompletion.ts
 *
 * Hook for workout completion, termination, and template saving operations.
 * Handles the final state of a workout session.
 *
 * What This Hook Should Do:
 * 1. Complete Workout:
 *    - Mark workout as ended
 *    - Batch PR detection for big three lifts (squat, bench, deadlift)
 *    - Calculate session metrics
 *    - Trigger completion overview
 *    - Clear cache
 *
 * 2. Terminate Workout:
 *    - Delete workout and all related data (exercises, sets, metrics)
 *    - Parallel deletions for performance
 *    - Clear cache
 *    - Navigate home
 *    - Dispatch cancellation event
 *
 * 3. Save as Template:
 *    - Create workout template from current exercises
 *    - Copy exercise order and structure
 *    - Navigate to templates page
 *
 * 4. Weight Conversion:
 *    - Convert all sets in exercise between kg/lb
 *    - Update unilateral sets separately
 *    - Preserve precision
 *
 * TODO: Extract from original file
 * Locations:
 * - handleCompleteWorkout: lines 2768-2862
 * - handleTerminateWorkout: lines 2890-2967
 * - handleSaveTemplate: lines 2701-2766
 * - handleWeightConvert: lines 2519-2699
 *
 * @see INTEGRATION_EXAMPLE.md for usage patterns
 */

import { useCallback, useRef, startTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { checkForPRsBatch, savePRsBatch } from "@/lib/prDetection";
import type { WorkoutExercise, WeightUnit } from "../types";
import { convertWeight } from "@/lib/conversions";
import { stopLiveActivity } from "@/lib/liveActivity";
import {
  aggregateUnilateralWeight,
  aggregateUnilateralReps,
  aggregateUnilateralRir,
  parseNumericString,
  formatNumericString
} from "../utils/aggregations";
import { shouldUseOfflineMode } from "@/lib/network";
import { queueOperation } from "@/lib/db/operationQueue";
import { getDB } from "@/lib/db/indexedDB";
import { downloadAndCacheExerciseImageToFilesystem } from "@/lib/cache/exerciseImageFilesystemCache";
import { fetchLastCompletedSets } from "@/lib/history";

const hasMeaningfulValues = (set?: WorkoutExercise["lastSessionSets"] extends (infer U)[] ? U : never) => {
  if (!set) return false;
  const fields = [
    set.weight,
    set.reps,
    set.rir,
    set.leftWeight,
    set.rightWeight,
    set.leftReps,
    set.rightReps,
    set.leftRir,
    set.rightRir,
  ];
  return fields.some((value) => value !== null && value !== undefined && String(value).trim() !== "");
};

const mergeLastSessionSets = (
  current: WorkoutExercise["lastSessionSets"] | undefined,
  fallback: WorkoutExercise["lastSessionSets"] | undefined
): WorkoutExercise["lastSessionSets"] => {
  if ((!current || current.length === 0) && fallback) {
    return fallback;
  }
  if (!fallback || fallback.length === 0) {
    return current ?? [];
  }

  const maxLen = Math.max(current?.length ?? 0, fallback.length);
  const merged: WorkoutExercise["lastSessionSets"] = [];

  for (let i = 0; i < maxLen; i++) {
    const existing = current?.[i];
    const candidate = fallback[i];

    if (hasMeaningfulValues(existing)) {
      merged.push(existing!);
      continue;
    }

    if (hasMeaningfulValues(candidate)) {
      merged.push(candidate);
      continue;
    }

    if (existing) {
      merged.push(existing);
    } else if (candidate) {
      merged.push(candidate);
    }
  }

  return merged;
};

const mapCachedHistorySet = (set: any) => ({
  weight:
    set?.weight !== null && set?.weight !== undefined ? String(set.weight) : "",
  reps: set?.reps !== null && set?.reps !== undefined ? String(set.reps) : "",
  rir: set?.rir !== null && set?.rir !== undefined ? String(set.rir) : "",
  isWarmup: Boolean(set?.isWarmup),
  unit: set?.unit ?? undefined,
  isUnilateral: Boolean(set?.isUnilateral),
  leftWeight:
    set?.leftWeight !== null && set?.leftWeight !== undefined
      ? String(set.leftWeight)
      : "",
  rightWeight:
    set?.rightWeight !== null && set?.rightWeight !== undefined
      ? String(set.rightWeight)
      : "",
  leftReps:
    set?.leftReps !== null && set?.leftReps !== undefined
      ? String(set.leftReps)
      : "",
  rightReps:
    set?.rightReps !== null && set?.rightReps !== undefined
      ? String(set.rightReps)
      : "",
  leftRir:
    set?.leftRir !== null && set?.leftRir !== undefined
      ? String(set.leftRir)
      : "",
  rightRir:
    set?.rightRir !== null && set?.rightRir !== undefined
      ? String(set.rightRir)
      : "",
});

// Constants for session storage
const HOME_SUPPRESSED_STORAGE_KEY = "weightstone:suppressed-active-workouts";
const SUPPRESS_TTL_MS = 10 * 60 * 1000;

const suppressWorkoutId = (workoutId: string) => {
  if (typeof window === "undefined" || !workoutId) return;

  try {
    const stored = sessionStorage.getItem(HOME_SUPPRESSED_STORAGE_KEY);
    const now = Date.now();
    let entries: Array<[string, number]> = [];

    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) {
        entries = parsed.filter(
          (entry: any) =>
            Array.isArray(entry) &&
            typeof entry[0] === "string" &&
            typeof entry[1] === "number" &&
            entry[1] > now &&
            entry[0] !== workoutId
        );
      }
    }

    entries.push([String(workoutId), now + SUPPRESS_TTL_MS]);
    sessionStorage.setItem(HOME_SUPPRESSED_STORAGE_KEY, JSON.stringify(entries));
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[WorkoutCompletion] Failed to suppress workout id:", error);
    }
  }
};

/**
 * Calculate estimated 1RM using Brzycki formula
 */
const calculateEst1RM = (weight: number, reps: number): number => {
  if (reps === 1) return weight;
  // Brzycki formula: weight × (36 / (37 − reps))
  return weight * (36 / (37 - reps));
};

/**
 * Detect PRs offline using cached PR history
 */
const detectPRsOffline = async (
  workoutExercises: WorkoutExercise[],
  userId: string
): Promise<any[]> => {
  const db = await getDB();
  const prs: any[] = [];

  for (const we of workoutExercises) {
    if (!we.sets || we.sets.length === 0) continue;

    // Get cached PR history
    const cacheKey = `${userId}-${we.exercise_id}`;
    const prCache = await db.get('prHistory', cacheKey);

    for (const set of we.sets) {
      if (set.is_warmup) continue;

      const weight = parseFloat(set.weight);
      const reps = parseInt(set.reps);

      if (!weight || !reps) continue;

      // Calculate estimated 1RM
      const est1rm = calculateEst1RM(weight, reps);

      // Check if this is a PR compared to cached history
      const isPR = !prCache ||
                   !prCache.prs.some((p: any) =>
                     p.reps === reps && p.weight >= weight
                   );

      if (isPR) {
        prs.push({
          id: `temp-pr-${Date.now()}-${Math.random()}`,
          user_id: userId,
          exercise_id: we.exercise_id,
          reps: reps,
          weight: weight,
          unit: set.unit,
          est_1rm: est1rm,
          estimate_formula: 'brzycki',
          achieved_at: new Date().toISOString(),
        });
      }
    }
  }

  return prs;
};

interface UseWorkoutCompletionOptions {
  workoutId: string;
  userId: string | null;
  workoutExercises: WorkoutExercise[];
  workoutExercisesRef: React.RefObject<WorkoutExercise[]>;
  currentUnit: WeightUnit;
  workoutStartedAt: string | null;
  setWorkoutExercises: React.Dispatch<React.SetStateAction<WorkoutExercise[]>>;
  setShowCompletionOverview: (show: boolean) => void;
  setShowCreatePost: (show: boolean) => void;
  setShowSaveTemplate: (show: boolean) => void;
  setNewPrCount: (count: number) => void;
  setTemplateName: (name: string) => void;
  setSaving: (saving: boolean) => void;
  setSliderValue: (value: number) => void;
  setCompletedExercises: (exercises: WorkoutExercise[]) => void;
  clearCache: () => Promise<void>;
  forceWrite: () => Promise<void>;
  navigate: (path: string) => void;
  getAuthContext: () => Promise<{ user: any; accessToken: string } | null>;
  toast: any;
  resolveUserId: () => Promise<string | null>;
}

export const useWorkoutCompletion = (options: UseWorkoutCompletionOptions) => {
  const {
    workoutId,
    userId,
    workoutExercises,
    workoutExercisesRef,
    currentUnit,
    workoutStartedAt,
    setWorkoutExercises,
    setShowCompletionOverview,
    setShowCreatePost,
    setShowSaveTemplate,
    setNewPrCount,
    setTemplateName,
    setSaving,
    setSliderValue,
    setCompletedExercises,
    clearCache,
    forceWrite,
    navigate,
    getAuthContext,
    toast,
    resolveUserId,
  } = options;

  const getOfflineUserId = useCallback(async (): Promise<string | null> => {
    if (userId) {
      return userId;
    }
    try {
      const fallback = await resolveUserId();
      if (fallback) {
        return fallback;
      }
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('[WorkoutCompletion] Failed to resolve userId for offline op:', error);
      }
    }
    return null;
  }, [userId, resolveUserId]);

  const ensureOfflineLastSessionData = useCallback(
    async (exercises: WorkoutExercise[]): Promise<WorkoutExercise[]> => {
      const resolvedUserId = userId ?? (await getOfflineUserId());
      if (!resolvedUserId || exercises.length === 0) {
        return exercises;
      }

      try {
        const { getCachedExerciseHistory } = await import('@/lib/cache/workoutHistoryCache');
        const updateMap = new Map<string, WorkoutExercise["lastSessionSets"]>();

        for (const exercise of exercises) {
          const cachedHistory = await getCachedExerciseHistory(resolvedUserId, exercise.exercise_id);
          const isSameWorkoutHistory =
            cachedHistory?.workoutId && workoutId
              ? String(cachedHistory.workoutId) === String(workoutId)
              : false;

          if (isSameWorkoutHistory) {
            if (import.meta.env.DEV) {
              console.log('[WorkoutCompletion] Skipping cached history from current workout', {
                workoutId,
                exerciseId: exercise.exercise_id,
              });
            }
            continue;
          }
          if (cachedHistory && Array.isArray(cachedHistory.sets) && cachedHistory.sets.length > 0) {
            const fallbackSets = [...cachedHistory.sets]
              .sort((a, b) => {
                const aNo = typeof a?.setNo === 'number' ? a.setNo : 0;
                const bNo = typeof b?.setNo === 'number' ? b.setNo : 0;
                return aNo - bNo;
              })
              .map(mapCachedHistorySet);
            const merged = mergeLastSessionSets(exercise.lastSessionSets, fallbackSets);
            if (merged.length > 0) {
              updateMap.set(String(exercise.id), merged);
            }
          }
        }

        if (updateMap.size === 0) {
          return exercises;
        }

        const enriched = exercises.map((exercise) => {
          const mappedSets = updateMap.get(String(exercise.id));
          if (!mappedSets) return exercise;
          return {
            ...exercise,
            lastSessionSets: mappedSets,
          };
        });

        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((exercise) => {
              const mappedSets = updateMap.get(String(exercise.id));
              if (!mappedSets) return exercise;
              return {
                ...exercise,
                lastSessionSets: mappedSets,
              };
            })
          );
        });

        return enriched;
      } catch (error) {
        console.error('[WorkoutCompletion] Failed to hydrate cached history:', error);
        return exercises;
      }
    },
    [userId, setWorkoutExercises, getOfflineUserId]
  );

  const ensureOnlineLastSessionData = useCallback(
    async (exercises: WorkoutExercise[]): Promise<WorkoutExercise[]> => {
      const resolvedUserId = userId ?? (await getOfflineUserId());
      if (!resolvedUserId || exercises.length === 0) {
        if (import.meta.env.DEV) {
          console.log('[WorkoutCompletion] ensureOnlineLastSessionData: No userId or empty exercises', {
            resolvedUserId,
            exercisesCount: exercises.length,
          });
        }
        return exercises;
      }

      if (import.meta.env.DEV) {
        console.log('[WorkoutCompletion] ensureOnlineLastSessionData: Starting fetch for', exercises.length, 'exercises', {
          workoutStartedAt,
        });
      }

      try {
        const updateMap = new Map<string, WorkoutExercise["lastSessionSets"]>();

        // Fetch last session data for each exercise
        for (const exercise of exercises) {
          // Skip if exercise already has last session data
          if (exercise.lastSessionSets && exercise.lastSessionSets.length > 0) {
            if (import.meta.env.DEV) {
              console.log('[WorkoutCompletion] Skipping exercise - already has lastSessionSets:', exercise.exercise.name);
            }
            continue;
          }

          if (import.meta.env.DEV) {
            console.log('[WorkoutCompletion] Fetching lastSessionSets for:', exercise.exercise.name, exercise.exercise_id);
          }

          try {
            const snapshot = await fetchLastCompletedSets({
              supabase,
              userId: resolvedUserId,
              exerciseId: exercise.exercise_id,
              beforeDate: workoutStartedAt || undefined,
              context: "workout_completion",
              variant: exercise.isUnilateral ? "unilateral" : "bilateral",
            });

            if (import.meta.env.DEV) {
              console.log('[WorkoutCompletion] Fetched snapshot for', exercise.exercise.name, ':', {
                hasSnapshot: !!snapshot,
                hasSets: !!snapshot?.sets,
                setsLength: snapshot?.sets?.length || 0,
                workoutId: snapshot?.workoutId,
                endedAt: snapshot?.endedAt,
                setsArray: snapshot?.sets
              });
            }

            if (snapshot && snapshot.sets && snapshot.sets.length > 0) {
              const orderedSets = [...snapshot.sets].sort((a, b) => a.setNo - b.setNo);

              const toStringOrEmpty = (value: number | null, allowZero = false) => {
                if (value === null || value === undefined) return "";
                if (!allowZero && value === 0) return "";
                if (!Number.isFinite(value)) return "";
                return value.toString();
              };

              const lastSessionSets = orderedSets.map((set) => ({
                weight: toStringOrEmpty(set.weight),
                reps: toStringOrEmpty(set.reps),
                rir: toStringOrEmpty(set.rir, true),
                isWarmup: set.isWarmup,
                unit: set.unit ?? undefined,
                isUnilateral: set.isUnilateral,
                leftWeight: toStringOrEmpty(set.leftWeight),
                rightWeight: toStringOrEmpty(set.rightWeight),
                leftReps: toStringOrEmpty(set.leftReps),
                rightReps: toStringOrEmpty(set.rightReps),
                leftRir: toStringOrEmpty(set.leftRir, true),
                rightRir: toStringOrEmpty(set.rightRir, true),
              }));

              updateMap.set(String(exercise.id), lastSessionSets);
            }
          } catch (error) {
            if (import.meta.env.DEV) {
              console.warn('[WorkoutCompletion] Failed to fetch last session for exercise:', {
                exerciseId: exercise.exercise_id,
                error,
              });
            }
          }
        }

        if (updateMap.size === 0) {
          if (import.meta.env.DEV) {
            console.log('[WorkoutCompletion] No lastSessionSets data fetched - updateMap is empty');
          }
          return exercises;
        }

        const enriched = exercises.map((exercise) => {
          const mappedSets = updateMap.get(String(exercise.id));
          if (!mappedSets) return exercise;
          return {
            ...exercise,
            lastSessionSets: mappedSets,
          };
        });

        if (import.meta.env.DEV) {
          console.log('[WorkoutCompletion] Successfully enriched exercises with lastSessionSets:', {
            totalExercises: exercises.length,
            enrichedCount: updateMap.size,
            enrichedExercises: enriched.map(ex => ({
              name: ex.exercise.name,
              hasLastSessionSets: ex.lastSessionSets && ex.lastSessionSets.length > 0,
              lastSessionSetsCount: ex.lastSessionSets?.length || 0,
            })),
          });
        }

        return enriched;
      } catch (error) {
        console.error('[WorkoutCompletion] Failed to fetch online last session data:', error);
        return exercises;
      }
    },
    [userId, getOfflineUserId, workoutId, workoutStartedAt]
  );

  /**
   * Completes the current workout.
   *
   * Critical Features:
   * - Batch PR detection (checkForPRsBatch, savePRsBatch) online
   * - Client-side PR detection offline using cached history
   * - Session metrics calculation
   * - Cache management (forceWrite → clear)
   * - Completion overview trigger
   * - Error handling with offline fallback
   *
   * @returns Promise that resolves when workout is completed
   */
  const handleCompleteWorkout = useCallback(async () => {
    setSaving(true);
    try {
      const useOffline = shouldUseOfflineMode();
      let auth = await getAuthContext();

      // When offline we may not have a live Supabase session; that's fine
      if (!auth && !useOffline) {
        return;
      }

      if (!workoutId) throw new Error("Missing workout identifier");
      const resolvedUserId = userId ?? (await getOfflineUserId());
      if (!resolvedUserId) throw new Error("Missing user identifier");

      const now = new Date().toISOString();
      const baseExercises = workoutExercisesRef.current ? [...workoutExercisesRef.current] : [];
      const exercisesForSnapshot = useOffline
        ? await ensureOfflineLastSessionData(baseExercises)
        : await ensureOnlineLastSessionData(baseExercises);

      const snapshotExercises =
        exercisesForSnapshot.map((exercise) => ({
          ...exercise,
          sets: exercise.sets.map((set) => ({ ...set })),
          lastSessionSets: exercise.lastSessionSets?.map((set) => ({ ...set })) ?? [],
        })) || [];

      if (import.meta.env.DEV) {
        console.log('[WorkoutCompletion] Setting completed exercises snapshot:', {
          count: snapshotExercises.length,
          exercises: snapshotExercises.map(ex => ({
            name: ex.exercise.name,
            setsCount: ex.sets.length,
            lastSessionSetsCount: ex.lastSessionSets?.length || 0,
            hasLastSessionData: ex.lastSessionSets && ex.lastSessionSets.length > 0,
          })),
        });
      }

      setCompletedExercises(snapshotExercises);

      if (useOffline) {
        // OFFLINE COMPLETION
        try {
          const effectiveUserId = userId ?? (await getOfflineUserId());
          if (!effectiveUserId) {
            throw new Error('User ID required for offline completion');
          }
          // 1. Update workout end time in IndexedDB
          const db = await getDB();
          const workout = await db.get('workouts', workoutId);
          if (workout) {
            workout.data.endedAt = now;
            workout.updatedAt = now;
            await db.put('workouts', workout);
          }

          // 2. Cache workout history for future offline prefill
          const { cacheWorkoutHistory } = await import('@/lib/cache/workoutHistoryCache');
          const exercisesToCache = workoutExercises
            .filter(we => we.sets && we.sets.length > 0)
            .map(we => ({
              exerciseId: we.exercise_id,
              exerciseName: we.exercise?.name || 'Unknown Exercise',
              sessionData: {
                workoutId,
                endedAt: now,
                sets: we.sets.map((s, idx) => ({
                  setNo: idx + 1,
                  weight: s.weight ? parseFloat(s.weight) : null,
                  reps: s.reps ? parseInt(s.reps) : null,
                  rir: s.rir ? parseInt(s.rir) : null,
                  isWarmup: s.is_warmup || false,
                  unit: s.unit || 'kg',
                  leftWeight: s.leftWeight ? parseFloat(s.leftWeight) : null,
                  rightWeight: s.rightWeight ? parseFloat(s.rightWeight) : null,
                  leftReps: s.leftReps ? parseInt(s.leftReps) : null,
                  rightReps: s.rightReps ? parseInt(s.rightReps) : null,
                  leftRir: s.leftRir ? parseInt(s.leftRir) : null,
                  rightRir: s.rightRir ? parseInt(s.rightRir) : null,
                  isUnilateral: s.is_unilateral || false,
                })),
              },
            }));

          // Cache history immediately for offline prefill
          // Note: CompletionOverview reads from lastSessionSets (already in memory)
          // so we can safely cache the NEW data without overwriting the display
          await cacheWorkoutHistory(effectiveUserId, exercisesToCache);
          console.log('[WorkoutCompletion] Cached history for offline prefill:', {
            exerciseCount: exercisesToCache.length,
            exercises: exercisesToCache.map(e => ({
              name: e.exerciseName,
              setsCount: e.sessionData.sets.length,
              sets: e.sessionData.sets,
            })),
          });

          // 3. Queue workout completion operation
          await queueOperation({
            workoutId,
            type: 'update',
            table: 'workouts',
            data: {
              id: workoutId,
              ended_at: now,
            },
            timestamp: now,
            userId: effectiveUserId,
          });

          // 4. Client-side PR detection (using cached PR history)
          const detectedPRs = await detectPRsOffline(workoutExercises, effectiveUserId);

          console.log('[WorkoutCompletion] Detected PRs offline:', detectedPRs.length);

          // 4. Queue PR insertions
          for (const pr of detectedPRs) {
            await queueOperation({
              workoutId,
              type: 'insert',
              table: 'prs',
              data: pr,
              timestamp: now,
              userId: effectiveUserId,
            });
          }

          // 5. Cache exercise images for all exercises in the posted workout (background, non-blocking)
          const exercisesToCacheImages = workoutExercises.filter(
            we => we.exercise?.image_url && we.exercise_id
          );

          if (exercisesToCacheImages.length > 0) {
            console.log('[WorkoutCompletion] Caching images for posted workout exercises:', exercisesToCacheImages.length);

            // Cache images in background (don't await - non-blocking)
            exercisesToCacheImages.forEach(we => {
              if (we.exercise?.image_url && we.exercise_id) {
                downloadAndCacheExerciseImageToFilesystem(we.exercise_id, we.exercise.image_url)
                  .then(() => {
                    console.log('[WorkoutCompletion] Cached image for:', we.exercise?.name);
                  })
                  .catch(err => {
                    console.error('[WorkoutCompletion] Failed to cache image for:', we.exercise?.name, err);
                  });
              }
            });
          }

          // Force write cache before clearing
          await forceWrite();
          if (resolvedUserId && workoutId) {
            await clearCache();
          }

          setNewPrCount(detectedPRs.length);

          // Stop live activity when workout is completed
          await stopLiveActivity().catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("Failed to stop live activity on completion:", err);
            }
          });

          toast({
            title: 'Workout completed offline',
            description: 'Will sync when connection improves',
          });

          setShowCreatePost(false);
          setSliderValue(100);
          setShowCompletionOverview(true);
          suppressWorkoutId(workoutId);
        } catch (error: any) {
          console.error('[WorkoutCompletion] Offline completion failed:', error);
          console.error('[WorkoutCompletion] Error details:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
          });

          // IMPORTANT: ALWAYS show CompletionOverview even if errors occurred
          // User should be able to view workout summary and create post regardless
          console.log('[WorkoutCompletion] Error during offline completion, but showing overview anyway');
          setShowCreatePost(false);
          setSliderValue(100);
          setShowCompletionOverview(true);
          suppressWorkoutId(workoutId);

          // Show toast about the error but don't block the UI
          toast({
            title: 'Workout completed',
            description: 'Some sync operations will retry later',
            variant: 'default',
          });
        }
      } else {
        // ONLINE COMPLETION
        try {
          const { error: completeError } = await supabase
            .from("workouts")
            .update({ ended_at: now })
            .eq("id", workoutId);

          if (completeError) throw completeError;

          // Update IndexedDB to keep cache in sync with Supabase
          try {
            const db = await getDB();
            const workout = await db.get('workouts', workoutId);
            if (workout) {
              workout.data.endedAt = now;
              workout.updatedAt = now;
              workout.synced = true; // Mark as synced since we just updated Supabase
              await db.put('workouts', workout);
              console.log('[WorkoutCompletion] Updated IndexedDB with endedAt for online completion');
            }
          } catch (indexedDBError) {
            console.error('[WorkoutCompletion] Failed to update IndexedDB:', indexedDBError);
            // Don't fail completion if IndexedDB update fails
          }

          // Cache workout history for future offline prefill
          try {
            const { cacheWorkoutHistory } = await import('@/lib/cache/workoutHistoryCache');
            const exercisesToCache = workoutExercises
              .filter(we => we.sets && we.sets.length > 0)
              .map(we => ({
                exerciseId: we.exercise_id,
                exerciseName: we.exercise?.name || 'Unknown Exercise',
                sessionData: {
                  workoutId,
                  endedAt: now,
                  sets: we.sets.map((s, idx) => ({
                    setNo: idx + 1,
                    weight: s.weight ? parseFloat(s.weight) : null,
                    reps: s.reps ? parseInt(s.reps) : null,
                    rir: s.rir ? parseInt(s.rir) : null,
                    isWarmup: s.is_warmup || false,
                    unit: s.unit || 'kg',
                    leftWeight: s.leftWeight ? parseFloat(s.leftWeight) : null,
                    rightWeight: s.rightWeight ? parseFloat(s.rightWeight) : null,
                    leftReps: s.leftReps ? parseInt(s.leftReps) : null,
                    rightReps: s.rightReps ? parseInt(s.rightReps) : null,
                    leftRir: s.leftRir ? parseInt(s.leftRir) : null,
                    rightRir: s.rightRir ? parseInt(s.rightRir) : null,
                    isUnilateral: s.is_unilateral || false,
                  })),
                },
              }));

            // Cache history immediately for offline prefill
            // Note: CompletionOverview reads from lastSessionSets (already in memory)
            // so we can safely cache the NEW data without overwriting the display
            await cacheWorkoutHistory(userId, exercisesToCache);
            console.log('[WorkoutCompletion] Cached history for offline prefill:', {
              exerciseCount: exercisesToCache.length,
              exercises: exercisesToCache.map(e => ({
                name: e.exerciseName,
                setsCount: e.sessionData.sets.length,
                sets: e.sessionData.sets,
              })),
            });
          } catch (cacheError) {
            console.error('[WorkoutCompletion] Failed to cache history:', cacheError);
            // Don't fail completion if caching fails
          }

          // OPTIMIZATION: Batch PR checking for the big three lifts
          const bigThreeCategories = ["squat", "bench", "deadlift"];
          let prCount = 0;

          try {
            // Collect all sets from big three exercises
            const setsToCheck: Array<{
              exerciseId: string;
              exerciseName: string;
              weight: number;
              reps: number;
              unit: "kg" | "lb";
              is_warmup: boolean;
            }> = [];

            for (const exercise of workoutExercises) {
              const exerciseName = exercise.exercise.name.toLowerCase();
              const isBigThree = bigThreeCategories.some(cat => exerciseName.includes(cat));

              if (isBigThree) {
                for (const set of exercise.sets) {
                  const weight = parseFloat(set.weight);
                  const reps = parseInt(set.reps);

                  if (weight && reps && !set.is_warmup) {
                    setsToCheck.push({
                      exerciseId: exercise.exercise.id,
                      exerciseName: exercise.exercise.name,
                      weight,
                      reps,
                      unit: currentUnit,
                      is_warmup: false,
                    });
                  }
                }
              }
            }

            // OPTIMIZATION: Single batch query + batch insert for all PRs
            if (setsToCheck.length > 0 && userId) {
              const prResults = await checkForPRsBatch(userId, setsToCheck);

              // Collect all PRs to save
              const allPRsToSave: any[] = [];
              prResults.forEach(result => {
                allPRsToSave.push(...result.prsToSave);
                prCount += result.count;
              });

              // Save all PRs in one batch insert
              if (allPRsToSave.length > 0) {
                await savePRsBatch(allPRsToSave);
              }
            }
          } catch (error) {
            console.error("Batch PR detection error:", error);
            // Continue even if PR checking fails
          }

          // Cache exercise images for all exercises in the posted workout (background, non-blocking)
          const exercisesToCacheImages = workoutExercises.filter(
            we => we.exercise?.image_url && we.exercise_id
          );

          if (exercisesToCacheImages.length > 0) {
            console.log('[WorkoutCompletion] Caching images for posted workout exercises:', exercisesToCacheImages.length);

            // Cache images in background (don't await - non-blocking)
            exercisesToCacheImages.forEach(we => {
              if (we.exercise?.image_url && we.exercise_id) {
                downloadAndCacheExerciseImageToFilesystem(we.exercise_id, we.exercise.image_url)
                  .then(() => {
                    console.log('[WorkoutCompletion] Cached image for:', we.exercise?.name);
                  })
                  .catch(err => {
                    console.error('[WorkoutCompletion] Failed to cache image for:', we.exercise?.name, err);
                  });
              }
            });
          }

          // Force write cache before clearing
          await forceWrite();
          if (userId && workoutId) {
            await clearCache();
          }
          setNewPrCount(prCount);

          // Stop live activity when workout is completed
          await stopLiveActivity().catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("Failed to stop live activity on completion:", err);
            }
          });

          setShowCreatePost(false);
          setShowCompletionOverview(true);
          if (workoutId) {
            suppressWorkoutId(workoutId);
          }
        } catch (error: any) {
          console.error('[WorkoutCompletion] Online completion failed:', error);

          // Fallback to offline completion
          try {
            const db = await getDB();
            const workout = await db.get('workouts', workoutId);
            if (workout) {
              workout.data.endedAt = now;
              workout.updatedAt = now;
              await db.put('workouts', workout);
            }

            const fallbackUserId = userId ?? (await getOfflineUserId());
            if (!fallbackUserId) {
              throw new Error('User ID required for offline completion fallback');
            }
            await queueOperation({
              workoutId,
              type: 'update',
              table: 'workouts',
              data: { id: workoutId, ended_at: now },
              timestamp: now,
              userId: fallbackUserId,
            });

            const detectedPRs = await detectPRsOffline(workoutExercises, fallbackUserId);

            for (const pr of detectedPRs) {
              await queueOperation({
                workoutId,
                type: 'insert',
                table: 'prs',
                data: pr,
                timestamp: now,
                userId: fallbackUserId,
              });
            }

            await forceWrite();
            if (fallbackUserId && workoutId) {
              await clearCache();
            }

            setNewPrCount(detectedPRs.length);

            // Stop live activity
            await stopLiveActivity().catch((err) => {
              if (import.meta.env.DEV) {
                console.warn("Failed to stop live activity on completion:", err);
              }
            });

            toast({
              title: 'Saved offline',
              description: 'Workout completed offline, will sync later',
            });

            setShowCreatePost(false);
            setSliderValue(100);
            setShowCompletionOverview(true);
            suppressWorkoutId(workoutId);
          } catch (fallbackError: any) {
            console.error('[WorkoutCompletion] Fallback failed:', fallbackError);

            // ALWAYS show CompletionOverview even if fallback fails
            setShowCreatePost(false);
            setSliderValue(100);
            setShowCompletionOverview(true);

            toast({
              title: 'Workout completed',
              description: 'Some operations will retry in background',
              variant: 'default',
            });
            suppressWorkoutId(workoutId);
          }
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to complete workout",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }, [
    workoutId,
    userId,
    workoutExercises,
    currentUnit,
    forceWrite,
    clearCache,
    setSaving,
    setNewPrCount,
    setShowCreatePost,
    setShowCompletionOverview,
    setCompletedExercises,
    getAuthContext,
    toast,
    ensureOfflineLastSessionData,
    ensureOnlineLastSessionData,
    getOfflineUserId,
  ]);

  /**
   * Terminates (cancels) the current workout.
   * Deletes all workout data and navigates home.
   *
   * Critical Features:
   * - Parallel deletions (sets, workout_exercises, metrics)
   * - Session storage cleanup (suppressed workout ID)
   * - Event dispatching for Home page
   * - Cache clearing
   * - Navigation
   *
   * @returns Promise that resolves when workout is terminated
   */
  const handleTerminateWorkout = useCallback(() => {
    const targetWorkoutId = workoutId;
    if (!targetWorkoutId) return;

    const isTempId = (value: string | number | null | undefined): boolean => {
      if (value === null || value === undefined) return true;
      const str = value.toString();
      return str.startsWith("temp-") || str.includes("-template-");
    };

    const queueOfflineDeletions = async () => {
      const offlineUserId = userId ?? (await getOfflineUserId());
      if (!offlineUserId) {
        console.error('[WorkoutTermination] Missing userId for offline cancellation');
        return;
      }

      const timestamp = new Date().toISOString();

      try {
        const db = await getDB();

        // Remove workout from offline cache so it disappears immediately
        await db.delete('workouts', targetWorkoutId).catch(async () => {
          const workout = await db.get('workouts', targetWorkoutId);
          if (workout) {
            workout.deleted = true;
            workout.updatedAt = timestamp;
            await db.put('workouts', workout);
          }
        });

        // Remove any pending operations for this workout (prevents inserts from syncing)
        const pendingOps = await db.getAllFromIndex('operations', 'by-workout', targetWorkoutId);
        for (const op of pendingOps) {
          if (typeof op.id === 'number') {
            await db.delete('operations', op.id);
          }
        }

        const queueServerDeletion = async (table: string, id: string | number | null | undefined) => {
          if (!id || isTempId(id)) {
            return;
          }
          await queueOperation({
            workoutId: targetWorkoutId,
            type: 'delete',
            table,
            data: { id },
            timestamp,
            userId: offlineUserId,
          });
        };

        // Ensure server copy of workout (and any synced children) gets deleted on reconnect
        await queueServerDeletion('workouts', targetWorkoutId);

        for (const exercise of workoutExercisesRef.current) {
          await queueServerDeletion('workout_exercises', exercise.id);

          if (exercise.sets && exercise.sets.length > 0) {
            for (const set of exercise.sets) {
              await queueServerDeletion('sets', set.id);
            }
          }
        }

        toast({
          title: 'Workout cancelled offline',
          description: 'Will remove from Supabase once connection returns',
        });
      } catch (error) {
        console.error('[WorkoutTermination] Offline cleanup failed:', error);
        toast({
          title: 'Cancellation queued',
          description: 'Some items failed to queue; will retry when online',
          variant: 'destructive',
        });
      }
    };

    const cleanup = async (workoutId: string) => {
      try {
        const useOffline = shouldUseOfflineMode();

        if (useOffline) {
          await queueOfflineDeletions();

          // Stop live activity when workout is terminated
          await stopLiveActivity().catch((err) => {
            if (import.meta.env.DEV) {
              console.warn("Failed to stop live activity on termination:", err);
            }
          });

          window.dispatchEvent(
            new CustomEvent("workout:cancelled:success", {
              detail: { workoutId },
            })
          );

          await forceWrite();
          if (userId) {
            await clearCache();
          }

          return;
        }

        const exerciseIds = workoutExercisesRef.current.map((we) => we.id);

        // Run deletions in parallel for better performance
        const deletionPromises = [];

        if (exerciseIds.length > 0) {
          deletionPromises.push(
            supabase
              .from("sets")
              .delete()
              .in("workout_exercise_id", exerciseIds)
          );
        }

        deletionPromises.push(
          supabase
            .from("workout_exercises")
            .delete()
            .eq("workout_id", workoutId)
        );

        deletionPromises.push(
          supabase
            .from("session_metrics")
            .delete()
            .eq("workout_id", workoutId)
        );

        await Promise.all(deletionPromises);

        // Check if this workout has an associated post
        // If it does, we should NOT delete it (would cascade delete the post)
        const { data: associatedPost } = await supabase
          .from("posts")
          .select("id")
          .eq("workout_id", workoutId)
          .maybeSingle();

        if (associatedPost) {
          toast({
            title: "Cannot delete workout",
            description: "This workout has a post. Delete the post first, or keep the workout.",
            variant: "destructive",
          });
          throw new Error("Cannot delete workout with associated post");
        }

        // Delete workout last after all related records are deleted
        const { error } = await supabase
          .from("workouts")
          .delete()
          .eq("id", workoutId);

        if (error) throw error;

        // Force write cache before clearing
        await forceWrite();
        if (userId) {
          await clearCache();
        }

        // Stop live activity when workout is terminated
        await stopLiveActivity().catch((err) => {
          if (import.meta.env.DEV) {
            console.warn("Failed to stop live activity on termination:", err);
          }
        });

        window.dispatchEvent(
          new CustomEvent("workout:cancelled:success", {
            detail: { workoutId },
          })
        );
      } catch (error: any) {
        window.dispatchEvent(
          new CustomEvent("workout:cancelled:failed", {
            detail: { workoutId, error: error?.message },
          })
        );
      }
    };

    suppressWorkoutId(String(targetWorkoutId));

    window.dispatchEvent(
      new CustomEvent("workout:cancelled", {
        detail: { workoutId: targetWorkoutId },
      })
    );

    navigate("/");
    void cleanup(targetWorkoutId);
  }, [workoutId, userId, workoutExercisesRef, forceWrite, clearCache, navigate, getOfflineUserId]);

  /**
   * Saves current workout as a template.
   *
   * @param templateName - Name for the new template
   * @returns Promise that resolves when template is saved
   */
  const handleSaveTemplate = useCallback(
    async (templateName: string) => {
      if (!templateName.trim()) {
        toast({
          title: "Template name required",
          description: "Please enter a name for your template",
          variant: "destructive",
        });
        return;
      }

      if (workoutExercises.length === 0) {
        toast({
          title: "No exercises",
          description: "Add exercises before saving as template",
          variant: "destructive",
        });
        return;
      }

      try {
        const auth = await getAuthContext();
        if (!auth) return;
        const { user } = auth;

        const { data: template, error: templateError } = await supabase
          .from("workout_templates")
          .insert({
            user_id: user.id,
            name: templateName,
          })
          .select()
          .single();

        if (templateError || !template) {
          throw templateError ?? new Error("Failed to create template");
        }

        if (workoutExercises.length > 0) {
          const templateExercisesPayload = workoutExercises.map((we) => ({
            template_id: template.id,
            exercise_id: we.exercise_id,
            order_index: we.order_index,
          }));

          const { error: templateExercisesError } = await supabase
            .from("template_exercises")
            .insert(templateExercisesPayload);

          if (templateExercisesError) throw templateExercisesError;
        }

        toast({
          title: "Template saved",
          description: `"${templateName}" saved successfully`,
        });

        setShowSaveTemplate(false);
        setTemplateName("");
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to save template",
          variant: "destructive",
        });
      }
    },
    [workoutExercises, getAuthContext, setShowSaveTemplate, setTemplateName, toast]
  );

  /**
   * Converts weight units for a specific set (kg ↔ lb).
   *
   * Critical Features:
   * - Separate handling for bilateral/unilateral
   * - Optimistic updates
   * - Error handling
   *
   * @param workoutExerciseId - Exercise ID
   * @param setId - Set ID to convert
   * @param currentWeight - Current weight value
   * @param setUnit - Current unit
   * @param options - Optional side specification for unilateral
   * @returns Promise that resolves when conversion is complete
   */
  const handleConvertWeight = useCallback(
    async (
      workoutExerciseId: string,
      setId: string,
      currentWeight: string,
      setUnit: WeightUnit,
      options?: { side?: "left" | "right" | "both" }
    ) => {
      const exercise = workoutExercisesRef.current.find((we) => String(we.id) === String(workoutExerciseId));
      if (!exercise) return;
      const set = exercise.sets.find((s) => String(s.id) === String(setId));
      if (!set) return;

      const sourceUnit: WeightUnit = set.unit || setUnit || currentUnit;
      const targetUnit: WeightUnit = sourceUnit === "kg" ? "lb" : "kg";

      if (set.is_unilateral) {
        const side = options?.side ?? "both";
        const convertValue = (val?: string) => {
          const numeric = parseNumericString(val);
          if (numeric === null) return "";
          return formatNumericString(convertWeight(numeric, sourceUnit, targetUnit));
        };

        const nextLeft = side === "right" ? set.leftWeight ?? "" : convertValue(set.leftWeight);
        const nextRight = side === "left" ? set.rightWeight ?? "" : convertValue(set.rightWeight);

        const aggregateWeight = aggregateUnilateralWeight(nextLeft, nextRight);
        const aggregateReps = aggregateUnilateralReps(set.leftReps, set.rightReps);
        const aggregateRir = aggregateUnilateralRir(set.leftRir, set.rightRir);

        try {
          const auth = await getAuthContext();
          if (!auth) return;

          const { error } = await supabase
            .from("sets")
            .update({
              unit: targetUnit,
              weight: aggregateWeight ?? 0,
              reps: aggregateReps ?? 0,
              rir: aggregateRir ?? null,
              left_weight: parseNumericString(nextLeft),
              right_weight: parseNumericString(nextRight),
            })
            .eq("id", setId);

          if (error) throw error;

          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === workoutExerciseId
                  ? {
                      ...we,
                      sets: we.sets.map((s) =>
                        s.id === setId
                          ? {
                              ...s,
                              unit: targetUnit,
                              leftWeight: nextLeft,
                              rightWeight: nextRight,
                              weight: formatNumericString(aggregateWeight),
                              reps: formatNumericString(aggregateReps),
                              rir: aggregateRir === null ? "" : aggregateRir.toString(),
                              weightEdited: true,
                              lastUnilateral: {
                                leftWeight: nextLeft,
                                rightWeight: nextRight,
                                leftReps: s.leftReps ?? "",
                                rightReps: s.rightReps ?? "",
                                leftRir: s.leftRir ?? "",
                                rightRir: s.rightRir ?? "",
                              },
                            }
                          : s
                      ),
                    }
                  : we
              )
            );
          });

          toast({ title: "Weights converted", description: `Converted to ${targetUnit}` });
        } catch (error: any) {
          toast({
            title: "Error",
            description: "Failed to convert weight",
            variant: "destructive",
          });
        }

        return;
      }

      const numericWeight = parseNumericString(currentWeight || set.weight);
      if (numericWeight === null) {
        try {
          const auth = await getAuthContext();
          if (!auth) return;

          const { error } = await supabase
            .from("sets")
            .update({ unit: targetUnit })
            .eq("id", setId);

          if (error) throw error;

          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === workoutExerciseId
                  ? {
                      ...we,
                      sets: we.sets.map((s) =>
                        s.id === setId
                          ? {
                              ...s,
                              unit: targetUnit,
                            }
                          : s
                      ),
                    }
                  : we
              )
            );
          });

          toast({ title: "Unit updated", description: `Now tracking in ${targetUnit}` });
        } catch (error: any) {
          toast({
            title: "Error",
            description: "Failed to update unit",
            variant: "destructive",
          });
        }
        return;
      }

      const converted = convertWeight(numericWeight, sourceUnit, targetUnit);
      const formatted = formatNumericString(converted);

      try {
        const auth = await getAuthContext();
        if (!auth) return;

        const { error } = await supabase
          .from("sets")
          .update({ weight: converted, unit: targetUnit })
          .eq("id", setId);

        if (error) throw error;

        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === workoutExerciseId
                ? {
                    ...we,
                    sets: we.sets.map((s) =>
                      s.id === setId
                        ? { ...s, weight: formatted, unit: targetUnit, weightEdited: true }
                        : s
                    ),
                  }
                : we
            )
          );
        });

        toast({
          title: "Weight converted",
          description: `${numericWeight}${sourceUnit} → ${formatted}${targetUnit}`,
        });
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to convert weight",
          variant: "destructive",
        });
      }
    },
    [workoutExercisesRef, currentUnit, setWorkoutExercises, getAuthContext, toast]
  );

  return {
    handleCompleteWorkout,
    handleTerminateWorkout,
    handleSaveTemplate,
    handleConvertWeight,
  };
};
