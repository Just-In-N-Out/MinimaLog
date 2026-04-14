/**
 * useExerciseOperations.ts
 *
 * Hook for managing exercise operations (add/delete).
 * Handles optimistic updates, database sync, and unilateral exercise creation.
 *
 * Performance Optimizations:
 * - Optimistic UI updates for instant feedback
 * - Rollback on error to maintain consistency
 * - startTransition for non-urgent state updates
 *
 * Responsibilities:
 * - Add exercises to workout (with unilateral variant creation)
 * - Delete exercises from workout
 * - Fetch last session data for newly added exercises
 */

import { useCallback, startTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { gymExerciseSeeds, seedSupportsUnilateralToggle, nameSupportsUnilateralToggle } from "@/data/gymExercises";
import type { WorkoutExercise, WeightUnit } from "../types";
import { stripUnilateralSuffix } from "../utils/unilateralNames";
import { shouldUseOfflineMode } from "@/lib/network";
import { queueOperation, removeQueuedOperationsForIds } from "@/lib/db/operationQueue";

// Re-export Exercise type for convenience
export interface Exercise {
  id: string;
  seedId?: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  body_part?: string | null;
  is_bodyweight?: boolean;
  supabaseId?: string;
  origin?: "seed" | "custom" | "remote";
  is_unilateral?: boolean;
  base_exercise_id?: string | null;
  owner_user_id?: string | null;
  forceUnilateral?: boolean;
  supportsUnilateral?: boolean;
  image_url?: string | null;
}

interface UseExerciseOperationsOptions {
  workoutId: string;
  userId: string | null;
  workoutExercises: WorkoutExercise[];
  workoutStartedAt: string;
  workoutExercisesRef: React.RefObject<WorkoutExercise[]>;
  setWorkoutExercises: React.Dispatch<React.SetStateAction<WorkoutExercise[]>>;
  toast: any; // Type from useToast hook
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
}

/**
 * Creates memoized seed lookup maps.
 * Used for exercise metadata enrichment.
 */
const useSeedMaps = () => {
  const seedRegionMap = new Map<string, string>();
  const seedIdLookupMap = new Map<string, string>();

  gymExerciseSeeds.forEach((seed) => {
    const nameKey = seed.name.toLowerCase();
    seedRegionMap.set(nameKey, seed.primary_region || "");
    seedIdLookupMap.set(nameKey, seed.id.toString());
  });

  return { seedRegionMap, seedIdLookupMap };
};

export const useExerciseOperations = (options: UseExerciseOperationsOptions) => {
  const {
    workoutId,
    userId,
    workoutExercises,
    workoutStartedAt,
    workoutExercisesRef,
    setWorkoutExercises,
    toast,
    getAuthContext,
    fetchLastSessionData,
    resolveUserId,
  } = options;

  const { seedRegionMap, seedIdLookupMap } = useSeedMaps();

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
        console.warn('[ExerciseOperations] Failed to resolve userId for offline op:', error);
      }
    }
    return null;
  }, [userId, resolveUserId]);

  /**
   * Ensures a unilateral exercise variant exists in the database.
   * Creates one if it doesn't exist.
   *
   * Why: Unilateral exercises need separate database records to track left/right independently
   * Performance: Checks for existing before creating (avoids duplicates)
   *
   * @param baseExercise - The bilateral exercise to create unilateral variant from
   * @param userId - User ID for ownership
   * @returns Created or existing unilateral exercise record
   */
  const ensureUnilateralExercise = useCallback(
    async (baseExercise: Exercise, userId: string) => {
      const baseExerciseId = baseExercise.base_exercise_id ?? baseExercise.id;
      if (!baseExerciseId) throw new Error("Missing base exercise id");

      const baseName = stripUnilateralSuffix(baseExercise.name);
      const unilateralName = `${baseName} (Unilateral)`;

      // Check if unilateral variant already exists
      const { data: existing, error: fetchError } = await supabase
        .from("exercises")
        .select(
          "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
        )
        .eq("owner_user_id", userId)
        .eq("base_exercise_id", baseExerciseId)
        .eq("is_unilateral", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      if (fetchError && fetchError.code !== "PGRST116") {
        throw fetchError;
      }

      if (existing) {
        return existing;
      }

      // Create new unilateral variant
      const fallbackBodyPart =
        baseExercise.body_part ?? seedRegionMap.get(baseExercise.name.toLowerCase()) ?? null;

      const insertPayload = {
        owner_user_id: userId,
        name: unilateralName,
        equipment: baseExercise.equipment ?? null,
        muscle_group: baseExercise.muscle_group ?? null,
        body_part: fallbackBodyPart,
        is_bodyweight: baseExercise.is_bodyweight ?? false,
        is_unilateral: true,
        base_exercise_id: baseExerciseId,
        image_url: baseExercise.image_url ?? null,
      };

      const { data: inserted, error: insertError } = await supabase
        .from("exercises")
        .insert(insertPayload)
        .select(
          "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
        )
        .single();

      if (insertError) {
        // Handle race condition (another request created it simultaneously)
        if (insertError.code === "23505" || insertError.details?.includes("already exists")) {
          const { data: retry } = await supabase
            .from("exercises")
            .select(
              "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
            )
            .eq("owner_user_id", userId)
            .eq("base_exercise_id", baseExerciseId)
            .eq("is_unilateral", true)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();
          if (retry) return retry;
        }
        throw insertError;
      }

      return inserted;
    },
    [seedRegionMap]
  );

  /**
   * Adds an exercise to the current workout.
   * Handles both bilateral and forced unilateral exercises.
   *
   * Why optimistic update: Provides instant UI feedback (no waiting for database)
   * Why rollback: Maintains consistency if database operation fails
   *
   * Process:
   * 1. Validate exercise can be added
   * 2. Determine if unilateral variant is needed
   * 3. Create unilateral variant if necessary
   * 4. Add optimistically to state
   * 5. Insert to database
   * 6. Update with real ID on success
   * 7. Fetch last session data for prefill
   * 8. Rollback on error
   *
   * @param exercise - Exercise to add to workout
   */
  const handleAddExercise = useCallback(
    async (exercise: Exercise) => {
      const baseSupabaseId = exercise.supabaseId ?? exercise.id;
      if (!baseSupabaseId || baseSupabaseId.startsWith("seed-")) {
        toast({
          title: "Exercise unavailable",
          description: "Please try selecting the exercise again.",
          variant: "destructive",
        });
        return;
      }

      const resolvedOwnerUserId = await getOfflineUserId();
      const orderIndex = workoutExercisesRef.current.length;
      const tempId = `temp-ex-${Date.now()}`;
      const fallbackRegion =
        exercise.body_part ?? seedRegionMap.get(exercise.name.toLowerCase()) ?? null;

      const resolvedSupportsUnilateral =
        exercise.supportsUnilateral ??
        (exercise.seedId
          ? seedSupportsUnilateralToggle(exercise.seedId)
          : nameSupportsUnilateralToggle(exercise.name));

      const baseExercise: Exercise = {
        ...exercise,
        id: baseSupabaseId,
        supabaseId: baseSupabaseId,
        body_part: fallbackRegion,
        is_bodyweight: exercise.is_bodyweight ?? false,
        origin: exercise.origin ?? "seed",
        is_unilateral: exercise.is_unilateral ?? false,
        base_exercise_id: exercise.base_exercise_id ?? null,
        owner_user_id: exercise.owner_user_id ?? resolvedOwnerUserId ?? undefined,
        forceUnilateral: exercise.forceUnilateral ?? false,
        supportsUnilateral: resolvedSupportsUnilateral,
      };

      const shouldForceUnilateral = Boolean(baseExercise.forceUnilateral);

      if (shouldForceUnilateral) {
        baseExercise.forceUnilateral = true;
      }

      let finalExercise: Exercise = { ...baseExercise };
      let finalExerciseId = baseSupabaseId;
      // Start in bilateral mode by default, only use unilateral if explicitly forced
      let finalIsUnilateral = shouldForceUnilateral;
      let baseExerciseIdRef = baseExercise.base_exercise_id ?? baseSupabaseId;

      // Create unilateral variant if forced but not already unilateral
      if (shouldForceUnilateral && resolvedSupportsUnilateral && !finalIsUnilateral) {
        let effectiveUserId = userId ?? (await getOfflineUserId());
        if (!effectiveUserId) {
          const auth = await getAuthContext();
          effectiveUserId = auth?.user.id ?? "";
        }

        if (!effectiveUserId) {
          toast({
            title: "Error",
            description: "Please sign in to use this exercise.",
            variant: "destructive",
          });
          return;
        }

        try {
          const unilateralRecord = await ensureUnilateralExercise(baseExercise, effectiveUserId);
          finalExercise = {
            ...baseExercise,
            id: unilateralRecord.id,
            supabaseId: unilateralRecord.id,
            name:
              unilateralRecord.name ??
              `${stripUnilateralSuffix(baseExercise.name)} (Unilateral)`,
            equipment: unilateralRecord.equipment ?? baseExercise.equipment ?? null,
            muscle_group: unilateralRecord.muscle_group ?? baseExercise.muscle_group ?? null,
            body_part: unilateralRecord.body_part ?? baseExercise.body_part ?? null,
            is_bodyweight: unilateralRecord.is_bodyweight ?? baseExercise.is_bodyweight ?? false,
            is_unilateral: true,
            base_exercise_id: unilateralRecord.base_exercise_id ?? baseSupabaseId,
            owner_user_id: unilateralRecord.owner_user_id ?? baseExercise.owner_user_id,
            forceUnilateral: true,
          };
          finalExerciseId = finalExercise.id;
          finalIsUnilateral = true;
          baseExerciseIdRef = finalExercise.base_exercise_id ?? baseSupabaseId;
        } catch (error) {
          console.error("Failed to ensure unilateral exercise", error);
          toast({
            title: "Error",
            description: "Unable to prepare unilateral exercise.",
            variant: "destructive",
          });
          return;
        }
      }

      const optimisticExercise: Exercise = {
        ...finalExercise,
        id: finalExerciseId,
        supabaseId: finalExerciseId,
        forceUnilateral: shouldForceUnilateral || Boolean(finalExercise.forceUnilateral),
        supportsUnilateral: resolvedSupportsUnilateral,
      };

      const baseExerciseInfo: Exercise = {
        ...baseExercise,
        id: baseSupabaseId,
        supabaseId: baseSupabaseId,
        name: stripUnilateralSuffix(baseExercise.name),
        is_unilateral: false,
        forceUnilateral: shouldForceUnilateral,
        supportsUnilateral: resolvedSupportsUnilateral,
      };

      // Optimistic update: Add immediately to UI
      startTransition(() => {
        setWorkoutExercises((prev) => {
          const hasTemp = prev.some((we) => we.id === tempId);
          if (hasTemp) {
            return prev;
          }

          return [
            ...prev,
            {
              id: tempId,
              clientId: tempId,
              exercise_id: finalExerciseId,
              order_index: orderIndex,
              exercise: optimisticExercise,
              sets: [],
              lastSessionWeight: undefined,
              lastSessionSets: [],
              isOptimistic: true,
              baseExerciseId: baseExerciseIdRef,
              isUnilateral: finalIsUnilateral,
              baseExerciseInfo,
              togglePending: false,
            },
          ];
        });
      });

      const useOffline = shouldUseOfflineMode();

      if (useOffline) {
        // OFFLINE MODE: Queue operation
        try {
          const effectiveUserId = resolvedOwnerUserId ?? (await getOfflineUserId());
          if (!effectiveUserId) {
            throw new Error("User ID required for offline operation");
          }

          await queueOperation({
            workoutId,
            type: 'insert',
            table: 'workout_exercises',
            data: {
              id: tempId,
              workout_id: workoutId,
              exercise_id: finalExerciseId,
              order_index: orderIndex,
              group_id: null,
            },
            timestamp: new Date().toISOString(),
            userId: effectiveUserId,
          });

          console.log('[ExerciseOperations] Queued exercise creation (offline):', tempId);

          // Update to remove optimistic flag (queued = confirmed locally)
          startTransition(() => {
            setWorkoutExercises((prev) =>
              prev.map((we) =>
                we.id === tempId ? { ...we, isOptimistic: false, clientId: we.clientId ?? tempId } : we
              )
            );
          });

          // Fetch last session data for prefill (async, non-blocking)
          if (workoutStartedAt && effectiveUserId) {
            void fetchLastSessionData(effectiveUserId, finalExerciseId, workoutStartedAt, {
              seedId: exercise.seedId ?? baseExercise.seedId,
              exerciseName: finalExercise.name,
              isUnilateral: finalIsUnilateral,
            })
              .then((lastSession) => {
                if (lastSession?.lastSessionSets?.length) {
                  startTransition(() => {
                    setWorkoutExercises((prev) =>
                      prev.map((we) =>
                        we.id === tempId
                          ? {
                              ...we,
                              lastSessionWeight: lastSession.lastSessionWeight,
                              lastSessionSets: lastSession.lastSessionSets,
                            }
                          : we
                      )
                    );
                  });
                }
              })
              .catch(() => {
                if (import.meta.env.DEV) console.warn("last session fetch failed");
              });
          }

          return;
        } catch (error: any) {
          console.error('[ExerciseOperations] Failed to queue:', error);
          toast({
            title: 'Offline save failed',
            description: 'Please check storage settings',
            variant: 'destructive',
          });
          // Rollback optimistic update
          startTransition(() => {
            setWorkoutExercises((prev) => prev.filter((we) => we.id !== tempId));
          });
          return;
        }
      }

      try {
        // ONLINE MODE: Insert to database
        const { data: workoutEx, error } = await supabase
          .from("workout_exercises")
          .insert({
            workout_id: workoutId,
            exercise_id: finalExerciseId,
            order_index: orderIndex,
          })
          .select()
          .single();

        if (error) throw error;
        if (!workoutEx) throw new Error("Failed to add exercise");

        // Update with real ID
        startTransition(() => {
          setWorkoutExercises((prev) =>
            prev.map((we) =>
              we.id === tempId
                ? {
                    ...workoutEx,
                    exercise: optimisticExercise,
                    sets: [],
                    lastSessionWeight: undefined,
                    lastSessionSets: [],
                    isOptimistic: false,
                    baseExerciseId: baseExerciseIdRef,
                    isUnilateral: finalIsUnilateral,
                    baseExerciseInfo,
                    togglePending: false,
                    clientId: we.clientId ?? tempId,
                  }
                : we
            )
          );
        });

        // Fetch last session data for prefill (async, non-blocking)
        const onlinePrefillUserId = userId ?? (await getOfflineUserId());
        if (workoutStartedAt && onlinePrefillUserId) {
          console.log('[ExerciseOperations] Fetching prefill data for:', {
            exerciseId: finalExerciseId,
            exerciseName: finalExercise.name,
            isUnilateral: finalIsUnilateral,
          });
          void fetchLastSessionData(onlinePrefillUserId, finalExerciseId, workoutStartedAt, {
            seedId: exercise.seedId ?? baseExercise.seedId,
            exerciseName: finalExercise.name,
            isUnilateral: finalIsUnilateral,
          })
            .then((lastSession) => {
              console.log('[ExerciseOperations] Prefill data received:', {
                exerciseId: finalExerciseId,
                hasSets: !!lastSession?.lastSessionSets?.length,
                setsCount: lastSession?.lastSessionSets?.length || 0,
                lastSessionWeight: lastSession?.lastSessionWeight,
              });
              if (lastSession?.lastSessionSets?.length) {
                startTransition(() => {
                  setWorkoutExercises((prev) =>
                    prev.map((we) =>
                      we.id === workoutEx.id
                        ? {
                            ...we,
                            lastSessionWeight: lastSession.lastSessionWeight,
                            lastSessionSets: lastSession.lastSessionSets,
                          }
                        : we
                    )
                  );
                });
              }
            })
            .catch((error) => {
              console.error('[ExerciseOperations] Last session fetch failed:', error);
            });
        }
      } catch (error: any) {
        console.error('[ExerciseOperations] Online insert failed:', error);

        // Fallback to offline queue
        const fallbackUserId = await getOfflineUserId();
        if (workoutId && fallbackUserId) {
          try {
            await queueOperation({
              workoutId,
              type: 'insert',
              table: 'workout_exercises',
              data: {
                id: tempId,
                workout_id: workoutId,
                exercise_id: finalExerciseId,
                order_index: orderIndex,
                group_id: null,
              },
              timestamp: new Date().toISOString(),
              userId: fallbackUserId,
            });

            toast({
              title: 'Saved offline',
              description: 'Will sync when connection improves',
            });

            // Update to remove optimistic flag
            startTransition(() => {
              setWorkoutExercises((prev) =>
                prev.map((we) =>
                  we.id === tempId ? { ...we, isOptimistic: false, clientId: we.clientId ?? tempId } : we
                )
              );
            });
            return;
          } catch (queueError) {
            console.error('[ExerciseOperations] Failed to queue:', queueError);
          }
        }

        // Rollback on complete failure
        startTransition(() => {
          setWorkoutExercises((prev) => prev.filter((we) => we.id !== tempId));
        });

        toast({
          title: "Error",
          description: "Failed to add exercise",
          variant: "destructive",
        });
      }
    },
    [
      userId,
      workoutId,
      workoutStartedAt,
      workoutExercisesRef,
      setWorkoutExercises,
      toast,
      getAuthContext,
      fetchLastSessionData,
      ensureUnilateralExercise,
      seedRegionMap,
      seedIdLookupMap,
      getOfflineUserId,
    ]
  );

  /**
   * Deletes an exercise from the current workout.
   *
   * Why optimistic update: Provides instant feedback (exercise disappears immediately)
   * Why rollback: Restores exercise if database deletion fails
   *
   * Process:
   * 1. Find exercise in current state
   * 2. Handle optimistic exercises (not yet in database)
   * 3. Save copy of all exercises for rollback
   * 4. Remove optimistically from state
   * 5. Delete from database
   * 6. Rollback on error
   *
   * @param workoutExerciseId - ID of workout_exercise to delete
   */
  const handleDeleteExercise = useCallback(
    async (workoutExerciseId: string) => {
      const exercise = workoutExercisesRef.current.find(
        (we) => String(we.id) === String(workoutExerciseId)
      );
      if (!exercise) return;

      // Handle optimistic exercises (not yet in database)
      if (workoutExerciseId.startsWith("temp-ex-") || exercise.isOptimistic) {
        startTransition(() => {
          setWorkoutExercises((prev) => prev.filter((we) => we.id !== workoutExerciseId));
        });

        // Remove any queued operations referencing this optimistic exercise or its sets
        const cleanupUserId = await getOfflineUserId();
        if (workoutId && cleanupUserId) {
          const relatedSetIds = exercise.sets
            .map((set) => (set.id ? String(set.id) : null))
            .filter((id): id is string => Boolean(id && id.startsWith("temp-set-")));
          void removeQueuedOperationsForIds(workoutId, [
            workoutExerciseId,
            ...relatedSetIds,
          ], cleanupUserId);
        }

        toast({
          title: "Exercise removed",
        });
        return;
      }

      // Save copy for rollback
      const previousExercises = workoutExercisesRef.current.map((we) => ({
        ...we,
        sets: we.sets.map((set) => ({ ...set })),
      }));

      // Optimistic removal
      startTransition(() => {
        setWorkoutExercises((prev) =>
          prev.filter((we) => String(we.id) !== String(workoutExerciseId))
        );
      });

      const useOffline = shouldUseOfflineMode();

      try {
        if (useOffline) {
          // OFFLINE MODE: Queue delete
          const deleteUserId = await getOfflineUserId();
          if (workoutId && deleteUserId) {
            await queueOperation({
              workoutId,
              type: 'delete',
              table: 'workout_exercises',
              data: { id: workoutExerciseId },
              timestamp: new Date().toISOString(),
              userId: deleteUserId,
            });
            console.log('[ExerciseOperations] Queued exercise deletion (offline):', workoutExerciseId);
            toast({
              title: "Exercise removed",
            });
            return;
          }
        }

        // ONLINE MODE: Delete from database
        const { error } = await supabase
          .from("workout_exercises")
          .delete()
          .eq("id", workoutExerciseId);

        if (error) throw error;

        toast({
          title: "Exercise removed",
        });
      } catch (error: any) {
        console.error('[ExerciseOperations] Delete failed:', error);

        // Fallback to offline queue
        const fallbackUserId = await getOfflineUserId();
        if (workoutId && fallbackUserId) {
          try {
            await queueOperation({
              workoutId,
              type: 'delete',
              table: 'workout_exercises',
              data: { id: workoutExerciseId },
              timestamp: new Date().toISOString(),
              userId: fallbackUserId,
            });

            toast({
              title: 'Saved offline',
              description: 'Will sync when connection improves',
            });
            return;
          } catch (queueError) {
            console.error('[ExerciseOperations] Failed to queue delete:', queueError);
          }
        }

        // Rollback on complete failure
        startTransition(() => {
          setWorkoutExercises(previousExercises);
        });
        toast({
          title: "Error",
          description: "Failed to delete exercise",
          variant: "destructive",
        });
      }
    },
    [workoutId, userId, workoutExercisesRef, setWorkoutExercises, toast, getOfflineUserId]
  );

  /**
   * Reorders exercises in the current workout.
   * Updates order_index values for all affected exercises.
   *
   * Why optimistic update: Provides instant drag-and-drop feedback
   * Why rollback: Restores original order if database update fails
   *
   * Process:
   * 1. Save copy of exercises for rollback
   * 2. Update state with new order
   * 3. Calculate new order_index values
   * 4. Batch update database
   * 5. Rollback on error
   *
   * @param reorderedExercises - Array of exercises in new order
   */
  const handleReorderExercises = useCallback(
    async (reorderedExercises: WorkoutExercise[]) => {
      // Save copy for rollback
      const previousExercises = workoutExercisesRef.current.map((we) => ({
        ...we,
        sets: we.sets.map((set) => ({ ...set })),
      }));

      // Optimistic update: Apply new order immediately
      const reorderedWithNewIndices = reorderedExercises.map((exercise, index) => ({
        ...exercise,
        order_index: index,
      }));

      startTransition(() => {
        setWorkoutExercises(reorderedWithNewIndices);
      });

      const useOffline = shouldUseOfflineMode();

      try {
        if (useOffline) {
          // OFFLINE MODE: Queue reorder operations
          const reorderUserId = await getOfflineUserId();
          if (workoutId && reorderUserId) {
            // Queue update for each exercise with changed order_index
            const updatePromises = reorderedWithNewIndices
              .filter((exercise) => {
                const original = previousExercises.find((e) => e.id === exercise.id);
                return original && original.order_index !== exercise.order_index;
              })
              .map((exercise) =>
                queueOperation({
                  workoutId,
                  type: 'update',
                  table: 'workout_exercises',
                  data: {
                    id: exercise.id,
                    order_index: exercise.order_index,
                  },
                  timestamp: new Date().toISOString(),
                  userId: reorderUserId,
                })
              );

            await Promise.all(updatePromises);
            console.log('[ExerciseOperations] Queued exercise reorder (offline)');
            return;
          }
        }

        // ONLINE MODE: Batch update to database
        const updatePromises = reorderedWithNewIndices
          .filter((exercise) => !exercise.id?.toString().startsWith("temp-ex-"))
          .map((exercise) =>
            supabase
              .from("workout_exercises")
              .update({ order_index: exercise.order_index })
              .eq("id", exercise.id)
          );

        const results = await Promise.all(updatePromises);

        // Check if any update failed
        const errors = results.filter((result) => result.error);
        if (errors.length > 0) {
          throw new Error(`Failed to update ${errors.length} exercise(s)`);
        }

        console.log('[ExerciseOperations] Exercise reorder complete');
      } catch (error: any) {
        console.error('[ExerciseOperations] Reorder failed:', error);

        // Fallback to offline queue
        const fallbackUserId = await getOfflineUserId();
        if (workoutId && fallbackUserId) {
          try {
            const updatePromises = reorderedWithNewIndices
              .filter((exercise) => {
                const original = previousExercises.find((e) => e.id === exercise.id);
                return original && original.order_index !== exercise.order_index;
              })
              .map((exercise) =>
                queueOperation({
                  workoutId,
                  type: 'update',
                  table: 'workout_exercises',
                  data: {
                    id: exercise.id,
                    order_index: exercise.order_index,
                  },
                  timestamp: new Date().toISOString(),
                  userId: fallbackUserId,
                })
              );

            await Promise.all(updatePromises);

            toast({
              title: 'Saved offline',
              description: 'Will sync when connection improves',
            });
            return;
          } catch (queueError) {
            console.error('[ExerciseOperations] Failed to queue reorder:', queueError);
          }
        }

        // Rollback on complete failure
        startTransition(() => {
          setWorkoutExercises(previousExercises);
        });

        toast({
          title: "Error",
          description: "Failed to reorder exercises",
          variant: "destructive",
        });
      }
    },
    [workoutId, userId, workoutExercisesRef, setWorkoutExercises, toast, getOfflineUserId]
  );

  return {
    handleAddExercise,
    handleDeleteExercise,
    handleReorderExercises,
    ensureUnilateralExercise,
  };
};
