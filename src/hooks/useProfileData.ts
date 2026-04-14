import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseUrl, getSupabaseAnonKey } from "@/lib/env";
import { enrichPostsWithSharedWorkouts } from "@/lib/sharedWorkout";

type PrCategory = "squat" | "bench" | "deadlift";

interface PostDerivedPR {
  category: PrCategory;
  exerciseName: string;
  weight: number;
  unit: string;
  postedAt: string;
}

const categorizeExercise = (name: string): PrCategory | null => {
  const lower = (name || "").toLowerCase();
  if (lower.includes("squat")) return "squat";
  if (lower.includes("bench")) return "bench";
  if (lower.includes("deadlift")) return "deadlift";
  return null;
};

const createEmptyPrState = (): Record<PrCategory, PostDerivedPR | null> => ({
  squat: null,
  bench: null,
  deadlift: null,
});

/**
 * Hook to fetch profile stats (followers, following, posts count)
 */
export const useProfileStats = (userId: string | null, accessToken: string) => {
  return useQuery({
    queryKey: ["profileStats", userId],
    queryFn: async () => {
      if (!userId || !accessToken) return null;

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const [followersRes, followingRes, postsCountRes] = await Promise.all([
        fetch(`${supabaseUrl}/rest/v1/follows?following_id=eq.${userId}&select=*`, {
          headers: { Authorization: `Bearer ${accessToken}`, apikey: apiKey, Prefer: "count=exact" },
        }),
        fetch(`${supabaseUrl}/rest/v1/follows?follower_id=eq.${userId}&select=*`, {
          headers: { Authorization: `Bearer ${accessToken}`, apikey: apiKey, Prefer: "count=exact" },
        }),
        fetch(`${supabaseUrl}/rest/v1/posts?user_id=eq.${userId}&select=*&order=created_at.desc`, {
          headers: { Authorization: `Bearer ${accessToken}`, apikey: apiKey, Prefer: "count=exact" },
        }),
      ]);

      const followersCount = followersRes.headers.get("content-range")?.split("/")[1] || "0";
      const followingCount = followingRes.headers.get("content-range")?.split("/")[1] || "0";
      const postsCount = postsCountRes.headers.get("content-range")?.split("/")[1] || "0";

      return {
        followers: parseInt(followersCount),
        following: parseInt(followingCount),
        posts: parseInt(postsCount),
      };
    },
    staleTime: 30000, // 30s
    gcTime: 300000, // 5min
    enabled: !!userId && !!accessToken,
  });
};

/**
 * Hook to fetch profile posts with enriched workout data
 */
export const useProfilePosts = (
  userId: string | null,
  accessToken: string,
  displayUsername: string
) => {
  return useQuery({
    queryKey: ["profilePosts", userId],
    queryFn: async () => {
      if (!userId || !accessToken) return [];

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const postsResponse = await fetch(
        `${supabaseUrl}/rest/v1/posts?user_id=eq.${userId}&select=*&order=created_at.desc`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            apikey: apiKey,
          },
        }
      );
      const postsData = await postsResponse.json();

      const enrichedPosts = (postsData || []).map((post: any) => ({
        ...post,
        public_profiles: {
          username: displayUsername,
        },
      }));

      try {
        const postsWithWorkouts = await enrichPostsWithSharedWorkouts(enrichedPosts, {
          supabaseUrl,
          accessToken,
          apiKey,
        });

        return postsWithWorkouts.map((post: any) => ({
          ...post,
          is_private: Boolean(post.is_private),
        }));
      } catch (enrichError) {
        console.error("Failed to enrich profile posts with workout details:", enrichError);
        return enrichedPosts.map((post: any) => ({
          ...post,
          is_private: Boolean(post.is_private),
        }));
      }
    },
    staleTime: 30000, // 30s
    gcTime: 300000, // 5min
    enabled: !!userId && !!accessToken,
  });
};

/**
 * Hook to fetch PRs from the prs table
 */
export const useProfilePRs = (userId: string | null, accessToken: string) => {
  return useQuery({
    queryKey: ["profilePRs", userId],
    queryFn: async () => {
      if (!userId || !accessToken) return createEmptyPrState();

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const derivedPrsFromTable = createEmptyPrState();

      try {
        const prsResponse = await fetch(
          `${supabaseUrl}/rest/v1/prs?user_id=eq.${userId}&select=weight,unit,achieved_at,exercise:exercises(name)&order=weight.desc`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          }
        );

        if (prsResponse.ok) {
          const prsData = await prsResponse.json();
          if (Array.isArray(prsData)) {
            prsData.forEach((record: any) => {
              const exerciseName = record.exercise?.name ?? "";
              const category = categorizeExercise(exerciseName);
              if (!category) return;
              const weightValue = Number(record.weight);
              if (!Number.isFinite(weightValue)) return;
              const currentBest = derivedPrsFromTable[category];
              if (!currentBest || weightValue > currentBest.weight) {
                derivedPrsFromTable[category] = {
                  category,
                  exerciseName,
                  weight: weightValue,
                  unit: record.unit ?? "kg",
                  postedAt: record.achieved_at ?? new Date().toISOString(),
                };
              }
            });
          }
        }
      } catch (error) {
        if (import.meta.env.DEV) console.warn("Failed to fetch PR rows, falling back to posts");
      }

      return derivedPrsFromTable;
    },
    staleTime: 60000, // 1min
    gcTime: 300000, // 5min
    enabled: !!userId && !!accessToken,
  });
};

/**
 * Hook to compute PRs from posts (fallback when prs table is empty)
 */
export const useComputedPRsFromPosts = (posts: any[], enabled: boolean = true) => {
  return useQuery({
    queryKey: ["computedPRsFromPosts", posts.map((p) => p.id).join(",")],
    queryFn: async () => {
      const emptyState = createEmptyPrState();
      const postsWithWorkouts = posts.filter((post) => post.workout_id && post.show_workout_details);

      if (postsWithWorkouts.length === 0) {
        return emptyState;
      }

      const workoutIds = Array.from(new Set(postsWithWorkouts.map((post: any) => post.workout_id)));

      const { data, error } = await supabase
        .from("workout_exercises")
        .select(
          `workout_id,
           exercises!workout_exercises_exercise_id_fkey (name),
           sets (weight, unit, is_warmup)`
        )
        .in("workout_id", workoutIds);

      if (error) {
        console.error("Failed to derive PRs from posts:", error);
        return emptyState;
      }

      const postLookup = new Map(postsWithWorkouts.map((post: any) => [post.workout_id, post]));

      const nextPrs = createEmptyPrState();

      data?.forEach((entry: any) => {
        const exerciseName = entry.exercises?.name || "";
        const category = categorizeExercise(exerciseName);
        if (!category) return;

        const associatedPost = postLookup.get(entry.workout_id);
        if (!associatedPost) return;

        const workingSets = (entry.sets || []).filter((set: any) => !set.is_warmup);

        workingSets.forEach((set: any) => {
          const weightValue = Number(set.weight);
          if (!weightValue || Number.isNaN(weightValue)) return;

          const currentBest = nextPrs[category];
          if (!currentBest || weightValue > currentBest.weight) {
            nextPrs[category] = {
              category,
              exerciseName,
              weight: weightValue,
              unit: set.unit || "kg",
              postedAt: associatedPost.created_at,
            };
          }
        });
      });

      return nextPrs;
    },
    staleTime: 60000, // 1min
    gcTime: 300000, // 5min
    enabled: enabled && posts.length > 0,
  });
};
