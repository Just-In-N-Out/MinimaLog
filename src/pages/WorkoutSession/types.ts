/**
 * types.ts
 *
 * Type definitions for WorkoutSession and related components.
 * Centralized to prevent duplication and ensure type consistency across modules.
 */

export type WeightUnit = "kg" | "lb";

export interface Exercise {
  id: string;
  seedId?: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  body_part?: string | null;
  is_bodyweight?: boolean;
  supabaseId?: string;
  origin?: "seed" | "custom" | "remote";
  is_unilateral?: boolean;
  base_exercise_id?: string | null;
  owner_user_id?: string | null;
  forceUnilateral?: boolean;
  supportsUnilateral?: boolean;
  image_url?: string | null;
}

export interface Set {
  id?: string;
  set_no: number;
  weight: string;
  reps: string;
  rpe: string;
  rir: string;
  is_warmup: boolean;
  notes: string;
  unit: WeightUnit;
  lastSession?: {
    weight?: string;
    reps?: string;
    rir?: string;
    isWarmup?: boolean;
    unit?: WeightUnit;
  };
  weightEdited?: boolean;
  repsEdited?: boolean;
  rirEdited?: boolean;
  warmupEdited?: boolean;
  isOptimistic?: boolean;
  is_unilateral?: boolean;
  leftWeight?: string;
  rightWeight?: string;
  leftReps?: string;
  rightReps?: string;
  leftRir?: string;
  rightRir?: string;
  lastUnilateral?: {
    leftWeight?: string;
    rightWeight?: string;
    leftReps?: string;
    rightReps?: string;
    leftRir?: string;
    rightRir?: string;
  };
}

export interface WorkoutExercise {
  id: string;
  exercise_id: string;
  order_index: number;
  exercise: Exercise;
  sets: Set[];
  clientId?: string;
  lastSessionWeight?: string;
  lastSessionSets?: {
    weight: string;
    reps: string;
    rir?: string;
    isWarmup?: boolean;
    unit?: WeightUnit;
    isUnilateral?: boolean;
    leftWeight?: string;
    rightWeight?: string;
    leftReps?: string;
    rightReps?: string;
    leftRir?: string;
    rightRir?: string;
  }[];
  isOptimistic?: boolean;
  baseExerciseId?: string | null;
  isUnilateral?: boolean;
  baseExerciseInfo?: Exercise;
  togglePending?: boolean;
}

export interface CachedWorkoutSession {
  exercises: WorkoutExercise[];
  currentUnit: WeightUnit;
  workoutStartedAt: string;
  updatedAt: string;
}

export interface SessionTotals {
  leftVolume: number;
  rightVolume: number;
  totalVolume: number;
  leftReps: number;
  rightReps: number;
  totalReps: number;
  hasLeft: boolean;
  hasRight: boolean;
}

// Export for compatibility with existing code
export type WorkoutExerciseState = WorkoutExercise;
export type WorkoutSetState = Set;
