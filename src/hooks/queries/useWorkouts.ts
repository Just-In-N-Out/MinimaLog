import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useWorkoutHistory = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["workouts", "history", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("workouts")
        .select(`
          id, started_at, ended_at, notes,
          workout_exercises (id, sets (id))
        `)
        .eq("user_id", userId!)
        .not("ended_at", "is", null)
        .order("started_at", { ascending: false });

      if (error) throw error;

      return (data || []).map((workout: any) => ({
        id: workout.id,
        started_at: workout.started_at,
        ended_at: workout.ended_at,
        notes: workout.notes,
        exercise_count: workout.workout_exercises?.length || 0,
        set_count: (workout.workout_exercises || []).reduce(
          (sum: number, we: any) => sum + (we.sets?.length || 0), 0
        ),
      }));
    },
    enabled: !!userId,
  });
};
