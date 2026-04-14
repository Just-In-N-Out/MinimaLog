import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { runWithSupabaseTimeout } from "@/lib/supabaseTimeout";

interface HistoryItem {
  postId: string;
  workoutId: string;
  title: string;
  caption: string | null;
  createdAt: string;
  startedAt: string;
  endedAt: string;
  notes: string | null;
  exerciseCount: number;
  setCount: number;
}

export const useWorkoutHistory = (userId: string) => {
  return useQuery({
    queryKey: ['workoutHistory', userId],
    queryFn: async (): Promise<HistoryItem[]> => {
      // Optimized: Single query with joins instead of 5 sequential queries
      const { data, error } = await runWithSupabaseTimeout(
        supabase
          .from("posts")
          .select(`
            id,
            created_at,
            title,
            caption,
            workout_id,
            workouts!inner(
              id,
              started_at,
              ended_at,
              notes,
              workout_exercises(
                id,
                sets(id)
              )
            )
          `)
          .eq("user_id", userId)
          .eq("show_workout_details", true)
          .order("created_at", { ascending: false })
          .limit(100),
        8000
      );

      if (error) throw error;

      // Transform the nested data into flat structure
      return (data ?? []).map((post: any) => {
        const workout = post.workouts;
        const exerciseCount = workout?.workout_exercises?.length ?? 0;
        const setCount = workout?.workout_exercises?.reduce(
          (sum: number, we: any) => sum + (we.sets?.length ?? 0),
          0
        ) ?? 0;

        return {
          postId: post.id,
          workoutId: post.workout_id,
          title: post.title,
          caption: post.caption,
          createdAt: post.created_at,
          startedAt: workout?.started_at ?? '',
          endedAt: workout?.ended_at ?? '',
          notes: workout?.notes ?? null,
          exerciseCount,
          setCount,
        };
      });
    },
    staleTime: 60000, // History doesn't change often, cache for 1 minute
    gcTime: 300000,   // Keep in cache for 5 minutes
    enabled: !!userId,
  });
};

export const useCalendarWorkouts = (userId: string, startDate: string, endDate: string) => {
  return useQuery({
    queryKey: ['calendarWorkouts', userId, startDate, endDate],
    queryFn: async () => {
      const { data, error } = await runWithSupabaseTimeout(
        supabase
          .from("workouts")
          .select("id, started_at, ended_at, created_at")
          .eq("user_id", userId)
          .not("ended_at", "is", null)
          .gte("started_at", startDate)
          .lte("started_at", endDate)
          .order("started_at", { ascending: true }),
        5000
      );

      if (error) throw error;
      return data ?? [];
    },
    staleTime: 120000, // Calendar view cached for 2 minutes
    gcTime: 600000,    // Keep in cache for 10 minutes
    enabled: !!userId && !!startDate && !!endDate,
  });
};
