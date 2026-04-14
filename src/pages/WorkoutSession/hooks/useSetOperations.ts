/**
 * useSetOperations.ts
 *
 * Hook for managing set operations (add/delete/update).
 * This is the most complex hook due to extensive prefill logic and debouncing.
 *
 * Performance Optimizations:
 * - Optimistic updates for instant feedback
 * - Debounced database writes (400ms) to prevent excessive requests
 * - StartTransition for non-urgent state updates
 * - Async PR detection (non-blocking)
 *
 * Complexity Notes:
 * - handleAddSet: 378 lines (complex prefill from last session)
 * - handleUpdateSet: 260 lines (debounced updates with aggregation)
 * - handleDeleteSet: 56 lines (simpler, just cleanup)
 *
 * Why This Exists:
 * - Centralizes all set CRUD operations
 * - Manages prefill logic from last session
 * - Handles unilateral/bilateral differences
 * - Debounces updates to reduce database load
 */

import { useCallback, useRef, startTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { checkForPR, savePR } from "@/lib/prDetection";
import type { WorkoutExercise, WeightUnit, Set } from "../types";
import {
  parseNumericString,
  formatNumericString,
  aggregateUnilateralWeight,
  aggregateUnilateralReps,
  aggregateUnilateralRir,
  coalesceNonEmpty,
} from "../utils/aggregations";
import { shouldUseOfflineMode } from "@/lib/network";
import { queueOperation, removeQueuedOperationsForIds } from "@/lib/db/operationQueue";
import { vLog } from "@/components/VisualDebugLogger";

const UPDATE_DEBOUNCE_MS = 400;

const buildTempSetId = () => `temp-set-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const createBlankSet = (params: {
  setNumber: number;
  unit: WeightUnit;
  isUnilateral: boolean;
}): Set => {
  const { setNumber, unit, isUnilateral } = params;
  return {
    id: buildTempSetId(),
    set_no: setNumber,
    weight: "",
    reps: "",
    rpe: "",
    rir: "",
    notes: "",
    is_warmup: false,
    unit,
    is_unilateral: isUnilateral,
    leftWeight: isUnilateral ? "" : undefined,
    rightWeight: isUnilateral ? "" : undefined,
    leftReps: isUnilateral ? "" : undefined,
    rightReps: isUnilateral ? "" : undefined,
    leftRir: isUnilateral ? "" : undefined,
    rightRir: isUnilateral ? "" : undefined,
    lastUnilateral: isUnilateral
      ? {
          leftWeight: "",
          rightWeight: "",
          leftReps: "",
          rightReps: "",
          leftRir: "",
          rightRir: "",
        }
      : undefined,
    weightEdited: false,
    repsEdited: false,
    rirEdited: false,
    warmupEdited: true,
    isOptimistic: false,
  };
};

interface PrefillPipelineOptions {
  exerciseSnapshot: WorkoutExercise;
  remoteWorkoutExerciseId: number | string;
  isUnilateralExercise: boolean;
  tempId: string;
}

interface UseSetOperationsOptions {
  workoutId?: string;  // Added for offline support
  userId: string | null;
  workoutExercises: WorkoutExercise[];
  workoutStartedAt: string;
  currentUnit: WeightUnit;
  workoutExercisesRef: React.RefObject<WorkoutExercise[]>;
  setWorkoutExercises: React.Dispatch<React.SetStateAction<WorkoutExercise[]>>;
  toast: any;
  getAuthContext: () => Promise<{ user: { id: string } } | null>;
  fetchLastSessionData: (
    userId: string,
    exerciseId: string,
    beforeDate?: string,
    options?: { seedId?: string | null; exerciseName?: string | null; isUnilateral?: boolean }
  ) => Promise<{
    lastSessionWeight?: string;
    lastSessionSets?: WorkoutExercise["lastSessionSets"];
  }>;
  resolveUserId: () => Promise<string | null>;
  isPremium: boolean;
}

export const useSetOperations = (options: UseSetOperationsOptions) => {
  const {
    workoutId,
    userId,
    workoutExercises,
    workoutStartedAt,
    currentUnit,
    workoutExercisesRef,
    setWorkoutExercises,
    toast,
    getAuthContext,
    fetchLastSessionData,
    resolveUserId,
    isPremium,
  } = options;

  // Refs for debouncing updates
  const updateTimeoutsRef = useRef<Record<string, any>>({});

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
        console.warn('[SetOperations] Failed to resolve userId for offline op:', error);
      }
    }
    return null;
  }, [userId, resolveUserId]);

  /**
   * Adds a new set to an exercise with intelligent prefill from last session.
   *
   * Why So Complex:
   * - Fetches last session data if not already loaded
   * - Handles both bilateral and unilateral exercises
   * - Prefills weight/reps/RIR from corresponding set in last session
   * - Tracks which fields were prefilled (for edit detection)
   * - Performs async PR detection after successful insert
   *
   * Process:
   * 1. Validate exercise is ready (not optimistic, not toggling)
   * 2. Fetch last session data if needed
   * 3. Determine prefill values from last session
   * 4. Handle unilateral aggregation if applicable
   * 5. Create optimistic set
   * 6. Insert to database
   * 7. Update with real ID
   * 8. Check for PR (async)
   * 9. Rollback on error
   *
   * @param workoutExerciseId - ID of workout_exercise to add set to
   */
  const prefillAndPersistSet = useCallback(
    async (
      params: PrefillPipelineOptions & {
        workoutExerciseId: string | number;
      }
    ) => {
      const {
        exerciseSnapshot: exercise,
        remoteWorkoutExerciseId,
        isUnilateralExercise,
        tempId,
        workoutExerciseId,
      } = params;

      if (!exercise) {
        if (import.meta.env.DEV) console.warn("prefillAndPersistSet: missing exercise snapshot");
        return;
      }

      const currentExerciseId = exercise.exercise?.id ?? exercise.exercise_id;
      if (!currentExerciseId) {
        if (import.meta.env.DEV) console.warn("prefillAndPersistSet: missing current exercise id");
        return;
      }

      const targetWorkoutExerciseId = exercise.id;

      // Fetch last session data if not already loaded
      // Free users don't get prefill - set to empty array
      let resolvedLastSessionSets: WorkoutExercise["lastSessionSets"] = isPremium ? (exercise.lastSessionSets ?? []) : [];

      // Check if we should skip online prefill (offline mode or temp exercise ID)
      const isTempExerciseId = exercise.exercise_id.startsWith('temp-seed-');
      const isOfflineMode = shouldUseOfflineMode();
      const skipOnlinePrefill = !isPremium || isTempExerciseId || isOfflineMode;

      if (skipOnlinePrefill && import.meta.env.DEV) {
        console.log('[handleAddSet] Skipping online prefill:', {
          reason: isTempExerciseId ? 'temp exercise ID' : 'offline mode',
          exerciseId: exercise.exercise_id,
        });
      }

      // OFFLINE MODE: Try to use cached historical data first, fall back to previous set
      // Free users don't get prefill at all
      if (skipOnlinePrefill && userId && isPremium) {
        try {
          // First try to get cached historical data from IndexedDB
          const { getCachedExerciseHistory } = await import('@/lib/cache/workoutHistoryCache');

          // Debug: Check what's in the cache
          if (import.meta.env.DEV) {
            const { getDB } = await import('@/lib/db/indexedDB');
            const db = await getDB();
            const allCached = await db.getAll('workout_history');
            console.log('[handleAddSet] All cached workout history:', allCached);
          }

          const cachedSession = await getCachedExerciseHistory(userId, exercise.exercise_id);
          const isSameWorkoutHistory =
            cachedSession?.workoutId && workoutId
              ? String(cachedSession.workoutId) === String(workoutId)
              : false;

          if (import.meta.env.DEV) {
            console.log('[handleAddSet] Cached session lookup:', {
              exerciseId: exercise.exercise_id,
              exerciseName: exercise.exercise?.name,
              exerciseSeedId: exercise.exercise?.seedId,
              exerciseSupabaseId: exercise.exercise?.id,
              hasCachedSession: !!cachedSession,
              setsLength: cachedSession?.sets?.length,
              currentSetIndex: exercise.sets.length,
              cachedSessionData: cachedSession,
              userId,
              cacheKey: `${userId}-${exercise.exercise_id}`,
              isSameWorkoutHistory,
            });
          }

          if (
            cachedSession &&
            !isSameWorkoutHistory &&
            cachedSession.sets &&
            cachedSession.sets.length > 0
          ) {
            // Use cached historical data (like online mode)
            resolvedLastSessionSets = cachedSession.sets.map((set: any) => ({
              weight: set.weight?.toString() || "",
              reps: set.reps?.toString() || "",
              rir: set.rir?.toString() || "",
              isWarmup: set.isWarmup || false,
              unit: set.unit || currentUnit,
              leftWeight: set.leftWeight?.toString() || "",
              rightWeight: set.rightWeight?.toString() || "",
              leftReps: set.leftReps?.toString() || "",
              rightReps: set.rightReps?.toString() || "",
              leftRir: set.leftRir?.toString() || "",
              rightRir: set.rightRir?.toString() || "",
            }));
            if (import.meta.env.DEV) {
              console.log('[handleAddSet] Using cached historical data for offline prefill:', {
                setsCount: resolvedLastSessionSets.length,
                sets: resolvedLastSessionSets,
              });
            }
          } else if (exercise.sets.length > 0) {
            // Fallback: Use previous set from current workout
            const previousSet = exercise.sets[exercise.sets.length - 1];
            if (previousSet && !previousSet.isOptimistic) {
              resolvedLastSessionSets = [
                {
                  weight: previousSet.weight || "",
                  reps: previousSet.reps || "",
                  rir: previousSet.rir || "",
                  isWarmup: previousSet.is_warmup || false,
                  unit: (previousSet.unit as WeightUnit) || currentUnit,
                  leftWeight: previousSet.leftWeight || "",
                  rightWeight: previousSet.rightWeight || "",
                  leftReps: previousSet.leftReps || "",
                  rightReps: previousSet.rightReps || "",
                  leftRir: previousSet.leftRir || "",
                  rightRir: previousSet.rightRir || "",
                },
              ];
              if (import.meta.env.DEV) {
                console.log('[handleAddSet] Using previous set for offline prefill (no cache)');
              }
            }
          }
        } catch (error) {
          console.error('[handleAddSet] Error loading cached history:', error);
        }
      }

      if (resolvedLastSessionSets.length === 0 && workoutStartedAt && userId && !skipOnlinePrefill) {
        try {
          if (import.meta.env.DEV) {
            console.log('[handleAddSet] Fetching last session data:', {
              userId,
              exerciseId: exercise.exercise_id,
              workoutStartedAt,
              isUnilateral: exercise.exercise?.is_unilateral ?? false,
              exerciseName: exercise.exercise?.name,
            });
          }

          const lastSession = await fetchLastSessionData(
            userId,
            exercise.exercise_id,
            workoutStartedAt,
            {
              seedId: exercise.exercise?.seedId,
              exerciseName: exercise.exercise?.name ?? null,
              isUnilateral: isUnilateralExercise,
            }
          );

          if (import.meta.env.DEV) {
            console.log('[handleAddSet] Last session data received:', {
              hasData: !!lastSession,
              setsCount: lastSession?.lastSessionSets?.length ?? 0,
              lastSessionSets: lastSession?.lastSessionSets,
            });
          }

          if (lastSession?.lastSessionSets?.length) {
            resolvedLastSessionSets = lastSession.lastSessionSets;
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === targetWorkoutExerciseId
                    ? {
                        ...we,
                        lastSessionSets: lastSession.lastSessionSets,
                        lastSessionWeight: lastSession.lastSessionWeight,
                      }
                    : we
                )
              );
            });
          }
        } catch (err) {
          if (import.meta.env.DEV) {
            console.warn("[handleAddSet] last session fetch failed:", err);
          }
        }
      }

      // Get prefill values from last session
      const lastSessionPlaceholder = resolvedLastSessionSets[exercise.sets.length];
      const placeholderWarmup = lastSessionPlaceholder?.isWarmup;

      let finalUnit: WeightUnit = currentUnit;
      let baseWarmup = false;
      let baseWeight = "";
      let baseReps = "";
      let baseRir = "";
      const baseRpe = "";
      const baseNotes = "";

      let leftWeight = "";
      let rightWeight = "";
      let leftReps = "";
      let rightReps = "";
      let leftRir = "";
      let rightRir = "";

      if (
        lastSessionPlaceholder &&
        (lastSessionPlaceholder.unit === "lb" || lastSessionPlaceholder.unit === "kg")
      ) {
        finalUnit = lastSessionPlaceholder.unit;
      }

      // Handle unilateral prefill
      if (isUnilateralExercise) {
        if (lastSessionPlaceholder) {
          baseWarmup = Boolean(lastSessionPlaceholder.isWarmup);
          leftWeight = lastSessionPlaceholder.leftWeight ?? "";
          rightWeight = lastSessionPlaceholder.rightWeight ?? "";
          const fallbackWeight = lastSessionPlaceholder.weight ?? "";
          if (!leftWeight) leftWeight = fallbackWeight;
          if (!rightWeight) rightWeight = fallbackWeight;

          leftReps = lastSessionPlaceholder.leftReps ?? "";
          rightReps = lastSessionPlaceholder.rightReps ?? "";
          const fallbackReps = lastSessionPlaceholder.reps ?? "";
          if (!leftReps) leftReps = fallbackReps;
          if (!rightReps) rightReps = fallbackReps;

          leftRir = lastSessionPlaceholder.leftRir ?? "";
          rightRir = lastSessionPlaceholder.rightRir ?? "";
          const fallbackRir = lastSessionPlaceholder.rir ?? "";
          if (!leftRir) leftRir = fallbackRir;
          if (!rightRir) rightRir = fallbackRir;

          const placeholderAggregateWeight = aggregateUnilateralWeight(leftWeight, rightWeight);
          const placeholderAggregateReps = aggregateUnilateralReps(leftReps, rightReps);
          const placeholderAggregateRir = aggregateUnilateralRir(leftRir, rightRir);
          baseWeight =
            placeholderAggregateWeight !== null
              ? formatNumericString(placeholderAggregateWeight)
              : "";
          baseReps =
            placeholderAggregateReps !== null ? formatNumericString(placeholderAggregateReps) : "";
          baseRir = placeholderAggregateRir === null ? "" : placeholderAggregateRir.toString();
        }
      } else if (lastSessionPlaceholder) {
        // Bilateral prefill
        baseWarmup = Boolean(lastSessionPlaceholder.isWarmup);
        baseWeight = lastSessionPlaceholder.weight ?? "";
        baseReps = lastSessionPlaceholder.reps ?? "";
        baseRir = lastSessionPlaceholder.rir ?? "";
      }

      // Aggregate values for display
      const aggregateWeight = isUnilateralExercise
        ? aggregateUnilateralWeight(leftWeight, rightWeight)
        : parseNumericString(baseWeight);
      const aggregateReps = isUnilateralExercise
        ? aggregateUnilateralReps(leftReps, rightReps)
        : parseNumericString(baseReps);
      const aggregateRir = isUnilateralExercise
        ? aggregateUnilateralRir(leftRir, rightRir)
        : parseNumericString(baseRir);

      const formattedWeight = formatNumericString(aggregateWeight);
      const formattedReps = formatNumericString(aggregateReps);
      const formattedRir = aggregateRir === null ? "" : aggregateRir.toString();
      const hadPrefill = Boolean(lastSessionPlaceholder);
      const weightPrefilled = hadPrefill && formattedWeight !== "";
      const repsPrefilled = hadPrefill && formattedReps !== "";
      const rirPrefilled = hadPrefill && formattedRir !== "";

      const lastSessionMeta =
        baseWeight || baseReps || baseRir || baseWarmup
          ? {
              weight: baseWeight,
              reps: baseReps,
              rir: baseRir,
              isWarmup: baseWarmup,
              unit: finalUnit,
            }
          : undefined;

      // Create new set object
      const newSet: Set = {
        set_no: exercise.sets.length + 1,
        weight: formattedWeight,
        reps: formattedReps,
        rpe: baseRpe,
        rir: formattedRir,
        is_warmup: baseWarmup,
        notes: baseNotes,
        unit: finalUnit,
        lastSession: lastSessionMeta,
        weightEdited: weightPrefilled ? false : formattedWeight !== "",
        repsEdited: repsPrefilled ? false : formattedReps !== "",
        rirEdited: rirPrefilled ? false : formattedRir !== "",
        warmupEdited: typeof placeholderWarmup === "boolean" ? false : true,
        is_unilateral: isUnilateralExercise,
        leftWeight: isUnilateralExercise ? leftWeight : undefined,
        rightWeight: isUnilateralExercise ? rightWeight : undefined,
        leftReps: isUnilateralExercise ? leftReps : undefined,
        rightReps: isUnilateralExercise ? rightReps : undefined,
        leftRir: isUnilateralExercise ? leftRir : undefined,
        rightRir: isUnilateralExercise ? rightRir : undefined,
        lastUnilateral: isUnilateralExercise
          ? {
              leftWeight,
              rightWeight,
              leftReps,
              rightReps,
              leftRir,
              rightRir,
            }
          : undefined,
      };

      const optimisticSet: Set = { ...newSet, id: tempId, isOptimistic: true };

      // Optimistic update (replace blank set with prefilled values)
      // Wrapped in startTransition to deprioritize and prevent interrupting user input
      startTransition(() => {
        setWorkoutExercises((prev) =>
          prev.map((we) => {
            if (we.id !== targetWorkoutExerciseId) return we;
            const nextSets = we.sets.map((existingSet) => {
              if (String(existingSet.id) !== String(tempId)) return existingSet;
              const merged: Set = { ...existingSet };

              if (!existingSet.weightEdited) {
                merged.weight = optimisticSet.weight;
              }
              if (!existingSet.repsEdited) {
                merged.reps = optimisticSet.reps;
              }
              if (!existingSet.rirEdited) {
                merged.rir = optimisticSet.rir;
              }
              if (!existingSet.warmupEdited) {
                merged.is_warmup = optimisticSet.is_warmup;
              }

              if (optimisticSet.is_unilateral) {
                if (!existingSet.weightEdited) {
                  merged.leftWeight = optimisticSet.leftWeight;
                  merged.rightWeight = optimisticSet.rightWeight;
                }
                if (!existingSet.repsEdited) {
                  merged.leftReps = optimisticSet.leftReps;
                  merged.rightReps = optimisticSet.rightReps;
                }
                if (!existingSet.rirEdited) {
                  merged.leftRir = optimisticSet.leftRir;
                  merged.rightRir = optimisticSet.rightRir;
                }
                merged.lastUnilateral = optimisticSet.lastUnilateral;
              }

              merged.unit = optimisticSet.unit;
              merged.lastSession = optimisticSet.lastSession;
              merged.isOptimistic = true;

              return merged;
            });
            return {
              ...we,
              sets: nextSets,
            };
          })
        );
      });

      try {
        const auth = await getAuthContext();
        if (!auth) {
          // Rollback if not authenticated
          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === targetWorkoutExerciseId
                  ? { ...we, sets: we.sets.filter((s) => s.id !== tempId) }
                  : we
              )
            );
          });
          return;
        }

        // Prepare database payload
        const payload: Record<string, any> = {
          workout_exercise_id: remoteWorkoutExerciseId,
          set_no: newSet.set_no,
          weight: aggregateWeight ?? 0,
          unit: finalUnit,
          reps: aggregateReps ?? 0,
          rpe: newSet.rpe ? parseFloat(newSet.rpe) : null,
          rir: aggregateRir ?? null,
          is_warmup: newSet.is_warmup,
          notes: newSet.notes,
          is_unilateral: isUnilateralExercise,
          variant: isUnilateralExercise ? "unilateral" : "bilateral",
          left_weight: isUnilateralExercise ? parseNumericString(leftWeight) : null,
          right_weight: isUnilateralExercise ? parseNumericString(rightWeight) : null,
          left_reps: isUnilateralExercise ? parseNumericString(leftReps) : null,
          right_reps: isUnilateralExercise ? parseNumericString(rightReps) : null,
          left_rir: isUnilateralExercise ? parseNumericString(leftRir) : null,
          right_rir: isUnilateralExercise ? parseNumericString(rightRir) : null,
        };

        // Check if we should use offline mode
        const useOffline = shouldUseOfflineMode();

        if (useOffline) {
          // OFFLINE MODE: Queue operation for later sync
          try {
            if (!workoutId) {
              vLog.error('SetOperations', 'Missing workoutId for offline set add', { workoutId, userId });
              console.error('[SetOperations] Missing workoutId for offline operation');
              throw new Error(`Missing workoutId. workoutId=${workoutId}, userId=${userId}`);
            }
            const effectiveUserId = await getOfflineUserId();
            if (!effectiveUserId) {
              vLog.error('SetOperations', 'Missing userId for offline set add', { workoutId, userId });
              console.error('[SetOperations] Missing userId for offline operation');
              throw new Error(`Missing userId. workoutId=${workoutId}, userId=${userId}`);
            }

            vLog.info('SetOperations', 'Queueing set creation (offline mode)', { tempId, setNo: newSet.set_no });
            await queueOperation({
              workoutId,
              type: 'insert',
              table: 'sets',
              data: { ...payload, id: tempId },
              timestamp: new Date().toISOString(),
              userId: effectiveUserId,
            });

            vLog.success('SetOperations', '✓ Set queued for sync (offline)', { tempId });
            console.log('[SetOperations] Queued set creation (offline):', tempId);

            // Clear optimistic flag so inputs become editable immediately
            // Wrapped in startTransition to deprioritize and prevent interrupting user input
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === targetWorkoutExerciseId
                    ? {
                        ...we,
                        sets: we.sets.map((s) =>
                          s.id === tempId ? { ...s, isOptimistic: false } : s
                        ),
                      }
                    : we
                )
              );
            });
            return;
          } catch (error: any) {
            console.error('[SetOperations] Failed to queue operation:', error);
            toast({
              title: 'Offline save failed',
              description: error.message || 'Please check storage settings',
              variant: 'destructive',
            });
            // Rollback optimistic update
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === targetWorkoutExerciseId
                    ? { ...we, sets: we.sets.filter((s) => s.id !== tempId) }
                    : we
                )
              );
            });
            return;
          }
        }

        // ONLINE MODE: Direct Supabase insert
        vLog.info('SetOperations', 'Inserting set (online mode)', { tempId, setNo: newSet.set_no });
        const { data, error } = await supabase.from("sets").insert(payload).select().single();

        if (error || !data) {
          vLog.error('SetOperations', 'Online set insert failed', error);
          throw error ?? new Error("Failed to add set");
        }

        vLog.success('SetOperations', '✓ Set inserted online', { realId: data.id });

        // Format response data
        const formattedSet: Set = {
          ...optimisticSet,
          id: data.id,
          set_no: data.set_no,
          weight: data.weight ? formatNumericString(data.weight) : "",
          reps: data.reps ? formatNumericString(data.reps) : "",
          rpe: data.rpe?.toString() || "",
          rir: data.rir?.toString() || "",
          is_warmup: data.is_warmup,
          notes: data.notes || "",
          unit: (data.unit as WeightUnit) ?? finalUnit,
          isOptimistic: false,
          is_unilateral: Boolean(data.is_unilateral),
          leftWeight:
            data.left_weight ? formatNumericString(data.left_weight) : optimisticSet.leftWeight ?? "",
          rightWeight:
            data.right_weight
              ? formatNumericString(data.right_weight)
              : optimisticSet.rightWeight ?? "",
          leftReps:
            data.left_reps ? formatNumericString(data.left_reps) : optimisticSet.leftReps ?? "",
          rightReps:
            data.right_reps ? formatNumericString(data.right_reps) : optimisticSet.rightReps ?? "",
          leftRir: data.left_rir?.toString() || optimisticSet.leftRir || "",
          rightRir: data.right_rir?.toString() || optimisticSet.rightRir || "",
          lastUnilateral: optimisticSet.lastUnilateral,
        };

        // Update with real ID
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === targetWorkoutExerciseId
                ? {
                    ...we,
                    sets: we.sets.map((s) => (s.id === tempId ? formattedSet : s)),
                  }
                : we
            )
          );
        });

        // Async PR detection (non-blocking)
        if (!formattedSet.is_warmup && formattedSet.weight && formattedSet.reps && userId) {
          const numericWeight = parseFloat(formattedSet.weight);
          const numericReps = parseInt(formattedSet.reps);
          if (Number.isFinite(numericWeight) && Number.isFinite(numericReps)) {
            try {
              const prResult = await checkForPR(userId, exercise.exercise.id, {
                weight: numericWeight,
                reps: numericReps,
                unit: formattedSet.unit,
                is_warmup: false,
              });

              if (prResult.is1RMPR) {
                await savePR(userId, exercise.exercise.id, {
                  weight: numericWeight,
                  reps: numericReps,
                  unit: formattedSet.unit,
                  is_warmup: false,
                });
              }
            } catch (error) {
              console.error("PR detection error:", error);
            }
          }
        }
      } catch (error: any) {
        vLog.warning('SetOperations', 'Online set insert failed, trying offline fallback', error);
        console.error('[SetOperations] Online insert failed:', error);

        // Fallback to offline queue if online operation fails
        const fallbackUserId = await getOfflineUserId();
        if (workoutId && fallbackUserId) {
          try {
            vLog.info('SetOperations', 'Falling back to offline queue', { tempId });
            const payload: Record<string, any> = {
              workout_exercise_id: remoteWorkoutExerciseId,
              set_no: newSet.set_no,
              weight: aggregateWeight ?? 0,
              unit: finalUnit,
              reps: aggregateReps ?? 0,
              rpe: newSet.rpe ? parseFloat(newSet.rpe) : null,
              rir: aggregateRir ?? null,
              is_warmup: newSet.is_warmup,
              notes: newSet.notes,
              is_unilateral: isUnilateralExercise,
              variant: isUnilateralExercise ? "unilateral" : "bilateral",
              left_weight: isUnilateralExercise ? parseNumericString(leftWeight) : null,
              right_weight: isUnilateralExercise ? parseNumericString(rightWeight) : null,
              left_reps: isUnilateralExercise ? parseNumericString(leftReps) : null,
              right_reps: isUnilateralExercise ? parseNumericString(rightReps) : null,
              left_rir: isUnilateralExercise ? parseNumericString(leftRir) : null,
              right_rir: isUnilateralExercise ? parseNumericString(rightRir) : null,
            };

            await queueOperation({
              workoutId,
              type: 'insert',
              table: 'sets',
              data: { ...payload, id: tempId },
              timestamp: new Date().toISOString(),
              userId: fallbackUserId,
            });

            vLog.success('SetOperations', '✓ Set saved offline (fallback)', { tempId });
            toast({
              title: 'Saved offline',
              description: 'Will sync when connection improves',
            });

            // Clear optimistic flag so inputs become editable immediately
            // Wrapped in startTransition to deprioritize and prevent interrupting user input
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === targetWorkoutExerciseId
                    ? {
                        ...we,
                        sets: we.sets.map((s) =>
                          s.id === tempId ? { ...s, isOptimistic: false } : s
                        ),
                      }
                    : we
                )
              );
            });

            // Keep optimistic set (no rollback needed)
            return;
          } catch (queueError) {
            console.error('[SetOperations] Failed to queue after online failure:', queueError);
          }
        }

        // Rollback on error
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === targetWorkoutExerciseId
                ? {
                    ...we,
                    sets: we.sets.filter((s) => s.id !== tempId),
                  }
                : we
            )
          );
        });

        toast({
          title: "Error",
          description: "Failed to add set",
          variant: "destructive",
        });
      }
    },
    [
      userId,
      currentUnit,
      workoutStartedAt,
      setWorkoutExercises,
      toast,
      getAuthContext,
      fetchLastSessionData,
      workoutId,
      getOfflineUserId,
      isPremium,
    ]
  );

  const handleAddSet = useCallback(
    async (workoutExerciseId: string) => {
      const exercise = workoutExercisesRef.current.find(
        (we) => String(we.id) === String(workoutExerciseId)
      );
      if (!exercise) {
        if (import.meta.env.DEV) console.warn("handleAddSet: workout exercise not found");
        return;
      }

      const isUnilateralExercise = Boolean(
        exercise.isUnilateral ?? exercise.exercise.is_unilateral
      );
      const isOfflineModeForValidation = shouldUseOfflineMode();

      if (!isOfflineModeForValidation) {
        if (
          exercise.isOptimistic ||
          (typeof exercise.id === "string" && exercise.id.startsWith("temp-ex-"))
        ) {
          toast({
            title: "Syncing exercise",
            description: "Please wait a moment and try adding the set again.",
          });
          return;
        }

        if (exercise.togglePending) {
          toast({
            title: "Syncing exercise",
            description: "Please wait a moment and try adding the set again.",
          });
          return;
        }
      }

      const blankSet = createBlankSet({
        setNumber: exercise.sets.length + 1,
        unit: currentUnit,
        isUnilateral: isUnilateralExercise,
      });

      const blankSetId = String(blankSet.id);

      setWorkoutExercises((prev) =>
        prev.map((we) =>
          we.id === exercise.id ? { ...we, sets: [...we.sets, blankSet] } : we
        )
      );

      const remoteWorkoutExerciseId =
        typeof exercise.id === "number"
          ? exercise.id
          : Number.isFinite(Number(exercise.id))
            ? Number(exercise.id)
            : exercise.id;

      const exerciseSnapshot: WorkoutExercise = {
        ...exercise,
        exercise: { ...exercise.exercise },
        sets: exercise.sets.map((set) => ({ ...set })),
        lastSessionSets: exercise.lastSessionSets?.map((set) => ({ ...set })) ?? [],
      };

      prefillAndPersistSet({
        exerciseSnapshot,
        remoteWorkoutExerciseId,
        isUnilateralExercise,
        tempId: blankSetId,
        workoutExerciseId: exercise.id,
      }).catch((error) => {
        console.error('[handleAddSet] Prefill failed:', error);
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === exercise.id
                ? {
                    ...we,
                    sets: we.sets.filter((set) => String(set.id) !== blankSetId),
                  }
                : we
            )
          );
        });
        toast({
          title: "Error",
          description: "Failed to add set",
          variant: "destructive",
        });
      });
    },
    [workoutExercisesRef, toast, currentUnit, setWorkoutExercises, prefillAndPersistSet]
  );

  /**
   * Deletes a set from an exercise.
   *
   * Why Simple: Just remove and renumber, no complex prefill logic
   * Why Optimistic: Instant UI feedback
   *
   * @param workoutExerciseId - ID of workout_exercise
   * @param setId - ID of set to delete
   */
  const handleDeleteSet = useCallback(
    async (workoutExerciseId: string, setId: string) => {
      // Handle optimistic sets (not yet in database)
      if (setId.startsWith("temp-set-")) {
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === workoutExerciseId
                ? { ...we, sets: we.sets.filter((s) => s.id !== setId) }
                : we
            )
          );
        });
        const cleanupUserId = await getOfflineUserId();
        if (workoutId && cleanupUserId) {
          void removeQueuedOperationsForIds(workoutId, [setId], cleanupUserId);
        }
        return;
      }

      const exercise = workoutExercisesRef.current.find(
        (we) => String(we.id) === String(workoutExerciseId)
      );
      if (!exercise) return;

      // Save copy for rollback
      const previousSets = exercise.sets.map((set) => ({ ...set }));

      // Optimistic removal with renumbering
      startTransition(() => {
        setWorkoutExercises((prev) =>
          prev.map((we) =>
            we.id === workoutExerciseId
              ? {
                  ...we,
                  sets: we.sets
                    .filter((s) => String(s.id) !== String(setId))
                    .map((s, i) => ({ ...s, set_no: i + 1 })),
                }
              : we
          )
        );
      });

      try {
        // Check if we should use offline mode
        const useOffline = shouldUseOfflineMode();

        if (useOffline) {
          // OFFLINE MODE: Queue delete operation
          const deleteUserId = await getOfflineUserId();
          if (workoutId && deleteUserId) {
            vLog.info('SetOperations', 'Queueing set deletion (offline mode)', { setId });
            await queueOperation({
              workoutId,
              type: 'delete',
              table: 'sets',
              data: { id: setId },
              timestamp: new Date().toISOString(),
              userId: deleteUserId,
            });
            vLog.success('SetOperations', '✓ Set deletion queued (offline)', { setId });
            console.log('[SetOperations] Queued set deletion (offline):', setId);
            return;
          }
        }

        // ONLINE MODE: Delete from database
        vLog.info('SetOperations', 'Deleting set (online mode)', { setId });
        const { error } = await supabase.from("sets").delete().eq("id", setId);

        if (error) {
          vLog.error('SetOperations', 'Online set delete failed', error);
          throw error;
        }

        vLog.success('SetOperations', '✓ Set deleted online', { setId });
      } catch (error: any) {
        vLog.warning('SetOperations', 'Online set delete failed, trying offline fallback', error);
        console.error('[SetOperations] Delete failed:', error);

        // Fallback to offline queue if online operation fails
        const fallbackUserId = await getOfflineUserId();
        if (workoutId && fallbackUserId) {
          try {
            vLog.info('SetOperations', 'Falling back to offline queue for deletion', { setId });
            await queueOperation({
              workoutId,
              type: 'delete',
              table: 'sets',
              data: { id: setId },
              timestamp: new Date().toISOString(),
              userId: fallbackUserId,
            });

            vLog.success('SetOperations', '✓ Set deletion saved offline (fallback)', { setId });
            toast({
              title: 'Saved offline',
              description: 'Will sync when connection improves',
            });
            return;
          } catch (queueError) {
            console.error('[SetOperations] Failed to queue delete:', queueError);
          }
        }

        // Rollback on error
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) => (we.id === workoutExerciseId ? { ...we, sets: previousSets } : we))
          );
        });

        toast({
          title: "Error",
          description: "Failed to delete set",
          variant: "destructive",
        });
      }
    },
    [workoutExercisesRef, setWorkoutExercises, toast, workoutId, userId, getOfflineUserId]
  );

  /**
   * Updates a set field with debouncing.
   *
   * Why Debounced: User edits multiple fields rapidly, we batch database updates
   * Why Complex: Handles unilateral aggregation recalculation
   *
   * Process:
   * 1. Update local state immediately (instant feedback)
   * 2. Clear previous debounce timeout
   * 3. Schedule database update after 400ms
   * 4. Recalculate aggregated values for unilateral
   * 5. Update database with all changes
   *
   * @param workoutExerciseId - ID of workout_exercise
   * @param setId - ID of set to update
   * @param field - Field name to update
   * @param rawValue - New value for field
   */
  const handleUpdateSet = useCallback(
    (workoutExerciseId: string, setId: string, field: keyof Set, rawValue: any) => {
      const exercise = workoutExercisesRef.current.find(
        (we) => String(we.id) === String(workoutExerciseId)
      );
      if (!exercise) return;

      const setIndex = exercise.sets.findIndex((s) => String(s.id) === String(setId));
      if (setIndex === -1) return;

      const targetSet = exercise.sets[setIndex];
      const isUnilateral = Boolean(targetSet.is_unilateral);

      // Update local state immediately and mark field as edited
      startTransition(() => {
        setWorkoutExercises((prev) =>
          prev.map((we) =>
            we.id === workoutExerciseId
              ? {
                  ...we,
                  sets: we.sets.map((s) => {
                    if (String(s.id) !== String(setId)) return s;

                    const updates: Partial<Set> = { [field]: rawValue };

                    // Mark corresponding edited flag as true when user types
                    if (field === "weight" || field === "leftWeight" || field === "rightWeight") {
                      updates.weightEdited = true;
                    } else if (field === "reps" || field === "leftReps" || field === "rightReps") {
                      updates.repsEdited = true;
                    } else if (field === "rir" || field === "leftRir" || field === "rightRir") {
                      updates.rirEdited = true;
                    } else if (field === "is_warmup") {
                      updates.warmupEdited = true;
                    }

                    return { ...s, ...updates };
                  }),
                }
              : we
          )
        );
      });

      // Skip ONLINE database update for optimistic sets (but allow offline queueing)
      const isTempId = setId.startsWith("temp-set-");
      const useOfflineForTempCheck = shouldUseOfflineMode();

      // If temp ID and we're online, skip (will be saved when insert completes)
      // If temp ID and we're offline, continue to queue the update
      if (isTempId && !useOfflineForTempCheck) return;

      // Debounce database update
      const debounceKey = `${workoutExerciseId}-${setId}`;

      if (updateTimeoutsRef.current[debounceKey]) {
        clearTimeout(updateTimeoutsRef.current[debounceKey]);
      }

      updateTimeoutsRef.current[debounceKey] = setTimeout(async () => {
        try {
          const currentExercise = workoutExercisesRef.current.find(
            (we) => String(we.id) === String(workoutExerciseId)
          );
          if (!currentExercise) return;

          const currentSet = currentExercise.sets.find((s) => String(s.id) === String(setId));
          if (!currentSet) return;

          // Prepare database updates
          const updates: Record<string, any> = {};

          // Handle unilateral aggregation
          if (isUnilateral) {
            const leftWeight = currentSet.leftWeight ?? "";
            const rightWeight = currentSet.rightWeight ?? "";
            const leftReps = currentSet.leftReps ?? "";
            const rightReps = currentSet.rightReps ?? "";
            const leftRir = currentSet.leftRir ?? "";
            const rightRir = currentSet.rightRir ?? "";

            const aggregatedWeight = aggregateUnilateralWeight(leftWeight, rightWeight);
            const aggregatedReps = aggregateUnilateralReps(leftReps, rightReps);
            const aggregatedRir = aggregateUnilateralRir(leftRir, rightRir);

            updates.weight = aggregatedWeight ?? 0;
            updates.reps = aggregatedReps ?? 0;
            updates.rir = aggregatedRir ?? null;
            updates.left_weight = parseNumericString(leftWeight);
            updates.right_weight = parseNumericString(rightWeight);
            updates.left_reps = parseNumericString(leftReps);
            updates.right_reps = parseNumericString(rightReps);
            updates.left_rir = parseNumericString(leftRir);
            updates.right_rir = parseNumericString(rightRir);

            // Update aggregated fields in local state
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === workoutExerciseId
                    ? {
                        ...we,
                        sets: we.sets.map((s) =>
                          String(s.id) === String(setId)
                            ? {
                                ...s,
                                weight: formatNumericString(aggregatedWeight),
                                reps: formatNumericString(aggregatedReps),
                                rir: aggregatedRir !== null ? aggregatedRir.toString() : "",
                              }
                            : s
                        ),
                      }
                    : we
                )
              );
            });
          } else {
            // Bilateral updates
            updates[field] = rawValue;
            if (field === "weight") updates.weight = parseNumericString(rawValue as string) ?? 0;
            if (field === "reps") updates.reps = parseNumericString(rawValue as string) ?? 0;
            if (field === "rir") updates.rir = parseNumericString(rawValue as string) ?? null;
          }

          // Check if we should use offline mode
          const useOffline = shouldUseOfflineMode();

          if (useOffline) {
            // OFFLINE MODE: Queue update operation
            const updateUserId = await getOfflineUserId();
            if (workoutId && updateUserId) {
              vLog.info('SetOperations', 'Queueing set update (offline mode)', { setId, field });
              await queueOperation({
                workoutId,
                type: 'update',
                table: 'sets',
                data: { id: setId, ...updates },
                timestamp: new Date().toISOString(),
                userId: updateUserId,
              });
              vLog.success('SetOperations', '✓ Set update queued (offline)', { setId });
              console.log('[SetOperations] Queued set update (offline):', setId);
              return;
            }
          }

          // ONLINE MODE: Update database
          vLog.info('SetOperations', 'Updating set (online mode)', { setId, field });
          const { error } = await supabase.from("sets").update(updates).eq("id", setId);

          if (error) {
            vLog.error('SetOperations', 'Online set update failed', error);
            throw error;
          }

          vLog.success('SetOperations', '✓ Set updated online', { setId });

          // PR detection for working sets (async, non-blocking)
          if (
            !currentSet.is_warmup &&
            currentSet.weight &&
            currentSet.reps &&
            userId &&
            currentExercise.exercise?.id
          ) {
            const numericWeight = parseFloat(currentSet.weight);
            const numericReps = parseInt(currentSet.reps);
            if (Number.isFinite(numericWeight) && Number.isFinite(numericReps)) {
              try {
                const prResult = await checkForPR(userId, currentExercise.exercise.id, {
                  weight: numericWeight,
                  reps: numericReps,
                  unit: currentSet.unit,
                  is_warmup: false,
                });

                if (prResult.is1RMPR) {
                  await savePR(userId, currentExercise.exercise.id, {
                    weight: numericWeight,
                    reps: numericReps,
                    unit: currentSet.unit,
                    is_warmup: false,
                  });
                }
              } catch (error) {
                console.error("PR detection error:", error);
              }
            }
          }
        } catch (error: any) {
          vLog.warning('SetOperations', 'Online set update failed, trying offline fallback', error);
          console.error('[SetOperations] Update failed:', error);

          // Fallback to offline queue if online operation fails
          const fallbackUserId = await getOfflineUserId();
          if (workoutId && fallbackUserId) {
            try {
              vLog.info('SetOperations', 'Falling back to offline queue for update', { setId });
              const currentExercise = workoutExercisesRef.current.find(
                (we) => String(we.id) === String(workoutExerciseId)
              );
              const currentSet = currentExercise?.sets.find((s) => String(s.id) === String(setId));

              if (currentSet) {
                const updates: Record<string, any> = {};
                const isUnilateral = currentSet.is_unilateral;

                if (isUnilateral) {
                  const leftWeight = currentSet.leftWeight ?? "";
                  const rightWeight = currentSet.rightWeight ?? "";
                  const leftReps = currentSet.leftReps ?? "";
                  const rightReps = currentSet.rightReps ?? "";
                  const leftRir = currentSet.leftRir ?? "";
                  const rightRir = currentSet.rightRir ?? "";

                  const aggregatedWeight = aggregateUnilateralWeight(leftWeight, rightWeight);
                  const aggregatedReps = aggregateUnilateralReps(leftReps, rightReps);
                  const aggregatedRir = aggregateUnilateralRir(leftRir, rightRir);

                  updates.weight = aggregatedWeight ?? 0;
                  updates.reps = aggregatedReps ?? 0;
                  updates.rir = aggregatedRir ?? null;
                  updates.left_weight = parseNumericString(leftWeight);
                  updates.right_weight = parseNumericString(rightWeight);
                  updates.left_reps = parseNumericString(leftReps);
                  updates.right_reps = parseNumericString(rightReps);
                  updates.left_rir = parseNumericString(leftRir);
                  updates.right_rir = parseNumericString(rightRir);
                } else {
                  updates[field] = rawValue;
                  if (field === "weight") updates.weight = parseNumericString(rawValue as string) ?? 0;
                  if (field === "reps") updates.reps = parseNumericString(rawValue as string) ?? 0;
                  if (field === "rir") updates.rir = parseNumericString(rawValue as string) ?? null;
                }

                await queueOperation({
                  workoutId,
                  type: 'update',
                  table: 'sets',
                  data: { id: setId, ...updates },
                  timestamp: new Date().toISOString(),
                  userId: fallbackUserId,
                });

                vLog.success('SetOperations', '✓ Set update saved offline (fallback)', { setId });
                toast({
                  title: 'Saved offline',
                  description: 'Will sync when connection improves',
                });

                delete updateTimeoutsRef.current[debounceKey];
                return;
              }
            } catch (queueError) {
              console.error('[SetOperations] Failed to queue update:', queueError);
            }
          }

          toast({
            title: "Error",
            description: "Failed to update set",
            variant: "destructive",
          });
        }

        delete updateTimeoutsRef.current[debounceKey];
      }, UPDATE_DEBOUNCE_MS);
    },
    [userId, workoutExercisesRef, setWorkoutExercises, toast, workoutId, getOfflineUserId]
  );

  return {
    handleAddSet,
    handleDeleteSet,
    handleUpdateSet,
  };
};
