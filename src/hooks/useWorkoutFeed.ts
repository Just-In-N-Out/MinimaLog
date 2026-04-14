import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { enrichPostsWithSharedWorkouts } from "@/lib/sharedWorkout";
import { runWithSupabaseTimeout } from "@/lib/supabaseTimeout";

interface Post {
  id: string;
  user_id: string;
  workout_id: string;
  title: string;
  caption: string | null;
  created_at: string;
  show_workout_details: boolean;
  is_private: boolean;
}

interface UseWorkoutFeedOptions {
  userId: string;
  accessToken: string;
  followingIds: string[];
  scope: "following" | "forYou";
}

export const useWorkoutFeed = ({ userId, accessToken, followingIds, scope }: UseWorkoutFeedOptions) => {
  return useQuery({
    queryKey: ['workoutFeed', scope, userId, followingIds],
    queryFn: async (): Promise<Post[]> => {
      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Build query based on scope
      let postsQuery = supabase
        .from("posts" as any)
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);

      if (scope === "following") {
        const visibleUserIds = Array.from(new Set([userId, ...followingIds]));
        if (visibleUserIds.length > 0) {
          postsQuery = postsQuery.in("user_id", visibleUserIds);
        } else {
          return [];
        }
      }

      const { data: postsData, error: postsError } = await runWithSupabaseTimeout(postsQuery, 5000);

      if (postsError) throw postsError;

      const postsArray = postsData ?? [];
      if (postsArray.length === 0) {
        return [];
      }

      // Fetch profile names for all post authors
      const userIdsForProfiles = Array.from(
        new Set(postsArray.map((p: any) => p.user_id).filter(Boolean))
      );

      let nameMap = new Map<string, string>();

      if (userIdsForProfiles.length > 0) {
        const { data: profileRows, error: profilesError } = await runWithSupabaseTimeout(
          supabase
            .from("public_profiles" as any)
            .select("id, username")
            .in("id", userIdsForProfiles),
          3000
        );

        if (profilesError) {
          console.error(`Failed to load profile names for ${scope} feed:`, profilesError);
        } else {
          nameMap = new Map(
            (profileRows ?? []).map((row: any) => [row.id, row.username]),
          );
        }
      }

      // Merge profile names with posts
      const merged = postsArray.map((p: any) => ({
        ...p,
        public_profiles: { username: nameMap.get(p.user_id) || "Unknown" },
      }));

      // Enrich with workout details
      let postsWithWorkouts = merged;
      try {
        postsWithWorkouts = await enrichPostsWithSharedWorkouts(merged, {
          supabaseUrl,
          accessToken,
          apiKey,
        });
      } catch (enrichError) {
        console.error(`Failed to enrich ${scope} workout feed posts:`, enrichError);
        postsWithWorkouts = merged;
      }

      // Sort by created_at
      const sortedPosts = [...postsWithWorkouts].sort((a: any, b: any) => {
        const aTime = new Date(a.created_at ?? 0).getTime();
        const bTime = new Date(b.created_at ?? 0).getTime();
        return bTime - aTime;
      });

      return sortedPosts.map((post: any) => ({
        ...post,
        is_private: Boolean(post.is_private),
      }));
    },
    staleTime: 30000, // Consider data fresh for 30 seconds
    gcTime: 300000,   // Keep in cache for 5 minutes
    enabled: !!userId && !!accessToken,
  });
};

export const useFollowingList = (userId: string) => {
  return useQuery({
    queryKey: ['followingList', userId],
    queryFn: async () => {
      const { data, error } = await runWithSupabaseTimeout(
        supabase
          .from("follows")
          .select("following_id")
          .eq("follower_id", userId)
          .eq("status", "accepted"),
        5000
      );

      if (error) throw error;
      return (data ?? []).map((row: any) => row.following_id) as string[];
    },
    staleTime: 60000, // Following list changes infrequently, cache for 1 minute
    gcTime: 300000,
    enabled: !!userId,
  });
};

export const useActiveWorkout = (userId: string, suppressedIds: Set<string>) => {
  return useQuery({
    queryKey: ['activeWorkout', userId],
    queryFn: async () => {
      const { data, error } = await runWithSupabaseTimeout(
        supabase
          .from("workouts")
          .select("*")
          .eq("user_id", userId)
          .is("ended_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        3000
      );

      if (error) throw error;

      // Filter out suppressed workouts
      if (data && suppressedIds.has(String(data.id))) {
        return null;
      }

      return data;
    },
    staleTime: 10000, // Check for active workout every 10 seconds
    gcTime: 60000,
    enabled: !!userId,
    refetchInterval: 30000, // Automatically refetch every 30 seconds
  });
};

export const useInvalidateWorkoutFeed = () => {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: ['workoutFeed'] });
    queryClient.invalidateQueries({ queryKey: ['activeWorkout'] });
  };
};
