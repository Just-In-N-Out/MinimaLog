/**
 * calculations.ts
 *
 * Synchronous calculation utilities for workout stats.
 * These are fallback functions when Web Worker is not available.
 * Also used for formatting and display utilities.
 *
 * Note: For performance-critical calculations during render, prefer using
 * the Web Worker (WorkoutStatsWorker.ts) to avoid blocking the main thread.
 */

import { convertWeight } from "@/lib/conversions";
import type { WeightUnit } from "../types";
import { parseNumericString } from "./aggregations";

/**
 * Normalizes weight values to the current unit system.
 * Handles missing units by defaulting to currentUnit.
 *
 * Why: Ensures all calculations use consistent units (prevents mixing kg and lb)
 * Performance: O(1) with unit conversion
 */
export const normalizeWeightValue = (
  value?: string | null,
  unit?: WeightUnit | null,
  currentUnit?: WeightUnit
): number | null => {
  const parsed = parseNumericString(value);
  if (parsed === null) return null;
  const fromUnit: WeightUnit = unit === "lb" ? "lb" : unit === "kg" ? "kg" : currentUnit ?? "kg";
  return convertWeight(parsed, fromUnit, currentUnit ?? "kg");
};

/**
 * Formats a metric value for display with consistent decimal handling.
 * Rounds to 1 decimal place but shows integers without decimals.
 *
 * Why: Clean display format that's easier to read
 * Performance: O(1) formatting operations
 */
export const formatMetricValue = (value: number | null, isInteger = false): string => {
  if (value === null || Number.isNaN(value)) return "-";

  if (isInteger) {
    return Math.round(value).toLocaleString();
  }

  const rounded = Math.round(value * 10) / 10;
  const decimals = Math.abs(rounded - Math.round(rounded)) < 0.05 ? 0 : 1;
  return rounded.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
};

/**
 * Builds a formatted value label with unit suffix.
 *
 * Why: Consistent display format across all metrics
 * Performance: O(1) string concatenation
 */
export const buildValueLabel = (
  value: number | null,
  unitLabel: string,
  isInteger = false
): string => {
  return value === null ? "-" : `${formatMetricValue(value, isInteger)}${unitLabel}`;
};

/**
 * Builds a formatted delta label showing change from previous value.
 * Returns both text and className for styled display.
 *
 * Why: Shows progress indicators in completion overview
 * Performance: O(1) calculations
 *
 * @returns Object with text and className for styled rendering
 */
export const buildDeltaLabel = (
  currentValue: number | null,
  previousValue: number | null,
  unitLabel: string,
  isInteger = false
): { text: string; className: string } => {
  if (previousValue === null) {
    return {
      text: currentValue === null ? "No data" : "New",
      className: "text-muted-foreground",
    };
  }

  if (currentValue === null) {
    return {
      text: "No data",
      className: "text-muted-foreground",
    };
  }

  const delta = currentValue - previousValue;
  const threshold = isInteger ? 1 : 0.1;

  if (Math.abs(delta) < threshold) {
    return {
      text: "No change",
      className: "text-muted-foreground",
    };
  }

  const formatted = formatMetricValue(Math.abs(delta), isInteger);
  return {
    text: `${delta > 0 ? "+" : "-"}${formatted}${unitLabel}`,
    className: delta > 0 ? "text-green-500" : "text-red-500",
  };
};

/**
 * Computes total volume (weight × reps) for a list of sets.
 * SYNCHRONOUS VERSION - prefer Web Worker for large calculations.
 *
 * Why: Volume is the primary metric for workout intensity
 * Performance: O(n) where n = number of sets
 * Note: For render-time calculations, use Web Worker to prevent blocking
 * For unilateral exercises, adds left + right volume together
 */
export const computeVolume = (
  sets: Array<{
    weight?: string;
    unit?: WeightUnit | null;
    reps?: string;
    isUnilateral?: boolean;
    leftWeight?: string;
    rightWeight?: string;
    leftReps?: string;
    rightReps?: string;
  }>,
  currentUnit: WeightUnit
): number | null => {
  if (sets.length === 0) return null;
  let total = 0;
  let hasValue = false;

  sets.forEach((set) => {
    if (set.isUnilateral) {
      // For unilateral exercises, add left + right volume
      const leftWeight = normalizeWeightValue(set.leftWeight, set.unit ?? null, currentUnit);
      const rightWeight = normalizeWeightValue(set.rightWeight, set.unit ?? null, currentUnit);
      const leftReps = parseNumericString(set.leftReps);
      const rightReps = parseNumericString(set.rightReps);

      if (leftWeight !== null && leftReps !== null) {
        total += leftWeight * leftReps;
        hasValue = true;
      }
      if (rightWeight !== null && rightReps !== null) {
        total += rightWeight * rightReps;
        hasValue = true;
      }
    } else {
      // For bilateral exercises, use standard calculation
      const normalizedWeight = normalizeWeightValue(set.weight, set.unit ?? null, currentUnit);
      const reps = parseNumericString(set.reps);
      if (normalizedWeight !== null && reps !== null) {
        total += normalizedWeight * reps;
        hasValue = true;
      }
    }
  });

  return hasValue ? total : null;
};

/**
 * Finds the heaviest weight lifted across all sets.
 * SYNCHRONOUS VERSION - prefer Web Worker for large calculations.
 *
 * Why: Tracks strength progression (max weight milestone)
 * Performance: O(n) iteration
 * For unilateral exercises, checks both left and right weights
 */
export const computeHeaviestWeight = (
  sets: Array<{
    weight?: string;
    unit?: WeightUnit | null;
    isUnilateral?: boolean;
    leftWeight?: string;
    rightWeight?: string;
  }>,
  currentUnit: WeightUnit
): number | null => {
  let max: number | null = null;

  sets.forEach((set) => {
    if (set.isUnilateral) {
      // For unilateral exercises, check both left and right weights
      const leftNormalized = normalizeWeightValue(set.leftWeight, set.unit ?? null, currentUnit);
      const rightNormalized = normalizeWeightValue(set.rightWeight, set.unit ?? null, currentUnit);

      if (leftNormalized !== null && (max === null || leftNormalized > max)) {
        max = leftNormalized;
      }
      if (rightNormalized !== null && (max === null || rightNormalized > max)) {
        max = rightNormalized;
      }
    } else {
      // For bilateral exercises, use standard weight
      const normalized = normalizeWeightValue(set.weight, set.unit ?? null, currentUnit);
      if (normalized === null) return;
      if (max === null || normalized > max) {
        max = normalized;
      }
    }
  });

  return max;
};

/**
 * Sums total reps across all sets.
 * SYNCHRONOUS VERSION - prefer Web Worker for large calculations.
 *
 * Why: Tracks total work volume (important for hypertrophy tracking)
 * Performance: O(n) iteration
 * For unilateral exercises, adds left + right reps together
 */
export const computeTotalReps = (
  sets: Array<{
    reps?: string;
    isUnilateral?: boolean;
    leftReps?: string;
    rightReps?: string;
  }>
): number | null => {
  if (sets.length === 0) return null;
  let total = 0;
  let hasValue = false;

  sets.forEach((set) => {
    if (set.isUnilateral) {
      // For unilateral exercises, add left + right reps
      const leftReps = parseNumericString(set.leftReps);
      const rightReps = parseNumericString(set.rightReps);

      if (leftReps !== null) {
        total += leftReps;
        hasValue = true;
      }
      if (rightReps !== null) {
        total += rightReps;
        hasValue = true;
      }
    } else {
      // For bilateral exercises, use standard calculation
      const reps = parseNumericString(set.reps);
      if (reps !== null) {
        total += reps;
        hasValue = true;
      }
    }
  });

  return hasValue ? total : null;
};

/**
 * Computes separate volume and reps totals for left/right limbs.
 * SYNCHRONOUS VERSION - prefer Web Worker for large calculations.
 *
 * Why: Critical for identifying and correcting strength imbalances
 * Performance: O(n) single-pass iteration
 */
export const computeLimbTotals = (
  sets: Array<{
    leftWeight?: string;
    rightWeight?: string;
    leftReps?: string;
    rightReps?: string;
    unit?: WeightUnit | null;
  }>,
  currentUnit: WeightUnit
) => {
  let leftVolume = 0;
  let rightVolume = 0;
  let leftRepsTotal = 0;
  let rightRepsTotal = 0;
  let hasLeft = false;
  let hasRight = false;

  sets.forEach((set) => {
    const leftWeight = normalizeWeightValue(set.leftWeight, set.unit ?? null, currentUnit);
    const rightWeight = normalizeWeightValue(set.rightWeight, set.unit ?? null, currentUnit);
    const leftReps = parseNumericString(set.leftReps);
    const rightReps = parseNumericString(set.rightReps);

    if (leftWeight !== null && leftReps !== null) {
      leftVolume += leftWeight * leftReps;
      leftRepsTotal += leftReps;
      hasLeft = true;
    }
    if (rightWeight !== null && rightReps !== null) {
      rightVolume += rightWeight * rightReps;
      rightRepsTotal += rightReps;
      hasRight = true;
    }
  });

  return {
    leftVolume: hasLeft ? leftVolume : null,
    rightVolume: hasRight ? rightVolume : null,
    leftReps: hasLeft ? leftRepsTotal : null,
    rightReps: hasRight ? rightRepsTotal : null,
  };
};
