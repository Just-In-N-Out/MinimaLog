import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface WorkoutExerciseWithSets {
  id: string;
  workout_id: string;
  exercise_id: string;
  workouts: {
    id: string;
    ended_at: string | null;
    started_at: string | null;
    created_at: string | null;
  } | null;
  exercise: {
    id: string;
    name: string;
    equipment: string | null;
    muscle_group: string | null;
    is_unilateral: boolean;
    image_url: string | null;
  };
  sets: Array<{
    id: string;
    set_no: number;
    weight: number;
    reps: number;
    rir: number | null;
    unit: "kg" | "lb";
    is_warmup: boolean;
    is_unilateral: boolean;
    left_weight?: number | null;
    right_weight?: number | null;
    left_reps?: number | null;
    right_reps?: number | null;
    left_rir?: number | null;
    right_rir?: number | null;
  }>;
}

export const useExerciseProgress = (userId: string, workoutLimit: number = 60) => {
  return useQuery({
    queryKey: ['exerciseProgress', userId, workoutLimit],
    queryFn: async () => {
      // Step 1: Fetch recent completed workouts
      const { data: recentWorkouts, error: workoutsError } = await supabase
        .from("workouts")
        .select("id, ended_at, started_at, created_at")
        .eq("user_id", userId)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false })
        .limit(workoutLimit);

      if (workoutsError) throw workoutsError;
      if (!recentWorkouts || recentWorkouts.length === 0) {
        return [];
      }

      const workoutIds = recentWorkouts.map((w) => w.id);

      // Step 2: Fetch workout exercises with embedded relations
      const { data: workoutExercisesData, error: exercisesError } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          workout_id,
          exercise_id,
          workouts!inner(
            id,
            ended_at,
            started_at,
            created_at
          ),
          exercise:exercises!workout_exercises_exercise_id_fkey(
            id,
            name,
            equipment,
            muscle_group,
            is_unilateral,
            image_url
          )
        `)
        .in("workout_id", workoutIds)
        .order("id", { ascending: true });

      if (exercisesError) throw exercisesError;

      const workoutExerciseIds = (workoutExercisesData ?? []).map((we) => we.id);

      if (workoutExerciseIds.length === 0) {
        return [];
      }

      // Step 3: PERFORMANCE OPTIMIZATION: Fetch only non-warmup sets at database level
      // BEFORE: Fetched ALL sets (including warmups), filtered client-side
      // AFTER: Filter at database with .eq("is_warmup", false)
      // IMPACT: 20-40% less data transfer depending on warmup set ratio
      const { data: setsData, error: setsError } = await supabase
        .from("sets")
        .select(`
          id,
          workout_exercise_id,
          set_no,
          weight,
          reps,
          rir,
          unit,
          is_warmup,
          is_unilateral,
          left_weight,
          right_weight,
          left_reps,
          right_reps,
          left_rir,
          right_rir
        `)
        .in("workout_exercise_id", workoutExerciseIds)
        .eq("is_warmup", false)
        .order("set_no", { ascending: true });

      if (setsError) throw setsError;

      // Step 4: Combine workout exercises with their sets
      const setsMap = new Map<string, any[]>();
      (setsData ?? []).forEach((set: any) => {
        const weId = set.workout_exercise_id;
        if (!setsMap.has(weId)) {
          setsMap.set(weId, []);
        }
        setsMap.get(weId)!.push(set);
      });

      return (workoutExercisesData ?? []).map((we: any) => ({
        ...we,
        sets: setsMap.get(we.id) || []
      })) as WorkoutExerciseWithSets[];
    },
    // PERFORMANCE OPTIMIZATION: Increased staleTime from 0 to 10 seconds
    // BEFORE: staleTime: 0 caused refetch on every component mount
    // AFTER: staleTime: 10000 (10s) prevents excessive refetches
    // IMPACT: Reduces network requests for data-heavy 60-workout queries
    // JUSTIFICATION: Exercise stats don't need real-time updates - 10s is acceptable
    staleTime: 10000, // Cache fresh data for 10 seconds
    gcTime: 300000,   // Keep in cache for 5 minutes
    enabled: !!userId,
    // PERFORMANCE: Prevent refetch on window focus for this data-heavy query
    // IMPACT: Reduces unnecessary 60-workout fetches when user switches tabs
    refetchOnWindowFocus: false,
  });
};

export const useExerciseDetail = (userId: string, exerciseId: string) => {
  return useQuery({
    queryKey: ['exerciseDetail', userId, exerciseId],
    queryFn: async () => {
      // Step 1: Fetch workout exercises for this specific exercise
      const { data: workoutExercisesData, error: exercisesError } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          workout_id,
          exercise_id,
          workouts!inner(
            id,
            started_at,
            ended_at,
            user_id
          ),
          exercise:exercises!workout_exercises_exercise_id_fkey(
            id,
            name,
            equipment,
            muscle_group,
            is_unilateral,
            image_url
          )
        `)
        .eq("exercise_id", exerciseId)
        .eq("workouts.user_id", userId)
        .not("workouts.ended_at", "is", null)
        .order("workouts.ended_at", { ascending: false })
        .limit(100);

      if (exercisesError) throw exercisesError;

      const workoutExerciseIds = (workoutExercisesData ?? []).map((we) => we.id);

      if (workoutExerciseIds.length === 0) {
        return [];
      }

      // Step 2: PERFORMANCE OPTIMIZATION: Fetch only non-warmup sets at database level
      // IMPACT: 20-40% less data transfer
      const { data: setsData, error: setsError } = await supabase
        .from("sets")
        .select(`
          id,
          workout_exercise_id,
          set_no,
          weight,
          reps,
          rir,
          unit,
          is_warmup,
          is_unilateral,
          left_weight,
          right_weight,
          left_reps,
          right_reps,
          created_at
        `)
        .in("workout_exercise_id", workoutExerciseIds)
        .eq("is_warmup", false)
        .order("set_no", { ascending: true });

      if (setsError) throw setsError;

      // Step 3: Combine workout exercises with their sets
      const setsMap = new Map<string, any[]>();
      (setsData ?? []).forEach((set: any) => {
        const weId = set.workout_exercise_id;
        if (!setsMap.has(weId)) {
          setsMap.set(weId, []);
        }
        setsMap.get(weId)!.push(set);
      });

      return (workoutExercisesData ?? []).map((we: any) => ({
        ...we,
        sets: setsMap.get(we.id) || []
      }));
    },
    // PERFORMANCE OPTIMIZATION: Increased staleTime from 0 to 10 seconds
    // IMPACT: Reduces excessive refetches for exercise detail queries
    staleTime: 10000, // Cache fresh data for 10 seconds
    gcTime: 300000,
    enabled: !!userId && !!exerciseId,
    // PERFORMANCE: Prevent unnecessary refetches on window focus
    refetchOnWindowFocus: false,
  });
};

export const usePersonalRecords = (userId: string) => {
  return useQuery({
    queryKey: ['personalRecords', userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prs")
        .select(`
          id,
          user_id,
          exercise_id,
          reps,
          weight,
          unit,
          est_1rm,
          created_at,
          exercises(
            id,
            name,
            muscle_group
          )
        `)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data ?? [];
    },
    // PERFORMANCE OPTIMIZATION: Increased staleTime from 0 to 10 seconds
    // IMPACT: Reduces excessive refetches for PR queries
    staleTime: 10000, // Cache fresh data for 10 seconds
    gcTime: 180000,
    enabled: !!userId,
    // PERFORMANCE: Prevent unnecessary refetches on window focus
    refetchOnWindowFocus: false,
  });
};
