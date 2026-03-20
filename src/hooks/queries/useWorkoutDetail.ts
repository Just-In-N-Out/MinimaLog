import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useWorkoutDetail = (workoutId: string | undefined) => {
  return useQuery({
    queryKey: ["workout-detail", workoutId],
    queryFn: async () => {
      // Fetch workout, metrics, and exercises+sets in parallel
      const [workoutRes, metricsRes, exercisesRes] = await Promise.all([
        supabase
          .from("workouts")
          .select("id, started_at, ended_at, notes, user_id")
          .eq("id", workoutId!)
          .single(),
        supabase
          .from("session_metrics")
          .select("bodyweight, bodyweight_unit, sleep, mood, preworkout")
          .eq("workout_id", workoutId!)
          .maybeSingle(),
        supabase
          .from("workout_exercises")
          .select(`
            id, exercise_id, order_index,
            exercise:exercises (id, name, equipment, muscle_group),
            sets (id, set_no, weight, unit, reps, rpe, rir, is_warmup, notes)
          `)
          .eq("workout_id", workoutId!)
          .order("order_index"),
      ]);

      if (workoutRes.error) throw workoutRes.error;
      if (exercisesRes.error) throw exercisesRes.error;

      const exercises = (exercisesRes.data || []).map((we: any) => ({
        ...we,
        sets: (we.sets || []).sort((a: any, b: any) => a.set_no - b.set_no),
      }));

      return {
        workout: workoutRes.data,
        metrics: metricsRes.data,
        exercises,
      };
    },
    enabled: !!workoutId,
  });
};
