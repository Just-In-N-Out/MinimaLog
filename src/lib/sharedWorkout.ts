import { convertWeight } from "@/lib/conversions";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";

export interface SharedWorkoutSummary {
  exercises: number;
  sets: number;
  totalVolume: number;
}

const parseNumeric = (value: any): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const summariseWorkoutDetails = (details: any[]): SharedWorkoutSummary => {
  let sets = 0;
  let totalVolume = 0;

  details.forEach((exercise: any) => {
    const setsArray = Array.isArray(exercise.sets) ? exercise.sets : [];
    setsArray.forEach((set: any) => {
      if (set?.is_warmup) return;
      sets += 1;

      const unit: "kg" | "lb" = set?.unit === "lb" ? "lb" : "kg";
      const weight = parseNumeric(set?.weight) ?? 0;
      const reps = parseNumeric(set?.reps) ?? 0;
      const baseVolume = convertWeight(weight, unit, "kg") * reps;

      const leftWeight = parseNumeric(set?.left_weight);
      const rightWeight = parseNumeric(set?.right_weight);
      const leftReps = parseNumeric(set?.left_reps);
      const rightReps = parseNumeric(set?.right_reps);

      const leftVolume =
        leftWeight !== null && leftReps !== null
          ? convertWeight(leftWeight, unit, "kg") * leftReps
          : 0;
      const rightVolume =
        rightWeight !== null && rightReps !== null
          ? convertWeight(rightWeight, unit, "kg") * rightReps
          : 0;

      const totalSetVolume = leftVolume || rightVolume ? leftVolume + rightVolume : baseVolume;
      totalVolume += totalSetVolume;
    });
  });

  return {
    exercises: details.length,
    sets,
    totalVolume,
  };
};

export const enrichPostsWithSharedWorkouts = async (
  posts: any[],
  options: { supabaseUrl: string; accessToken: string; apiKey: string }
) => {
  const { supabaseUrl, accessToken, apiKey } = options;

  // OPTIMIZATION: Extract all workout IDs upfront
  const workoutIds = Array.from(
    new Set(
      posts
        .filter(p => p?.workout_id)
        .map(p => p.workout_id)
    )
  );

  if (workoutIds.length === 0) {
    return posts;
  }

  // OPTIMIZATION: Batch fetch all workout exercises and sets in ONE query using .in()
  const workoutDetailsMap = new Map<string, any[]>();
  try {
    const workoutIdsStr = workoutIds.join(',');
    const detailsUrl = `${supabaseUrl}/rest/v1/workout_exercises?workout_id=in.(${workoutIdsStr})&select=workout_id,id,order_index,exercises!workout_exercises_exercise_id_fkey(name,muscle_group,is_unilateral,image_url),sets(id,set_no,reps,weight,unit,rpe,rir,is_warmup,is_unilateral,left_weight,right_weight,left_reps,right_reps,left_rir,right_rir)&order=workout_id.asc,order_index.asc&sets.order=set_no.asc`;

    const response = await fetchWithTimeout(detailsUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      timeoutMs: 8000, // Reduced from 12s since it's a single query
    });

    if (response.ok) {
      const allDetails = await response.json();
      if (Array.isArray(allDetails)) {
        // Group workout exercises by workout_id
        for (const detail of allDetails) {
          const workoutId = detail.workout_id;
          if (!workoutDetailsMap.has(workoutId)) {
            workoutDetailsMap.set(workoutId, []);
          }
          workoutDetailsMap.get(workoutId)!.push(detail);
        }
      }
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to batch fetch workout details:", error);
  }

  // OPTIMIZATION: Batch fetch all session metrics in ONE query
  const sessionMetricsMap = new Map<string, any>();
  try {
    const workoutIdsStr = workoutIds.join(',');
    const metricsUrl = `${supabaseUrl}/rest/v1/session_metrics?workout_id=in.(${workoutIdsStr})&select=workout_id,sleep,mood,preworkout,soreness_area`;

    const metricsResponse = await fetchWithTimeout(metricsUrl, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        apikey: apiKey,
      },
      timeoutMs: 5000,
    });

    if (metricsResponse.ok) {
      const metricsJson = await metricsResponse.json();
      if (Array.isArray(metricsJson)) {
        for (const metric of metricsJson) {
          sessionMetricsMap.set(metric.workout_id, metric);
        }
      }
    }
  } catch (metricsError) {
    if (import.meta.env.DEV) console.warn("Failed to batch fetch session metrics:", metricsError);
  }

  // OPTIMIZATION: Now map the pre-fetched data to posts (no async operations)
  return posts.map((post) => {
    if (!post?.workout_id) {
      return post;
    }

    const workoutId = post.workout_id;
    const sessionMetrics = sessionMetricsMap.get(workoutId) || null;

    // If post doesn't want workout details, just add metrics
    if (!post?.show_workout_details) {
      if (sessionMetrics && !post?.session_metrics) {
        return {
          ...post,
          session_metrics: [sessionMetrics],
        };
      }
      return post;
    }

    // Get pre-fetched workout details
    const details = workoutDetailsMap.get(workoutId) || [];
    if (details.length === 0) {
      return post;
    }

    const summary = summariseWorkoutDetails(details);

    return {
      ...post,
      shared_workout_details: details,
      shared_workout_summary: summary,
      session_metrics: sessionMetrics
        ? [sessionMetrics]
        : Array.isArray(post.session_metrics)
        ? post.session_metrics
        : post.session_metrics
        ? [post.session_metrics]
        : [],
    };
  });
};
