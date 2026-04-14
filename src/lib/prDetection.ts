import { supabase } from "@/integrations/supabase/client";
import { calculate1RM } from "./conversions";

interface SetData {
  weight: number;
  reps: number;
  unit: "kg" | "lb";
  is_warmup: boolean;
}

interface PRResult {
  isRepPR: boolean;
  is1RMPR: boolean;
  previousRepPR?: number;
  previous1RM?: number;
  new1RM: number;
}

export const checkForPR = async (
  userId: string,
  exerciseId: string,
  setData: SetData
): Promise<PRResult> => {
  if (setData.is_warmup) {
    return {
      isRepPR: false,
      is1RMPR: false,
      new1RM: calculate1RM(setData.weight, setData.reps),
    };
  }

  // Get existing PRs for this exercise
  const { data: existingPRs } = await supabase
    .from("prs")
    .select("*")
    .eq("user_id", userId)
    .eq("exercise_id", exerciseId);

  const new1RM = calculate1RM(setData.weight, setData.reps);

  // Check for rep PR (same rep count, higher weight)
  const sameRepPR = existingPRs?.find((pr) => pr.reps === setData.reps);
  const isRepPR = !sameRepPR || setData.weight > sameRepPR.weight;

  // Check for 1RM PR (highest estimated 1RM across all rep ranges)
  const highest1RM = existingPRs?.reduce((max, pr) => {
    return Math.max(max, pr.est_1rm || 0);
  }, 0) || 0;
  const is1RMPR = new1RM > highest1RM;

  return {
    isRepPR,
    is1RMPR,
    previousRepPR: sameRepPR?.weight,
    previous1RM: highest1RM || undefined,
    new1RM,
  };
};

export const savePR = async (
  userId: string,
  exerciseId: string,
  setData: SetData
): Promise<void> => {
  const new1RM = calculate1RM(setData.weight, setData.reps);

  await supabase.from("prs").insert({
    user_id: userId,
    exercise_id: exerciseId,
    reps: setData.reps,
    weight: setData.weight,
    unit: setData.unit,
    est_1rm: new1RM,
    estimate_formula: "epley",
    achieved_at: new Date().toISOString(),
  });
};

// OPTIMIZATION: Batch PR checking for workout completion
interface BatchSetData extends SetData {
  exerciseId: string;
  exerciseName: string;
}

export const checkForPRsBatch = async (
  userId: string,
  sets: BatchSetData[]
): Promise<Map<string, { count: number; prsToSave: any[] }>> => {
  if (sets.length === 0) {
    return new Map();
  }

  // Extract unique exercise IDs
  const exerciseIds = Array.from(new Set(sets.map(s => s.exerciseId)));

  // OPTIMIZATION: Single query to fetch ALL existing PRs for all exercises
  const { data: existingPRs } = await supabase
    .from("prs")
    .select("exercise_id, reps, weight, est_1rm") // Only needed columns
    .eq("user_id", userId)
    .in("exercise_id", exerciseIds);

  // Group PRs by exercise ID for fast lookup
  const prsByExercise = new Map<string, any[]>();
  (existingPRs || []).forEach(pr => {
    if (!prsByExercise.has(pr.exercise_id)) {
      prsByExercise.set(pr.exercise_id, []);
    }
    prsByExercise.get(pr.exercise_id)!.push(pr);
  });

  // Check each set for PRs (in-memory, no DB calls)
  const resultsByExercise = new Map<string, { count: number; prsToSave: any[] }>();
  const now = new Date().toISOString();

  for (const set of sets) {
    if (set.is_warmup) continue;

    const exercisePRs = prsByExercise.get(set.exerciseId) || [];
    const new1RM = calculate1RM(set.weight, set.reps);

    // Check for 1RM PR
    const highest1RM = exercisePRs.reduce((max, pr) => Math.max(max, pr.est_1rm || 0), 0);
    const is1RMPR = new1RM > highest1RM;

    if (is1RMPR) {
      if (!resultsByExercise.has(set.exerciseId)) {
        resultsByExercise.set(set.exerciseId, { count: 0, prsToSave: [] });
      }

      const result = resultsByExercise.get(set.exerciseId)!;
      result.count++;
      result.prsToSave.push({
        user_id: userId,
        exercise_id: set.exerciseId,
        reps: set.reps,
        weight: set.weight,
        unit: set.unit,
        est_1rm: new1RM,
        estimate_formula: "epley",
        achieved_at: now,
      });

      // Update local PR cache so subsequent sets from same exercise are compared correctly
      exercisePRs.push({
        exercise_id: set.exerciseId,
        reps: set.reps,
        weight: set.weight,
        est_1rm: new1RM,
      });
    }
  }

  return resultsByExercise;
};

export const savePRsBatch = async (prsToSave: any[]): Promise<number> => {
  if (prsToSave.length === 0) {
    return 0;
  }

  // OPTIMIZATION: Single batch insert for all PRs
  const { error } = await supabase.from("prs").insert(prsToSave);

  if (error) {
    console.error("Failed to save PRs batch:", error);
    throw error;
  }

  return prsToSave.length;
};
