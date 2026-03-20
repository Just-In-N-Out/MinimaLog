import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useExerciseProgress = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["exercise-progress", userId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_exercise_progress", {
        p_user_id: userId!,
      });

      if (error) throw error;

      return (data || []).map((row: any) => ({
        exercise: {
          id: row.exercise_id,
          name: row.exercise_name,
          equipment: row.equipment,
          muscle_group: row.muscle_group,
        },
        totalSets: row.total_sets,
        maxWeight: row.max_weight,
        unit: row.unit,
        lastWorkout: row.last_workout,
      }));
    },
    enabled: !!userId,
  });
};
