import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useFeed = (userId: string | undefined, limit = 50, offset = 0) => {
  return useQuery({
    queryKey: ["feed", userId, limit, offset],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_feed", {
        p_user_id: userId!,
        p_limit: limit,
        p_offset: offset,
      });

      if (error) throw error;
      return (data as any[]) || [];
    },
    enabled: !!userId,
  });
};

export const useProfile = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["profile", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, display_name, name, email, unit_default, bodyweight, onboarding_completed, created_at")
        .eq("id", userId!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!userId,
  });
};

export const useActiveWorkout = (userId: string | undefined) => {
  return useQuery({
    queryKey: ["active-workout", userId],
    queryFn: async () => {
      const { data } = await supabase
        .from("workouts")
        .select("id, started_at")
        .eq("user_id", userId!)
        .is("ended_at", null)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return data;
    },
    enabled: !!userId,
    staleTime: 30 * 1000, // 30 seconds — active workout changes frequently
  });
};
