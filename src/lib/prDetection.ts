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
    .select("reps, weight, est_1rm")
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
