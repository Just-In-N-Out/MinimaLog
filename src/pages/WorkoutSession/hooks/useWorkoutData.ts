/**
 * useWorkoutData.ts
 *
 * Hook for loading workout data from Supabase.
 * Handles fetching workout exercises, sets, user preferences, and last session data.
 *
 * Performance Optimizations:
 * - Parallel loading of sets for multiple exercises
 * - Database-level filtering (uses inner joins)
 * - Memoized callbacks to prevent recreation on every render
 *
 * Responsibilities:
 * - Load workout exercises and sets
 * - Fetch last session data for prefill
 * - Load user preferences (unit default)
 * - Format database values for form inputs
 */

import { useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchLastCompletedSets } from "@/lib/history";
import { getSupabaseSession, getCachedUserId } from "@/lib/session";
import { useSubscription } from "@/hooks/useSubscription";
import {
  gymExerciseSeeds,
  seedSupportsUnilateralToggle,
  nameSupportsUnilateralToggle,
} from "@/data/gymExercises";
import type { WorkoutExercise, WeightUnit } from "../types";
import { stripUnilateralSuffix } from "../utils/unilateralNames";
import { shouldUseOfflineMode } from "@/lib/network";
import { getDB } from "@/lib/db/indexedDB";
import { getCachedExerciseHistory, cacheExerciseHistory } from "@/lib/cache/workoutHistoryCache";

/**
 * Creates memoized seed lookup maps for exercise metadata.
 * These maps enable O(1) lookups for seed IDs and body regions.
 *
 * Why: Prevents re-creating maps on every render (expensive with 800+ seeds)
 * Performance: O(1) lookups instead of O(n) array searches
 */
const useSeedMaps = () => {
  return useMemo(() => {
    const seedRegionMap = new Map<string, string>();
    const seedIdLookupMap = new Map<string, string>();

    gymExerciseSeeds.forEach((seed) => {
      const nameKey = seed.name.toLowerCase();
      seedRegionMap.set(nameKey, seed.primary_region || "");
      seedIdLookupMap.set(nameKey, seed.id.toString());
    });

    return { seedRegionMap, seedIdLookupMap };
  }, []);
};

export const useWorkoutData = (
  workoutId: string | undefined,
  toast: any // Type from useToast hook
) => {
  const { seedRegionMap, seedIdLookupMap } = useSeedMaps();
  const { isPremium } = useSubscription();
  const prefillErrorExercisesRef = useRef<Set<string>>(new Set());

  /**
   * Gets the current authenticated user context.
   * Used for fetching user-specific data.
   *
   * Why: Centralized auth check prevents duplication
   * Performance: Single session check, memoized with useCallback
   */
  const getAuthContext = useCallback(async () => {
    try {
      const session = await getSupabaseSession();
      if (!session?.user || !session?.access_token) {
        throw new Error("Not authenticated");
      }
      return { user: session.user, accessToken: session.access_token };
    } catch (error) {
      console.error("Failed to get auth context:", error);
      return null;
    }
  }, []);

  /**
   * Fetches the last exercise by ID from the database.
   * Used for creating unilateral exercise variants.
   *
   * Why: Retrieves full exercise metadata for cloning
   * Performance: O(1) database lookup with primary key
   */
  const fetchExerciseById = useCallback(async (exerciseId: string) => {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .eq("id", exerciseId)
      .maybeSingle();

    if (error) throw error;
    return data;
  }, []);

  /**
   * Fetches the last set performed for an exercise.
   * Used for prefilling new sets with recent data.
   *
   * Why: Provides convenient defaults based on recent performance
   * Performance: O(1) with index on (exercise_id, created_at DESC)
   *
   * @param userId - User ID for filtering
   * @param exerciseId - Exercise ID to fetch
   * @param isUnilateral - Filter by unilateral/bilateral mode
   * @returns Last set data or null if none found
   */
  const fetchLastSetForExercise = useCallback(
    async (
      userId: string | null | undefined,
      exerciseId: string | null | undefined,
      isUnilateral: boolean
    ) => {
      if (!userId || !exerciseId) return null;

      // Prefill is premium-only feature
      if (!isPremium) return null;

      try {
        const { data, error } = await supabase
          .from("sets")
          .select(
            "id,weight,reps,rir,rpe,notes,unit,is_warmup,left_weight,right_weight,left_reps,right_reps,left_rir,right_rir,workout_exercises!inner(exercise_id,workouts!inner(user_id))"
          )
          .eq("workout_exercises.exercise_id", exerciseId)
          .eq("workout_exercises.workouts.user_id", userId)
          .eq("is_unilateral", isUnilateral)
          .order("created_at", { ascending: false, nullsLast: true })
          .limit(1);

        if (error) throw error;
        if (!data || data.length === 0) return null;

        const row = data[0] as Record<string, any>;
        const normalize = (value: any) => {
          if (value === null || value === undefined) return "";
          return String(value);
        };

        return {
          unit: row.unit ?? null,
          isWarmup: Boolean(row.is_warmup),
          weight: normalize(row.weight),
          reps: normalize(row.reps),
          rir: normalize(row.rir),
          rpe: normalize(row.rpe),
          notes: row.notes ?? "",
          leftWeight: normalize(row.left_weight),
          rightWeight: normalize(row.right_weight),
          leftReps: normalize(row.left_reps),
          rightReps: normalize(row.right_reps),
          leftRir: normalize(row.left_rir),
          rightRir: normalize(row.right_rir),
        };
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Failed to fetch last set for exercise");
        return null;
      }
    },
    [isPremium]
  );

  /**
   * Fetches last completed session data for an exercise.
   * Uses optimized history.ts helper for database-level filtering.
   *
   * Why: Provides prefill data for all sets in a session
   * Performance: Database-level filtering reduces data transfer by 40-50%
   *              (see BACKEND_PERFORMANCE.md section 3.2)
   *
   * @param userId - User ID for filtering
   * @param exerciseId - Exercise ID to fetch
   * @param beforeDate - Only fetch sessions before this date
   * @param options - Additional filtering options
   * @returns Last session weight summary and sets array
   */
  const fetchLastSessionData = useCallback(
    async (
      userId: string,
      exerciseId: string,
      beforeDate?: string,
      options?: { seedId?: string | null; exerciseName?: string | null; isUnilateral?: boolean; exerciseIndex?: number }
    ) => {
      if (!userId || !exerciseId) {
        return {
          lastSessionWeight: undefined,
          lastSessionSets: [] as WorkoutExercise["lastSessionSets"],
        };
      }

      // Free users only get workout history prefill for the first exercise
      // Premium users get it for all exercises
      if (!isPremium && options?.exerciseIndex !== undefined && options.exerciseIndex >= 1) {
        return {
          lastSessionWeight: undefined,
          lastSessionSets: [] as WorkoutExercise["lastSessionSets"],
        };
      }

      try {
        // Use optimized fetchLastCompletedSets from history.ts
        // This applies database-level filtering (not client-side)
        const snapshot = await fetchLastCompletedSets({
          supabase,
          userId,
          exerciseId,
          beforeDate,
          context: "workout_session",
          variant: options?.isUnilateral ? "unilateral" : "bilateral",
        });

        if (snapshot.sets.length > 0) {
          void cacheExerciseHistory(
            userId,
            exerciseId,
            options?.exerciseName ?? "Unknown Exercise",
            snapshot,
            { force: true }
          ).catch((error) => {
            console.warn("[WorkoutData] Failed to cache exercise history:", {
              exerciseId,
              error,
            });
          });
        }

        const orderedSets = [...snapshot.sets].sort((a, b) => a.setNo - b.setNo);
        if (orderedSets.length === 0) {
          return {
            lastSessionWeight: undefined,
            lastSessionSets: [] as WorkoutExercise["lastSessionSets"],
          };
        }

        const toStringOrEmpty = (value: number | null, allowZero = false) => {
          if (value === null || value === undefined) return "";
          if (!allowZero && value === 0) return "";
          if (!Number.isFinite(value)) return "";
          return value.toString();
        };

        // Build summary string for display (e.g., "1: 100kg x 10 • 2: 100kg x 8")
        const summarySegments = orderedSets.map((set, index) => {
          const labelNo = set.setNo || index + 1;
          const baseWeight =
            set.weight ?? (set.isUnilateral ? set.leftWeight ?? set.rightWeight ?? null : null);
          const baseReps =
            set.reps ?? (set.isUnilateral ? set.leftReps ?? set.rightReps ?? null : null);
          const unitLabel = set.unit ? set.unit : "";
          const weightLabel =
            baseWeight !== null && Number.isFinite(baseWeight) ? baseWeight.toString() : "-";
          const repsLabel =
            baseReps !== null && Number.isFinite(baseReps) ? baseReps.toString() : "-";
          return `${labelNo}: ${weightLabel}${unitLabel ? unitLabel : ""} x ${repsLabel}`;
        });

        // Convert to format expected by WorkoutExercise type
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

        return {
          lastSessionWeight: summarySegments.join(" • "),
          lastSessionSets,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch last session data";
        console.error("Failed to fetch last session data", { exerciseId, error });

        // Show error toast only once per exercise (prevents spam)
        if (!prefillErrorExercisesRef.current.has(exerciseId)) {
          prefillErrorExercisesRef.current.add(exerciseId);
          console.warn("[WorkoutData] Prefill unavailable:", { exerciseId, message });
        }

        return {
          lastSessionWeight: undefined,
          lastSessionSets: [] as WorkoutExercise["lastSessionSets"],
        };
      }
    },
    [isPremium, toast]
  );

  /**
   * Loads user preferences from the database.
   * Currently fetches unit preference (kg/lb).
   *
   * Why: Ensures user sees weights in their preferred unit
   * Performance: O(1) database lookup with primary key
   *
   * @returns User ID and unit preference
   */
  const loadUserPreferences = useCallback(async () => {
    try {
      const auth = await getAuthContext();
      const isOffline = shouldUseOfflineMode();

      // In offline mode, use cached user ID if no auth
      if (!auth && isOffline) {
        const cachedUserId = await getCachedUserId();
        if (cachedUserId) {
          console.log("[WorkoutData] Using cached user ID in offline mode:", cachedUserId);
          return { userId: cachedUserId, unitDefault: "kg" as WeightUnit };
        }
      }

      if (!auth) return { userId: null, unitDefault: "kg" as WeightUnit };

      const { user } = auth;

      const { data: profile, error } = await supabase
        .from("profiles")
        .select("unit_default")
        .eq("id", user.id)
        .maybeSingle();

      if (error) throw error;

      return {
        userId: user.id,
        unitDefault: (profile?.unit_default === "lb" ? "lb" : "kg") as WeightUnit,
      };
    } catch (error) {
      console.error("Failed to load user preferences:", error);

      // Fallback to cached user ID in offline mode
      const isOffline = shouldUseOfflineMode();
      if (isOffline) {
        const cachedUserId = await getCachedUserId();
        if (cachedUserId) {
          console.log("[WorkoutData] Fallback to cached user ID after error:", cachedUserId);
          return { userId: cachedUserId, unitDefault: "kg" as WeightUnit };
        }
      }

      return { userId: null, unitDefault: "kg" as WeightUnit };
    }
  }, [getAuthContext]);

  /**
   * Loads complete workout data including exercises, sets, and last session data.
   * This is the main data loading function for the workout session.
   *
   * Why: Single function orchestrates all data loading for workout view
   * Performance: Parallel Promise.all for sets loading (fast)
   *              Uses optimized fetchLastSessionData (database-level filtering)
   *
   * Process:
   * 1. Fetch workout exercises (ordered)
   * 2. Fetch workout metadata (started_at)
   * 3. For each exercise:
   *    - Fetch all sets
   *    - Fetch last session data for prefill
   *    - Enrich with seed metadata
   * 4. Format all data for form inputs (strings)
   *
   * @param userId - User ID for filtering
   * @returns Array of WorkoutExercise with sets and metadata
   */
  const loadWorkoutFromCache = useCallback(
    async (userId: string) => {
      if (!workoutId) return { exercises: [], startedAt: new Date().toISOString() };

      try {
        const db = await getDB();
        const cachedWorkout = await db.get('workouts', workoutId);

        if (!cachedWorkout) {
          console.log('[loadWorkout] Workout not found in offline cache:', workoutId);
          return { exercises: [], startedAt: new Date().toISOString() };
        }

        console.log('[loadWorkout] Loaded workout from IndexedDB:', workoutId);

        // Populate lastSessionSets from cached history for each exercise
        const exercises = cachedWorkout.data.exercises || [];
        console.log('[loadWorkout] Exercises from IndexedDB:', {
          count: exercises.length,
          exercisesWithLastSession: exercises.filter((ex: any) => ex.lastSessionSets && ex.lastSessionSets.length > 0).length,
        });

        for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex++) {
          const exercise = exercises[exerciseIndex];
          try {
            // Free users only get workout history prefill for the first exercise
            if (!isPremium && exerciseIndex >= 1) {
              exercise.lastSessionSets = [];
              continue;
            }

            const cachedHistory = await getCachedExerciseHistory(userId, exercise.exercise_id);
            const isSameWorkoutHistory =
              cachedHistory?.workoutId && workoutId
                ? String(cachedHistory.workoutId) === String(workoutId)
                : false;

            console.log('[loadWorkout] Exercise history check:', {
              exerciseId: exercise.exercise_id,
              name: exercise.exercise?.name,
              hasCachedHistory: !!cachedHistory,
              cachedWorkoutId: cachedHistory?.workoutId,
              isSameWorkoutHistory,
              hasExistingLastSessionSets: !!(exercise.lastSessionSets && exercise.lastSessionSets.length > 0),
            });

            // Skip cached history if it's from the current workout
            // BUT only if exercise already has lastSessionSets populated
            // This prevents losing comparison data when cache gets corrupted
            if (isSameWorkoutHistory) {
              if (exercise.lastSessionSets && exercise.lastSessionSets.length > 0) {
                // Exercise already has lastSessionSets, safe to skip
                console.log('[loadWorkout] Keeping existing lastSessionSets (cache is from current workout)');
                continue;
              }
              // Exercise doesn't have lastSessionSets and cache is from current workout (corrupted)
              // Clear the corrupted cache entry so next online fetch will re-populate it correctly
              console.log('[loadWorkout] Cache from current workout, but no lastSessionSets. Clearing corrupted cache entry.');
              try {
                const cacheKey = `${userId}-${exercise.exercise_id}`;
                await db.delete('workout_history', cacheKey);
                console.log('[loadWorkout] Cleared corrupted workout_history cache entry:', cacheKey);
              } catch (clearError) {
                console.warn('[loadWorkout] Failed to clear corrupted cache:', clearError);
              }
              continue;
            }

            if (cachedHistory && cachedHistory.sets && cachedHistory.sets.length > 0) {
              // Map cached sets to lastSessionSets format (must match online mode structure)
              exercise.lastSessionSets = cachedHistory.sets.map((s: any) => ({
                weight: s.weight?.toString() || "",
                reps: s.reps?.toString() || "",
                rir: s.rir?.toString() || "",
                isWarmup: s.isWarmup || false,
                unit: s.unit ?? undefined,
                isUnilateral: s.isUnilateral || false,
                leftWeight: s.leftWeight?.toString() || "",
                rightWeight: s.rightWeight?.toString() || "",
                leftReps: s.leftReps?.toString() || "",
                rightReps: s.rightReps?.toString() || "",
                leftRir: s.leftRir?.toString() || "",
                rightRir: s.rightRir?.toString() || "",
              }));

              console.log('[loadWorkout] Populated lastSessionSets for exercise:', exercise.exercise_id);
            }
          } catch (error) {
            console.error('[loadWorkout] Failed to load cached history for exercise:', exercise.exercise_id, error);
          }
        }

        // Enrich exercises with fresh image_url if missing from cache
        try {
          const exerciseIds = exercises.map((ex: any) => ex.exercise_id).filter(Boolean);
          if (exerciseIds.length > 0) {
            const { data: freshExercises } = await supabase
              .from('exercises')
              .select('id, image_url')
              .in('id', exerciseIds);

            if (freshExercises) {
              const imageMap = new Map(freshExercises.map(ex => [ex.id, ex.image_url]));
              for (const exercise of exercises) {
                if (exercise.exercise && !exercise.exercise.image_url) {
                  const imageUrl = imageMap.get(exercise.exercise_id);
                  if (imageUrl) {
                    exercise.exercise.image_url = imageUrl;
                    console.log('[loadWorkout] Enriched exercise with image_url:', exercise.exercise_id);
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('[loadWorkout] Failed to enrich exercises with image_url:', error);
        }

        return {
          exercises,
          startedAt: cachedWorkout.data.workoutStartedAt || cachedWorkout.data.startedAt || new Date().toISOString(),
        };
      } catch (error) {
        console.error('[loadWorkout] Failed to load from IndexedDB:', error);
        return { exercises: [], startedAt: new Date().toISOString() };
      }
    },
    [workoutId]
  );

  const loadWorkout = useCallback(
    async (userId: string) => {
      if (!workoutId) return { exercises: [], startedAt: new Date().toISOString() };

      // Check if we're in offline mode
      const useOffline = shouldUseOfflineMode();

      if (useOffline) {
        return loadWorkoutFromCache(userId);
      }

      // ONLINE MODE: Load from Supabase
      try {
        // Step 1: Fetch workout exercises with basic exercise info
        const { data: workoutExs, error: workoutExsError } = await supabase
          .from("workout_exercises")
          .select(
            "id, exercise_id, order_index, exercise:exercises!workout_exercises_exercise_id_fkey(id,name,equipment,muscle_group,is_unilateral,base_exercise_id,owner_user_id,image_url)"
          )
          .eq("workout_id", workoutId)
          .order("order_index", { ascending: true });

        if (workoutExsError) throw workoutExsError;

        // Step 2: Fetch workout metadata and check if created from template
        const { data: currentWorkout, error: workoutError } = await supabase
          .from("workouts")
          .select("started_at,user_id,template_id")
          .eq("id", workoutId)
          .maybeSingle();

        if (workoutError) throw workoutError;

        // If Supabase doesn't know about this workout yet but we have cached data, fall back to cache
        if ((!workoutExs || workoutExs.length === 0) || !currentWorkout) {
          try {
            const db = await getDB();
            const cachedWorkout = await db.get('workouts', workoutId);
            const hasOfflineExercises = cachedWorkout?.data?.exercises?.length > 0;
            const pendingSync = cachedWorkout && cachedWorkout.synced === false;

            if (cachedWorkout && hasOfflineExercises && pendingSync) {
              console.log('[loadWorkout] Supabase missing workout data, using cached workout until sync completes');
              return loadWorkoutFromCache(userId);
            }
          } catch (cacheCheckError) {
            console.warn('[loadWorkout] Failed to inspect cached workout for fallback:', cacheCheckError);
          }
        }

        // Step 2.5: If workout was created from template, fetch template_exercises preferences
        let templateExercisesMap = new Map<string, boolean>();
        if (currentWorkout?.template_id) {
          const { data: templateExercises } = await supabase
            .from("template_exercises")
            .select("exercise_id, is_unilateral")
            .eq("template_id", currentWorkout.template_id);

          templateExercises?.forEach(te => {
            templateExercisesMap.set(te.exercise_id, te.is_unilateral ?? false);
          });
        }

        // Step 3: Load sets and last session data for each exercise in parallel
        const exercisesWithSets = await Promise.all(
          (workoutExs || []).map(async (we: any, exerciseIndex: number) => {
            // Fetch sets for this exercise
            const { data: sets, error: setsError } = await supabase
              .from("sets")
              .select("*")
              .eq("workout_exercise_id", we.id)
              .order("set_no", { ascending: true });

            if (setsError) throw setsError;

            // Fetch last session data for prefill
            let lastSessionWeight = undefined;
            let lastSessionSets: WorkoutExercise["lastSessionSets"] = [];
            if (currentWorkout) {
              const lastSession = await fetchLastSessionData(
                userId,
                we.exercise_id,
                currentWorkout.started_at,
                {
                  seedId: we.exercise?.name ? seedIdLookupMap.get(we.exercise.name.toLowerCase()) : undefined,
                  exerciseName: we.exercise?.name ?? null,
                  isUnilateral: templateExercisesMap.get(we.exercise_id) ?? (we.exercise?.is_unilateral ?? false),
                  exerciseIndex,
                }
              );
              lastSessionWeight = lastSession.lastSessionWeight;
              lastSessionSets = lastSession.lastSessionSets;
            }

            // Step 4: Format sets for form inputs (convert numbers to strings)
            const formattedSets = (sets || []).map((s: any, index: number) => {
              const unit: WeightUnit = s.unit === "lb" ? "lb" : "kg";
              const weight = s.weight > 0 ? s.weight.toString() : "";
              const reps = s.reps > 0 ? s.reps.toString() : "";
              const rir = s.rir?.toString() || "";

              // Build last session metadata for comparison
              const sessionEntry = lastSessionSets?.[index];
              const hasSessionData =
                sessionEntry &&
                (sessionEntry.weight ||
                  sessionEntry.reps ||
                  (sessionEntry.rir && sessionEntry.rir !== "") ||
                  sessionEntry.leftWeight ||
                  sessionEntry.rightWeight ||
                  sessionEntry.leftReps ||
                  sessionEntry.rightReps ||
                  sessionEntry.leftRir ||
                  sessionEntry.rightRir ||
                  typeof sessionEntry.isWarmup === "boolean");

              const lastSessionMeta = hasSessionData
                ? {
                    weight: sessionEntry?.weight ?? "",
                    reps: sessionEntry?.reps ?? "",
                    rir: sessionEntry?.rir ?? "",
                    isWarmup: sessionEntry?.isWarmup,
                    unit: sessionEntry?.unit,
                  }
                : weight || reps || rir
                  ? {
                      weight,
                      reps,
                      rir,
                      isWarmup: s.is_warmup,
                      unit,
                    }
                  : undefined;

              // Determine if values are prefilled (match last session) or edited by user
              // For bilateral exercises
              const leftWeight = s.left_weight ? s.left_weight.toString() : "";
              const rightWeight = s.right_weight ? s.right_weight.toString() : "";
              const leftReps = s.left_reps ? s.left_reps.toString() : "";
              const rightReps = s.right_reps ? s.right_reps.toString() : "";
              const leftRir = s.left_rir?.toString() || "";
              const rightRir = s.right_rir?.toString() || "";

              const isUnilateral = Boolean(s.is_unilateral);

              // Check if current values match last session values (indicating prefilled, not yet edited)
              // If they match AND have data, then edited = false (show gray italic)
              // If they don't match OR no last session data, then edited = true (show normal font)
              let weightEdited = true;
              let repsEdited = true;
              let rirEdited = true;
              let warmupEdited = true;

              if (hasSessionData) {
                if (isUnilateral) {
                  // For unilateral: check if both sides match
                  const leftWeightMatches = leftWeight === (sessionEntry?.leftWeight ?? "");
                  const rightWeightMatches = rightWeight === (sessionEntry?.rightWeight ?? "");
                  const leftRepsMatches = leftReps === (sessionEntry?.leftReps ?? "");
                  const rightRepsMatches = rightReps === (sessionEntry?.rightReps ?? "");
                  const leftRirMatches = leftRir === (sessionEntry?.leftRir ?? "");
                  const rightRirMatches = rightRir === (sessionEntry?.rightRir ?? "");

                  // If has value and matches last session, it's prefilled (edited = false)
                  if ((leftWeight || rightWeight) && leftWeightMatches && rightWeightMatches) {
                    weightEdited = false;
                  }
                  if ((leftReps || rightReps) && leftRepsMatches && rightRepsMatches) {
                    repsEdited = false;
                  }
                  if ((leftRir || rightRir) && leftRirMatches && rightRirMatches) {
                    rirEdited = false;
                  }
                } else {
                  // For bilateral: check if values match
                  if (weight && weight === (sessionEntry?.weight ?? "")) {
                    weightEdited = false;
                  }
                  if (reps && reps === (sessionEntry?.reps ?? "")) {
                    repsEdited = false;
                  }
                  if (rir && rir === (sessionEntry?.rir ?? "")) {
                    rirEdited = false;
                  }
                }

                // Check warmup flag
                if (typeof sessionEntry?.isWarmup === "boolean" && s.is_warmup === sessionEntry.isWarmup) {
                  warmupEdited = false;
                }
              }

              return {
                id: s.id,
                set_no: s.set_no,
                weight,
                reps,
                rpe: s.rpe?.toString() || "",
                rir,
                is_warmup: s.is_warmup,
                notes: s.notes || "",
                unit,
                is_unilateral: isUnilateral,
                leftWeight,
                rightWeight,
                leftReps,
                rightReps,
                leftRir,
                rightRir,
                lastSession: isPremium ? lastSessionMeta : undefined,
                weightEdited,
                repsEdited,
                rirEdited,
                warmupEdited,
                lastUnilateral: s.is_unilateral
                  ? {
                      leftWeight: s.left_weight ? s.left_weight.toString() : "",
                      rightWeight: s.right_weight ? s.right_weight.toString() : "",
                      leftReps: s.left_reps ? s.left_reps.toString() : "",
                      rightReps: s.right_reps ? s.right_reps.toString() : "",
                      leftRir: s.left_rir?.toString() || "",
                      rightRir: s.right_rir?.toString() || "",
                    }
                  : undefined,
              };
            });

            // Step 5: Enrich with seed metadata and unilateral capabilities
            const exerciseName = we.exercise?.name || "Exercise";
            const normalizedExerciseName = exerciseName.toLowerCase();
            const baseNameKey = stripUnilateralSuffix(exerciseName).toLowerCase();
            const fallbackSeedId =
              seedIdLookupMap.get(normalizedExerciseName) ?? seedIdLookupMap.get(baseNameKey);
            const fallbackRegion =
              we.exercise?.body_part ??
              seedRegionMap.get(normalizedExerciseName) ??
              seedRegionMap.get(baseNameKey) ??
              null;
            const supabaseSupports = Boolean(we.exercise?.is_unilateral);
            const supportsUnilateral =
              supabaseSupports ||
              (fallbackSeedId
                ? seedSupportsUnilateralToggle(fallbackSeedId)
                : nameSupportsUnilateralToggle(exerciseName));
            const inferredForceUnilateral = supabaseSupports;

            return {
              ...we,
              exercise: {
                id: we.exercise?.id,
                name: exerciseName,
                equipment: we.exercise?.equipment ?? null,
                muscle_group: we.exercise?.muscle_group ?? null,
                body_part: fallbackRegion,
                is_bodyweight: we.exercise?.is_bodyweight ?? false,
                origin: "remote" as const,
                seedId: fallbackSeedId,
                is_unilateral: Boolean(templateExercisesMap.get(we.exercise_id) ?? we.exercise?.is_unilateral),
                base_exercise_id: we.exercise?.base_exercise_id ?? null,
                owner_user_id: we.exercise?.owner_user_id ?? null,
                forceUnilateral: inferredForceUnilateral,
                supportsUnilateral,
                image_url: we.exercise?.image_url ?? null,
              },
              sets: formattedSets,
              lastSessionWeight,
              lastSessionSets,
              baseExerciseId: we.exercise?.base_exercise_id ?? we.exercise_id,
              isUnilateral: Boolean(templateExercisesMap.get(we.exercise_id) ?? we.exercise?.is_unilateral),
              baseExerciseInfo: {
                id: we.exercise?.base_exercise_id ?? we.exercise?.id,
                name: stripUnilateralSuffix(exerciseName),
                equipment: we.exercise?.equipment ?? null,
                muscle_group: we.exercise?.muscle_group ?? null,
                body_part: fallbackRegion,
                is_bodyweight: we.exercise?.is_bodyweight ?? false,
                supabaseId: we.exercise?.base_exercise_id ?? we.exercise?.id,
                origin: "remote" as const,
                is_unilateral: false,
                base_exercise_id: we.exercise?.base_exercise_id ?? null,
                owner_user_id: we.exercise?.owner_user_id ?? null,
                seedId: fallbackSeedId,
                forceUnilateral: inferredForceUnilateral,
                supportsUnilateral,
                image_url: we.exercise?.image_url ?? null,
              },
              togglePending: false,
            };
          })
        );

        return {
          exercises: exercisesWithSets,
          startedAt: currentWorkout?.started_at ?? new Date().toISOString(),
        };
      } catch (error: any) {
        console.error("Failed to load workout", error);
        toast({
          title: "Error",
          description: error instanceof Error ? error.message : "Failed to load workout",
          variant: "destructive",
        });
        return { exercises: [], startedAt: new Date().toISOString() };
      }
    },
    [workoutId, fetchLastSessionData, seedIdLookupMap, seedRegionMap, toast, loadWorkoutFromCache]
  );

  return {
    getAuthContext,
    fetchExerciseById,
    fetchLastSetForExercise,
    fetchLastSessionData,
    loadUserPreferences,
    loadWorkout,
  };
};
