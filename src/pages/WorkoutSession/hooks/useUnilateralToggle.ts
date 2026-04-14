/**
 * useUnilateralToggle.ts
 *
 * Hook for toggling exercises between bilateral and unilateral tracking modes.
 * This is the LARGEST single function in the original file (520 lines!).
 *
 * COMPLEXITY WARNING:
 * This hook encapsulates extremely complex logic and should be extracted carefully.
 * The original function is in WorkoutSession.tsx lines 1677-2196.
 *
 * What This Hook Should Do:
 * 1. Toggle bilateral → unilateral:
 *    - Create unilateral exercise variant in database
 *    - Fetch historical unilateral data for prefill
 *    - Convert all existing sets to unilateral format
 *    - Batch update sets in database
 *    - Handle rollback on error
 *
 * 2. Toggle unilateral → bilateral:
 *    - Fetch bilateral exercise data
 *    - Aggregate left/right values to bilateral
 *    - Convert all sets back to bilateral format
 *    - Batch update sets and workout_exercise
 *    - Handle rollback on error
 *
 * Performance Optimizations:
 * - Batch updates for all sets (single PATCH request)
 * - Optimistic UI updates with rollback
 * - Loading state during toggle (prevents duplicate operations)
 *
 * TODO: Extract from original file
 * Location: src/pages/WorkoutSession.tsx lines 1677-2196
 * Dependencies: ensureUnilateralExercise, fetchExerciseById, fetchLastSetForExercise
 *
 * @see INTEGRATION_EXAMPLE.md for usage patterns
 */

import { useCallback, startTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import type { WorkoutExercise } from "../types";
import { canEnableUnilateralToggle, stripUnilateralSuffix } from "../utils/unilateralNames";
import {
  aggregateUnilateralWeight,
  aggregateUnilateralReps,
  aggregateUnilateralRir,
  coalesceNonEmpty,
  parseNumericString,
  formatNumericString
} from "../utils/aggregations";

interface UseUnilateralToggleOptions {
  workoutId: string;
  userId: string | null;
  workoutStartedAt: string | null;
  workoutExercisesRef: React.RefObject<WorkoutExercise[]>;
  setWorkoutExercises: React.Dispatch<React.SetStateAction<WorkoutExercise[]>>;
  ensureUnilateralExercise: (baseExercise: any, userId: string) => Promise<any>;
  fetchExerciseById: (exerciseId: string) => Promise<any>;
  fetchLastSessionData: (exerciseId: string, before?: string, options?: any) => Promise<any>;
  getAuthContext: () => Promise<{ user: any; accessToken: string } | null>;
  toast: any;
}

export const useUnilateralToggle = (options: UseUnilateralToggleOptions) => {
  const {
    userId,
    workoutStartedAt,
    workoutExercisesRef,
    setWorkoutExercises,
    ensureUnilateralExercise,
    fetchExerciseById,
    fetchLastSessionData,
    getAuthContext,
    toast,
  } = options;

  /**
   * Toggles an exercise between bilateral and unilateral tracking.
   *
   * Critical Features:
   * - Batch set updates (PATCH request with all sets)
   * - Historical data prefill for new mode
   * - Optimistic updates with rollback
   * - Loading state (togglePending flag)
   * - Error handling with state restoration
   *
   * @param workoutExerciseId - ID of exercise to toggle
   * @param nextValue - true for unilateral, false for bilateral
   */
  const handleToggleUnilateral = useCallback(
    async (workoutExerciseId: string, nextValue: boolean) => {
      const exerciseIndex = workoutExercisesRef.current.findIndex((we) => String(we.id) === String(workoutExerciseId));
      if (exerciseIndex === -1) return;
      const workoutExercise = workoutExercisesRef.current[exerciseIndex];
      const currentIsUnilateral = Boolean(workoutExercise.isUnilateral ?? workoutExercise.exercise.is_unilateral);

      if (import.meta.env.DEV) {
        console.log('[useUnilateralToggle] Toggle attempt:', {
          exerciseId: workoutExerciseId,
          exerciseName: workoutExercise.exercise?.name,
          currentIsUnilateral,
          nextValue,
          exerciseForceUnilateral: workoutExercise.exercise?.forceUnilateral,
          exerciseSupportsUnilateral: workoutExercise.exercise?.supportsUnilateral,
          baseExerciseForceUnilateral: workoutExercise.baseExerciseInfo?.forceUnilateral,
          baseExerciseSupportsUnilateral: workoutExercise.baseExerciseInfo?.supportsUnilateral,
          seedId: workoutExercise.exercise?.seedId ?? workoutExercise.baseExerciseInfo?.seedId,
        });
      }

      if (currentIsUnilateral === nextValue) return;
      if (nextValue && !canEnableUnilateralToggle(workoutExercise)) {
        if (import.meta.env.DEV) {
          console.error('[useUnilateralToggle] canEnableUnilateralToggle returned false');
        }
        toast({
          title: "Unavailable",
          description: "This exercise cannot be tracked unilaterally.",
          variant: "destructive",
        });
        return;
      }
      if (workoutExercise.isOptimistic || (typeof workoutExercise.id === "string" && workoutExercise.id.startsWith("temp-ex-"))) {
        toast({
          title: "Syncing exercise",
          description: "Please wait a moment and try again.",
        });
        return;
      }

      const previousState = workoutExercisesRef.current.map((we) => ({
        ...we,
        sets: we.sets.map((set) => ({
          ...set,
          lastUnilateral: set.lastUnilateral ? { ...set.lastUnilateral } : undefined,
        })),
      }));

      startTransition(() => {
        setWorkoutExercises((prev) =>
          prev.map((we) =>
            we.id === workoutExerciseId
              ? { ...we, togglePending: true }
              : we
          )
        );
      });

      try {
        const auth = await getAuthContext();
        if (!auth) throw new Error("Not authenticated");
        const { user, accessToken } = auth;
        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();

        if (nextValue) {
          // TOGGLE TO UNILATERAL
          const baseExercise = workoutExercise.baseExerciseInfo ?? workoutExercise.exercise;

          if (import.meta.env.DEV) {
            console.log('[useUnilateralToggle] Creating unilateral variant:', {
              baseExercise: baseExercise?.name,
              baseExerciseId: baseExercise?.id,
            });
          }

          const unilateralRecord = await ensureUnilateralExercise(baseExercise, user.id);

          if (import.meta.env.DEV) {
            console.log('[useUnilateralToggle] Unilateral variant created:', {
              unilateralRecordId: unilateralRecord?.id,
              unilateralRecordName: unilateralRecord?.name,
            });
          }

          const updateExerciseResponse = await fetch(`${supabaseUrl}/rest/v1/workout_exercises?id=eq.${workoutExercise.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
            body: JSON.stringify({ exercise_id: unilateralRecord.id }),
          });

          if (!updateExerciseResponse.ok) {
            const errorText = await updateExerciseResponse.text();
            if (import.meta.env.DEV) {
              console.error('[useUnilateralToggle] Update exercise failed:', {
                status: updateExerciseResponse.status,
                statusText: updateExerciseResponse.statusText,
                errorText,
                workoutExerciseId: workoutExercise.id,
                newExerciseId: unilateralRecord.id,
              });
            }
            throw new Error(`Failed to update exercise: ${errorText}`);
          }

          let unilateralSession: Awaited<ReturnType<typeof fetchLastSessionData>> | null = null;
          try {
            const fetchParams = {
              exerciseId: String(unilateralRecord.id),
              workoutStartedAt: workoutStartedAt || undefined,
              seedId: workoutExercise.baseExerciseInfo?.seedId ?? workoutExercise.exercise?.seedId ?? null,
              exerciseName: workoutExercise.baseExerciseInfo?.name ?? workoutExercise.exercise?.name ?? null,
              isUnilateral: true,
            };

            if (import.meta.env.DEV) {
              console.log('[useUnilateralToggle] Fetching unilateral history with params:', {
                ...fetchParams,
                userId,
              });
            }

            if (!userId) {
              console.warn('[useUnilateralToggle] Cannot fetch history: userId is null');
            } else {
              unilateralSession = await fetchLastSessionData(userId, fetchParams.exerciseId, fetchParams.workoutStartedAt, {
                seedId: fetchParams.seedId,
                exerciseName: fetchParams.exerciseName,
                isUnilateral: fetchParams.isUnilateral,
              });
            }
          } catch (historyError) {
            if (import.meta.env.DEV) console.warn("Failed to load unilateral history", historyError);
          }

          const unilateralSets = unilateralSession?.lastSessionSets ?? [];

          // Check if there's ANY meaningful history data across all sets
          const hasAnyUnilateralHistory = unilateralSets.length > 0 && unilateralSets.some(set =>
            set.isUnilateral && (
              set.leftWeight || set.rightWeight ||
              set.leftReps || set.rightReps ||
              set.leftRir || set.rightRir
            )
          );

          if (import.meta.env.DEV) {
            console.log('[useUnilateralToggle] Unilateral history loaded:', {
              exerciseName: workoutExercise.exercise?.name,
              hasUnilateralSession: !!unilateralSession,
              unilateralSetsCount: unilateralSets.length,
              hasAnyUnilateralHistory,
              unilateralSets: unilateralSets.map(s => ({
                isUnilateral: s.isUnilateral,
                leftWeight: s.leftWeight,
                rightWeight: s.rightWeight,
                leftReps: s.leftReps,
                rightReps: s.rightReps,
              })),
            });
          }

          const unilateralPrefillsByIndex = workoutExercise.sets.map((set, setIndex) => {
            const zeroIndex = typeof set.set_no === "number" && set.set_no > 0 ? set.set_no - 1 : setIndex;
            const entry = unilateralSets[zeroIndex];
            // Return undefined if no entry exists or if it's not unilateral
            if (!entry || !entry.isUnilateral) return undefined;
            return entry;
          });

          if (import.meta.env.DEV) {
            console.log('[useUnilateralToggle] Prefills by index:', unilateralPrefillsByIndex.map((p, i) => ({
              setIndex: i,
              hasPrefill: !!p,
              leftWeight: p?.leftWeight,
              rightWeight: p?.rightWeight,
            })));
          }

          await Promise.all(
            workoutExercise.sets.map(async (set, setIndex) => {
              if (!set.id || String(set.id).startsWith("temp-set-")) return;

              const sessionEntry = unilateralPrefillsByIndex[setIndex];

              if (import.meta.env.DEV) {
                console.log(`[useUnilateralToggle] Set ${setIndex} cache construction:`, {
                  sessionEntry: sessionEntry ? {
                    leftWeight: sessionEntry.leftWeight,
                    rightWeight: sessionEntry.rightWeight,
                    leftReps: sessionEntry.leftReps,
                    rightReps: sessionEntry.rightReps,
                  } : null,
                  lastUnilateral: set.lastUnilateral ? {
                    leftWeight: set.lastUnilateral.leftWeight,
                    rightWeight: set.lastUnilateral.rightWeight,
                    leftReps: set.lastUnilateral.leftReps,
                    rightReps: set.lastUnilateral.rightReps,
                  } : null,
                  currentBilateral: {
                    weight: set.weight,
                    reps: set.reps,
                    rir: set.rir,
                  },
                });
              }

              // If there's ANY history in the workout (even in other sets), respect session data for this set
              // Even if THIS specific set is empty, keep it empty (don't use bilateral fallback)
              // Only use bilateral fallback if there's NO history at all for this exercise
              if (import.meta.env.DEV) {
                console.log(`[useUnilateralToggle] Set ${setIndex} history check:`, {
                  hasAnyUnilateralHistory,
                  hasSessionEntry: !!sessionEntry,
                  sessionEntry: sessionEntry ? {
                    leftWeight: sessionEntry.leftWeight,
                    rightWeight: sessionEntry.rightWeight,
                  } : null,
                });
              }

              const cache = {
                leftWeight: hasAnyUnilateralHistory
                  ? (sessionEntry?.leftWeight ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.leftWeight, set.weight),
                rightWeight: hasAnyUnilateralHistory
                  ? (sessionEntry?.rightWeight ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.rightWeight, set.weight),
                leftReps: hasAnyUnilateralHistory
                  ? (sessionEntry?.leftReps ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.leftReps, set.reps),
                rightReps: hasAnyUnilateralHistory
                  ? (sessionEntry?.rightReps ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.rightReps, set.reps),
                leftRir: hasAnyUnilateralHistory
                  ? (sessionEntry?.leftRir ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.leftRir, set.rir),
                rightRir: hasAnyUnilateralHistory
                  ? (sessionEntry?.rightRir ?? "")
                  : coalesceNonEmpty(set.lastUnilateral?.rightRir, set.rir),
              };

              if (import.meta.env.DEV) {
                console.log(`[useUnilateralToggle] Set ${setIndex} final cache:`, cache);
              }
              const leftWeight = cache.leftWeight;
              const rightWeight = cache.rightWeight;
              const leftReps = cache.leftReps;
              const rightReps = cache.rightReps;
              const leftRir = cache.leftRir;
              const rightRir = cache.rightRir;
              const aggregateWeight = aggregateUnilateralWeight(leftWeight, rightWeight);
              const aggregateReps = aggregateUnilateralReps(leftReps, rightReps);
              const aggregateRir = aggregateUnilateralRir(leftRir, rightRir);

              const payload = {
                is_unilateral: true,
                variant: "unilateral",
                left_weight: parseNumericString(leftWeight),
                right_weight: parseNumericString(rightWeight),
                left_reps: parseNumericString(leftReps),
                right_reps: parseNumericString(rightReps),
                left_rir: parseNumericString(leftRir),
                right_rir: parseNumericString(rightRir),
                weight: aggregateWeight ?? 0,
                reps: aggregateReps ?? 0,
                rir: aggregateRir ?? null,
              };
              if (import.meta.env.DEV) console.log("Toggle set patch", {
                mode: "uni-on",
                exerciseId: unilateralRecord.id,
                is_unilateral: true,
                payload,
              });

              const response = await fetch(`${supabaseUrl}/rest/v1/sets?id=eq.${set.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                  apikey: apiKey,
                },
                body: JSON.stringify(payload),
              });

              if (!response.ok) throw new Error("Failed to update set");
            })
          );

          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === workoutExerciseId
                  ? {
                      ...we,
                      exercise_id: unilateralRecord.id,
                      exercise: {
                        ...we.exercise,
                        id: unilateralRecord.id,
                        name: unilateralRecord.name,
                        equipment: unilateralRecord.equipment,
                        muscle_group: unilateralRecord.muscle_group,
                        body_part: unilateralRecord.body_part,
                        is_bodyweight: unilateralRecord.is_bodyweight,
                        is_unilateral: true,
                        base_exercise_id: unilateralRecord.base_exercise_id,
                        owner_user_id: unilateralRecord.owner_user_id,
                        seedId: we.exercise.seedId ?? we.baseExerciseInfo?.seedId,
                        forceUnilateral: we.exercise.forceUnilateral ?? we.baseExerciseInfo?.forceUnilateral ?? false,
                        supportsUnilateral: we.exercise.supportsUnilateral ?? we.baseExerciseInfo?.supportsUnilateral ?? false,
                      },
                      baseExerciseInfo: we.baseExerciseInfo ?? {
                        ...we.exercise,
                        name: stripUnilateralSuffix(we.exercise.name),
                        is_unilateral: false,
                        seedId: we.exercise.seedId ?? we.baseExerciseInfo?.seedId,
                        forceUnilateral: we.baseExerciseInfo?.forceUnilateral ?? we.exercise.forceUnilateral ?? false,
                        supportsUnilateral: we.baseExerciseInfo?.supportsUnilateral ?? we.exercise.supportsUnilateral ?? false,
                      },
                      baseExerciseId: unilateralRecord.base_exercise_id ?? we.exercise_id,
                      isUnilateral: true,
                      togglePending: false,
                      lastSessionSets: unilateralSession?.lastSessionSets ?? we.lastSessionSets,
                      lastSessionWeight: unilateralSession?.lastSessionWeight ?? we.lastSessionWeight,
                      sets: we.sets.map((set, setIndex) => {
                        const sessionEntry = unilateralPrefillsByIndex[setIndex];

                        // If there's ANY history in the workout (even in other sets), respect session data for this set
                        // Even if THIS specific set is empty, keep it empty (don't use bilateral fallback)
                        // Only use bilateral fallback if there's NO history at all for this exercise
                        const cache = {
                          leftWeight: hasAnyUnilateralHistory
                            ? (sessionEntry?.leftWeight ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.leftWeight, set.weight),
                          rightWeight: hasAnyUnilateralHistory
                            ? (sessionEntry?.rightWeight ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.rightWeight, set.weight),
                          leftReps: hasAnyUnilateralHistory
                            ? (sessionEntry?.leftReps ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.leftReps, set.reps),
                          rightReps: hasAnyUnilateralHistory
                            ? (sessionEntry?.rightReps ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.rightReps, set.reps),
                          leftRir: hasAnyUnilateralHistory
                            ? (sessionEntry?.leftRir ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.leftRir, set.rir),
                          rightRir: hasAnyUnilateralHistory
                            ? (sessionEntry?.rightRir ?? "")
                            : coalesceNonEmpty(set.lastUnilateral?.rightRir, set.rir),
                        };

                        const aggregateWeight = aggregateUnilateralWeight(cache.leftWeight, cache.rightWeight);
                        const aggregateReps = aggregateUnilateralReps(cache.leftReps, cache.rightReps);
                        const aggregateRir = aggregateUnilateralRir(cache.leftRir, cache.rightRir);

                        const hasPrefillSource =
                          Boolean(
                            sessionEntry &&
                              (sessionEntry.leftWeight ||
                                sessionEntry.rightWeight ||
                                sessionEntry.leftReps ||
                                sessionEntry.rightReps ||
                                sessionEntry.leftRir ||
                                sessionEntry.rightRir),
                          ) ||
                          Boolean(
                            set.lastUnilateral &&
                              (set.lastUnilateral.leftWeight ||
                                set.lastUnilateral.rightWeight ||
                                set.lastUnilateral.leftReps ||
                                set.lastUnilateral.rightReps ||
                                set.lastUnilateral.leftRir ||
                                set.lastUnilateral.rightRir),
                          );

                        const nextWeightEdited =
                          hasPrefillSource
                            ? false
                            : typeof set.weightEdited === "boolean"
                            ? set.weightEdited
                            : true;
                        const nextRepsEdited =
                          hasPrefillSource
                            ? false
                            : typeof set.repsEdited === "boolean"
                            ? set.repsEdited
                            : true;
                        const nextRirEdited =
                          hasPrefillSource
                            ? false
                            : typeof set.rirEdited === "boolean"
                            ? set.rirEdited
                            : true;
                        const nextWarmupEdited =
                          hasPrefillSource
                            ? false
                            : typeof set.warmupEdited === "boolean"
                            ? set.warmupEdited
                            : true;

                        return {
                          ...set,
                          is_unilateral: true,
                          leftWeight: cache.leftWeight,
                          rightWeight: cache.rightWeight,
                          leftReps: cache.leftReps,
                          rightReps: cache.rightReps,
                          leftRir: cache.leftRir,
                          rightRir: cache.rightRir,
                          weight: formatNumericString(aggregateWeight),
                          reps: formatNumericString(aggregateReps),
                          rir: aggregateRir === null ? "" : aggregateRir.toString(),
                          unit:
                            sessionEntry?.unit === "lb" || sessionEntry?.unit === "kg"
                              ? sessionEntry.unit
                              : set.unit,
                          weightEdited: nextWeightEdited,
                          repsEdited: nextRepsEdited,
                          rirEdited: nextRirEdited,
                          warmupEdited: nextWarmupEdited,
                          lastSession: hasPrefillSource
                            ? {
                                weight: formatNumericString(aggregateWeight),
                                reps: formatNumericString(aggregateReps),
                                rir: aggregateRir === null ? "" : aggregateRir.toString(),
                                isWarmup: set.is_warmup,
                                unit:
                                  sessionEntry?.unit === "lb" || sessionEntry?.unit === "kg"
                                    ? sessionEntry.unit
                                    : set.unit,
                              }
                            : set.lastSession,
                          lastUnilateral: cache,
                        };
                      }),
                    }
                  : we
              )
            );
          });
        } else {
          // TOGGLE TO BILATERAL
          const baseExerciseId = workoutExercise.baseExerciseId ?? workoutExercise.exercise.base_exercise_id ?? workoutExercise.exercise_id;
          if (!baseExerciseId) throw new Error("Missing base exercise reference");

          let bilateralSession: Awaited<ReturnType<typeof fetchLastSessionData>> | null = null;
          try {
            if (!userId) {
              console.warn('[useUnilateralToggle] Cannot fetch bilateral history: userId is null');
            } else {
              bilateralSession = await fetchLastSessionData(userId, String(baseExerciseId), workoutStartedAt || undefined, {
                seedId: workoutExercise.baseExerciseInfo?.seedId ?? workoutExercise.exercise?.seedId ?? null,
                exerciseName: workoutExercise.baseExerciseInfo?.name ?? workoutExercise.exercise?.name ?? null,
                isUnilateral: false,
              });
            }
          } catch (historyError) {
            if (import.meta.env.DEV) console.warn("Failed to load bilateral history", historyError);
          }

          const bilateralSets = bilateralSession?.lastSessionSets ?? [];
          const bilateralPrefillsByIndex = workoutExercise.sets.map((set, setIndex) => {
            const zeroIndex = typeof set.set_no === "number" && set.set_no > 0 ? set.set_no - 1 : setIndex;
            const entry = bilateralSets[zeroIndex];
            if (!entry || entry.isUnilateral) return undefined;
            const hasData = Boolean(
              (entry.weight && entry.weight !== "") ||
                (entry.reps && entry.reps !== "") ||
                (entry.rir && entry.rir !== "") ||
                typeof entry.isWarmup === "boolean"
            );
            return hasData ? entry : undefined;
          });

          const revertExerciseResponse = await fetch(`${supabaseUrl}/rest/v1/workout_exercises?id=eq.${workoutExercise.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
            body: JSON.stringify({ exercise_id: baseExerciseId }),
          });

          if (!revertExerciseResponse.ok) throw new Error("Failed to update exercise");

          await Promise.all(
            workoutExercise.sets.map(async (set, setIndex) => {
              if (!set.id || String(set.id).startsWith("temp-set-")) return;

              const cache = {
                leftWeight: coalesceNonEmpty(set.lastUnilateral?.leftWeight, set.leftWeight, set.weight),
                rightWeight: coalesceNonEmpty(set.lastUnilateral?.rightWeight, set.rightWeight, set.weight),
                leftReps: coalesceNonEmpty(set.lastUnilateral?.leftReps, set.leftReps, set.reps),
                rightReps: coalesceNonEmpty(set.lastUnilateral?.rightReps, set.rightReps, set.reps),
                leftRir: coalesceNonEmpty(set.lastUnilateral?.leftRir, set.leftRir, set.rir),
                rightRir: coalesceNonEmpty(set.lastUnilateral?.rightRir, set.rightRir, set.rir),
              };

              const aggregateWeight = aggregateUnilateralWeight(cache.leftWeight, cache.rightWeight);
              const aggregateReps = aggregateUnilateralReps(cache.leftReps, cache.rightReps);
              const aggregateRir = aggregateUnilateralRir(cache.leftRir, cache.rightRir);
              const sessionEntry = bilateralPrefillsByIndex[setIndex];
              const sessionWeight = parseNumericString(sessionEntry?.weight);
              const sessionReps = parseNumericString(sessionEntry?.reps);
              const sessionRir = parseNumericString(sessionEntry?.rir);

              const finalWeight = sessionWeight ?? aggregateWeight;
              const finalReps = sessionReps ?? aggregateReps;
              const finalRir = sessionRir ?? aggregateRir;
              const finalUnit = sessionEntry?.unit === "lb" || sessionEntry?.unit === "kg" ? sessionEntry.unit : set.unit;
              const finalWarmup = typeof sessionEntry?.isWarmup === "boolean" ? sessionEntry.isWarmup : set.is_warmup;

              const payload: Record<string, any> = {
                is_unilateral: false,
                variant: "bilateral",
                left_weight: parseNumericString(cache.leftWeight),
                right_weight: parseNumericString(cache.rightWeight),
                left_reps: parseNumericString(cache.leftReps),
                right_reps: parseNumericString(cache.rightReps),
                left_rir: parseNumericString(cache.leftRir),
                right_rir: parseNumericString(cache.rightRir),
                weight: finalWeight ?? 0,
                reps: finalReps ?? 0,
                rir: finalRir ?? null,
              };

              if (finalUnit) {
                payload.unit = finalUnit;
              }
              if (typeof finalWarmup === "boolean") {
                payload.is_warmup = finalWarmup;
              }
              if (import.meta.env.DEV) console.log("Toggle set patch", {
                mode: "uni-off",
                exerciseId: baseExerciseId,
                is_unilateral: false,
                payload,
              });

              const response = await fetch(`${supabaseUrl}/rest/v1/sets?id=eq.${set.id}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${accessToken}`,
                  apikey: apiKey,
                },
                body: JSON.stringify(payload),
              });

              if (!response.ok) throw new Error("Failed to update set");
            })
          );

          let baseExerciseRecord = workoutExercise.baseExerciseInfo;
          if (!baseExerciseRecord || baseExerciseRecord.id !== baseExerciseId) {
            const data = await fetchExerciseById(baseExerciseId);
            if (data) {
              baseExerciseRecord = {
                id: data.id,
                name: data.name,
                equipment: data.equipment,
                muscle_group: data.muscle_group,
                body_part: data.body_part ?? null,
                is_bodyweight: data.is_bodyweight ?? false,
                supabaseId: data.id,
                origin: "remote",
                is_unilateral: data.is_unilateral ?? false,
                base_exercise_id: data.base_exercise_id ?? null,
                owner_user_id: data.owner_user_id ?? null,
                seedId: workoutExercise.baseExerciseInfo?.seedId ?? workoutExercise.exercise.seedId,
                forceUnilateral: workoutExercise.baseExerciseInfo?.forceUnilateral ?? workoutExercise.exercise.forceUnilateral ?? false,
              };
            }
          }

          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === workoutExerciseId
                  ? {
                      ...we,
                      exercise_id: baseExerciseId,
                      exercise: {
                        ...(baseExerciseRecord ?? we.exercise),
                        name: baseExerciseRecord ? baseExerciseRecord.name : stripUnilateralSuffix(we.exercise.name),
                        is_unilateral: false,
                        forceUnilateral: workoutExercise.baseExerciseInfo?.forceUnilateral ?? workoutExercise.exercise.forceUnilateral ?? false,
                        supportsUnilateral: workoutExercise.baseExerciseInfo?.supportsUnilateral ?? workoutExercise.exercise.supportsUnilateral ?? false,
                      },
                      baseExerciseInfo: baseExerciseRecord ?? we.baseExerciseInfo ?? {
                        ...we.exercise,
                        name: stripUnilateralSuffix(we.exercise.name),
                        is_unilateral: false,
                        seedId: workoutExercise.baseExerciseInfo?.seedId ?? workoutExercise.exercise.seedId,
                        forceUnilateral: workoutExercise.baseExerciseInfo?.forceUnilateral ?? workoutExercise.exercise.forceUnilateral ?? false,
                        supportsUnilateral: workoutExercise.baseExerciseInfo?.supportsUnilateral ?? workoutExercise.exercise.supportsUnilateral ?? false,
                      },
                      isUnilateral: false,
                      togglePending: false,
                      lastSessionSets: bilateralSession?.lastSessionSets ?? we.lastSessionSets,
                      lastSessionWeight: bilateralSession?.lastSessionWeight ?? we.lastSessionWeight,
                      sets: we.sets.map((set, idx) => {
                        const cache = {
                          leftWeight: coalesceNonEmpty(set.lastUnilateral?.leftWeight, set.leftWeight, set.weight),
                          rightWeight: coalesceNonEmpty(set.lastUnilateral?.rightWeight, set.rightWeight, set.weight),
                          leftReps: coalesceNonEmpty(set.lastUnilateral?.leftReps, set.leftReps, set.reps),
                          rightReps: coalesceNonEmpty(set.lastUnilateral?.rightReps, set.rightReps, set.reps),
                          leftRir: coalesceNonEmpty(set.lastUnilateral?.leftRir, set.leftRir, set.rir),
                          rightRir: coalesceNonEmpty(set.lastUnilateral?.rightRir, set.rightRir, set.rir),
                        };

                        const aggregateWeight = aggregateUnilateralWeight(cache.leftWeight, cache.rightWeight);
                        const aggregateReps = aggregateUnilateralReps(cache.leftReps, cache.rightReps);
                        const aggregateRir = aggregateUnilateralRir(cache.leftRir, cache.rightRir);

                        const sessionEntry = bilateralPrefillsByIndex[idx];
                        const sessionWeightApplied = sessionEntry && !sessionEntry.isUnilateral && sessionEntry.weight !== undefined && sessionEntry.weight !== "";
                        const sessionRepsApplied = sessionEntry && !sessionEntry.isUnilateral && sessionEntry.reps !== undefined && sessionEntry.reps !== "";
                        const sessionRirApplied = sessionEntry && !sessionEntry.isUnilateral && sessionEntry.rir !== undefined && sessionEntry.rir !== "";
                        const sessionWarmupApplied = sessionEntry && !sessionEntry.isUnilateral && typeof sessionEntry.isWarmup === "boolean";

                        const resolvedWeight = sessionWeightApplied ? sessionEntry!.weight ?? "" : formatNumericString(aggregateWeight);
                        const resolvedReps = sessionRepsApplied ? sessionEntry!.reps ?? "" : formatNumericString(aggregateReps);
                        const resolvedRir = sessionRirApplied ? sessionEntry!.rir ?? "" : aggregateRir === null ? "" : aggregateRir.toString();
                        const resolvedUnit = sessionEntry?.unit === "lb" || sessionEntry?.unit === "kg" ? sessionEntry.unit : set.unit;
                        const resolvedWarmup = sessionWarmupApplied ? Boolean(sessionEntry?.isWarmup) : set.is_warmup;

                        return {
                          ...set,
                          is_unilateral: false,
                          leftWeight: cache.leftWeight,
                          rightWeight: cache.rightWeight,
                          leftReps: cache.leftReps,
                          rightReps: cache.rightReps,
                          leftRir: cache.leftRir,
                          rightRir: cache.rightRir,
                          weight: resolvedWeight,
                          reps: resolvedReps,
                          rir: resolvedRir,
                          unit: resolvedUnit,
                          is_warmup: resolvedWarmup,
                          weightEdited: sessionWeightApplied ? false : set.weightEdited,
                          repsEdited: sessionRepsApplied ? false : set.repsEdited,
                          rirEdited: sessionRirApplied ? false : set.rirEdited,
                          warmupEdited: sessionWarmupApplied ? false : set.warmupEdited,
                          lastSession: sessionEntry
                            ? {
                                weight: sessionEntry.weight ?? "",
                                reps: sessionEntry.reps ?? "",
                                rir: sessionEntry.rir ?? "",
                                isWarmup: sessionEntry.isWarmup,
                                unit: sessionEntry.unit,
                              }
                            : set.lastSession,
                          lastUnilateral: cache,
                        };
                      }),
                    }
                  : we
              )
            );
          });
        }
      } catch (error) {
        console.error("Toggle unilateral failed:", error);
        startTransition(() => setWorkoutExercises(previousState));
        toast({
          title: "Error",
          description: "Unable to toggle unilateral mode.",
          variant: "destructive",
        });
      } finally {
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === workoutExerciseId
                ? { ...we, togglePending: false }
                : we
            )
          );
        });
      }
    },
    [
      workoutStartedAt,
      workoutExercisesRef,
      setWorkoutExercises,
      ensureUnilateralExercise,
      fetchExerciseById,
      fetchLastSessionData,
      getAuthContext,
      toast,
    ]
  );

  return {
    handleToggleUnilateral,
  };
};
