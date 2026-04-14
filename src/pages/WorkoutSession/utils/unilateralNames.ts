/**
 * unilateralNames.ts
 *
 * Utilities for manipulating exercise names for unilateral/bilateral toggling.
 * Handles name transformations and validation for unilateral exercise support.
 */

import type { WorkoutExercise } from "../types";
import {
  seedSupportsUnilateralToggle,
  nameSupportsUnilateralToggle,
} from "@/data/gymExercises";

/**
 * Removes the "(Unilateral)" suffix from an exercise name.
 *
 * Why: Enables conversion from unilateral back to bilateral naming
 * Performance: Single regex operation (fast)
 */
export const stripUnilateralSuffix = (name: string): string =>
  name.replace(/\s*\(Unilateral\)$/i, "").trim();

/**
 * Adds the "(Unilateral)" suffix to an exercise name.
 * Automatically strips existing suffix before adding to prevent duplication.
 *
 * Why: Clearly indicates unilateral tracking mode to users
 * Performance: O(1) string operations
 */
export const buildUnilateralName = (name: string): string =>
  `${stripUnilateralSuffix(name)} (Unilateral)`;

/**
 * Keywords that DISABLE unilateral toggle (exercises that are inherently single-limb).
 * These exercises cannot be tracked bilaterally because they're always unilateral.
 */
const UNILATERAL_DISABLE_KEYWORDS = [
  "single",
  "one-arm",
  "one arm",
  "one-leg",
  "one leg",
  "split",
  "step",
  "lunge",
  "carry",
  "pistol",
  "turkish",
  "windmill",
  "copenhagen",
  "suitcase",
  "waiter",
  "farmer's",
  "farmer's",
  "farmers",
];

/**
 * Keywords that ENABLE unilateral toggle (equipment types that support independent limb tracking).
 * These indicate the exercise can be performed unilaterally.
 */
const UNILATERAL_ENABLE_KEYWORDS = [
  "dumbbell",
  "kettlebell",
  "cable",
  "band",
  "trx",
  "suspension",
  "ring",
  "medicine ball",
  "slider",
  "roller",
];

/**
 * Normalizes exercise name for comparison.
 * Handles apostrophe variants and case differences.
 *
 * Why: Ensures consistent keyword matching across different name formats
 * Performance: O(n) where n = name length (typically < 50 chars)
 */
const normalizeName = (value?: string | null): string =>
  value ? value.toLowerCase().replace(/['']/g, "'") : "";

/**
 * Extracts the seed identifier from a workout exercise.
 * Checks both the exercise and base exercise for seed IDs.
 *
 * Why: Seed ID provides authoritative source for exercise capabilities
 * Performance: O(1) lookups
 */
const extractSeedIdentifier = (exercise: WorkoutExercise): string | null => {
  const potentialIds = [exercise.exercise?.seedId, exercise.baseExerciseInfo?.seedId].filter(
    Boolean
  ) as string[];
  return potentialIds.length > 0 ? potentialIds[0]! : null;
};

/**
 * Gets the reference exercise name for capability checking.
 * Uses base exercise name if available, falls back to exercise name.
 *
 * Why: Base exercise provides original capabilities before unilateral conversion
 * Performance: O(1) property access
 */
const getReferenceExerciseName = (exercise: WorkoutExercise): string => {
  const baseName = exercise.baseExerciseInfo?.name ?? exercise.exercise?.name ?? "";
  return normalizeName(baseName);
};

/**
 * Gets the raw (non-normalized) exercise name.
 * Used for exact name matching.
 *
 * Why: Some name checks require case-sensitive matching
 * Performance: O(1) property access
 */
const getRawExerciseName = (exercise: WorkoutExercise): string =>
  exercise.baseExerciseInfo?.name ?? exercise.exercise?.name ?? "";

/**
 * Determines if unilateral toggle capability can be enabled for an exercise.
 * Checks if the exercise supports unilateral capability (not current state).
 *
 * Why: Ensures bidirectional toggling for exercises that support unilateral tracking
 * Performance: O(1) - single field check
 *
 * @param exercise - Workout exercise to check
 * @returns true if unilateral toggle should be available (exercise supports unilateral)
 */
export const canEnableUnilateralToggle = (exercise: WorkoutExercise): boolean => {
  // Check supportsUnilateral flag (capability), with fallback to is_unilateral flag
  const supportsUnilateral = Boolean(
    exercise.exercise?.supportsUnilateral ||
    exercise.baseExerciseInfo?.supportsUnilateral ||
    exercise.exercise?.is_unilateral ||
    exercise.baseExerciseInfo?.is_unilateral
  );

  if (import.meta.env.DEV) {
    console.log('[canEnableUnilateralToggle] Checking:', {
      exerciseName: exercise.exercise?.name,
      supportsUnilateral: exercise.exercise?.supportsUnilateral,
      baseSupportsUnilateral: exercise.baseExerciseInfo?.supportsUnilateral,
      isUnilateral: exercise.exercise?.is_unilateral,
      baseIsUnilateral: exercise.baseExerciseInfo?.is_unilateral,
      result: supportsUnilateral,
    });
  }

  return supportsUnilateral;
};

/**
 * Determines if the unilateral toggle UI should be displayed for an exercise.
 * Shows toggle if:
 * - Currently in unilateral mode (allow switching back)
 * - Forced unilateral (show toggle even if can't disable)
 * - Capable of unilateral toggle
 *
 * Why: Provides clear UI indication of unilateral capability
 * Performance: O(1) checks + canEnableUnilateralToggle complexity
 *
 * @param exercise - Workout exercise to check
 * @returns true if toggle UI should be shown
 */
export const shouldDisplayUnilateralToggle = (exercise: WorkoutExercise): boolean => {
  // Always show if currently in unilateral mode (allow toggle back to bilateral)
  const currentlyUnilateral = Boolean(exercise.isUnilateral);
  if (currentlyUnilateral) return true;

  // Always show if forced unilateral
  const forced = Boolean(
    exercise.exercise?.forceUnilateral ?? exercise.baseExerciseInfo?.forceUnilateral
  );
  if (forced) return true;

  // Show if capable (checks database is_unilateral flag)
  return canEnableUnilateralToggle(exercise);
};
