import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const usePRs = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["prs", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prs")
        .select(`
          id, exercise_id, reps, weight, unit, est_1rm, estimate_formula, achieved_at,
          exercise:exercises (id, name, equipment, muscle_group)
        `)
        .eq("user_id", userId!)
        .order("achieved_at", { ascending: false });

      if (error) throw error;

      // Filter to big three lifts
      return (data || []).filter((pr: any) => {
        const name = pr.exercise.name.toLowerCase();
        return name.includes("squat") || name.includes("bench") || name.includes("deadlift");
      });
    },
    enabled: !!userId,
  });
};
