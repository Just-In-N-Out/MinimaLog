/**
 * WorkoutStatsWorker.ts
 *
 * Web Worker for offloading heavy workout calculations from the main thread.
 * This improves frame rate and UI responsiveness during workouts by moving
 * volume calculations, aggregations, and stats computations to a background thread.
 *
 * Performance Benefits:
 * - Non-blocking main thread during large workout calculations
 * - Parallel processing of multiple exercise stats
 * - Prevents frame drops when calculating totals for 10+ exercises
 *
 * Communication Pattern:
 * - Main thread sends calculation requests via postMessage
 * - Worker processes data and returns via postMessage
 * - All calculations are pure functions (no side effects)
 */

export type WeightUnit = "kg" | "lb";

export interface WorkoutSet {
  weight?: string;
  reps?: string;
  rir?: string;
  unit?: WeightUnit | null;
  is_warmup?: boolean;
  is_unilateral?: boolean;
  leftWeight?: string;
  rightWeight?: string;
  leftReps?: string;
  rightReps?: string;
  leftRir?: string;
  rightRir?: string;
}

export interface CalculationRequest {
  type:
    | "computeVolume"
    | "computeHeaviestWeight"
    | "computeTotalReps"
    | "computeLimbTotals"
    | "computeSessionStats"
    | "aggregateUnilateral";
  data: {
    sets?: WorkoutSet[];
    exercises?: Array<{ sets: WorkoutSet[]; isUnilateral?: boolean }>;
    currentUnit?: WeightUnit;
    leftValue?: string;
    rightValue?: string;
    aggregationType?: "weight" | "reps" | "rir";
  };
  requestId?: string;
}

export interface CalculationResponse {
  type: string;
  result: any;
  requestId?: string;
  error?: string;
}

/**
 * Parses a numeric string, handling empty, null, or invalid values.
 * Returns null for invalid inputs to maintain calculation integrity.
 *
 * Why: Ensures consistent numeric handling across all calculations
 */
const parseNumericString = (value?: string | null): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Converts weight between units (kg/lb).
 * Conversion factor: 1 kg = 2.20462 lb
 *
 * Why: Enables consistent calculations regardless of user's preferred unit
 */
const convertWeight = (value: number, from: WeightUnit, to: WeightUnit): number => {
  if (from === to) return value;
  if (from === "kg" && to === "lb") {
    return value * 2.20462;
  }
  // lb to kg
  return value / 2.20462;
};

/**
 * Normalizes weight values to the current unit system.
 * Handles missing units by defaulting to currentUnit.
 *
 * Why: Ensures all calculations use consistent units (prevents mixing kg and lb)
 */
const normalizeWeightValue = (
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
 * Aggregates unilateral weight by taking the maximum of left/right.
 * Used for display in bilateral view (shows stronger side).
 *
 * Why: Users want to see their maximum capability when viewing aggregated data
 * Performance: O(1) operation, very fast
 */
const aggregateUnilateralWeight = (left?: string, right?: string): number | null => {
  const leftValue = parseNumericString(left);
  const rightValue = parseNumericString(right);
  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return rightValue;
  if (rightValue === null) return leftValue;
  return Math.max(leftValue, rightValue);
};

/**
 * Aggregates unilateral reps by taking the maximum.
 *
 * Why: Shows best performance (stronger side determines rep count)
 * Performance: O(1) operation
 */
const aggregateUnilateralReps = (left?: string, right?: string): number | null => {
  const leftValue = parseNumericString(left);
  const rightValue = parseNumericString(right);
  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return rightValue;
  if (rightValue === null) return leftValue;
  return Math.max(leftValue, rightValue);
};

/**
 * Aggregates unilateral RIR (Reps In Reserve) by taking the minimum.
 *
 * Why: Lower RIR = closer to failure = limiting factor (weaker side determines effort)
 * Performance: O(1) operation
 */
const aggregateUnilateralRir = (left?: string, right?: string): number | null => {
  const leftValue = parseNumericString(left);
  const rightValue = parseNumericString(right);
  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return rightValue;
  if (rightValue === null) return leftValue;
  return Math.min(leftValue, rightValue);
};

/**
 * Computes total volume (weight × reps) for a list of sets.
 * Normalizes all weights to current unit before calculating.
 * Handles both bilateral and unilateral exercises.
 *
 * Why: Volume is the primary metric for workout intensity and progress
 * Performance: O(n) where n = number of sets
 * Optimization: Running in worker prevents blocking UI during calculation
 */
const computeVolume = (sets: WorkoutSet[], currentUnit: WeightUnit): number | null => {
  if (sets.length === 0) return null;
  let total = 0;
  let hasValue = false;

  sets.forEach((set) => {
    if (set.is_unilateral) {
      // Unilateral exercise: sum volume from both sides
      const leftWeight = normalizeWeightValue(set.leftWeight, set.unit, currentUnit);
      const rightWeight = normalizeWeightValue(set.rightWeight, set.unit, currentUnit);
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
      // Bilateral exercise: standard calculation
      const normalizedWeight = normalizeWeightValue(set.weight, set.unit, currentUnit);
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
 * Normalizes weights to current unit for accurate comparison.
 * Handles both bilateral and unilateral exercises.
 *
 * Why: Tracks strength progression (max weight milestone)
 * Performance: O(n) iteration
 * Optimization: Simple comparison avoids expensive sorting
 */
const computeHeaviestWeight = (sets: WorkoutSet[], currentUnit: WeightUnit): number | null => {
  let max: number | null = null;

  sets.forEach((set) => {
    if (set.is_unilateral) {
      // Unilateral exercise: check both left and right weights
      const leftNormalized = normalizeWeightValue(set.leftWeight, set.unit, currentUnit);
      const rightNormalized = normalizeWeightValue(set.rightWeight, set.unit, currentUnit);

      if (leftNormalized !== null) {
        if (max === null || leftNormalized > max) {
          max = leftNormalized;
        }
      }
      if (rightNormalized !== null) {
        if (max === null || rightNormalized > max) {
          max = rightNormalized;
        }
      }
    } else {
      // Bilateral exercise: standard calculation
      const normalized = normalizeWeightValue(set.weight, set.unit, currentUnit);
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
 * Handles both bilateral and unilateral exercises.
 *
 * Why: Tracks total work volume (important for hypertrophy tracking)
 * Performance: O(n) iteration
 * Optimization: Early return for empty sets prevents unnecessary iteration
 */
const computeTotalReps = (sets: WorkoutSet[]): number | null => {
  if (sets.length === 0) return null;
  let total = 0;
  let hasValue = false;

  sets.forEach((set) => {
    if (set.is_unilateral) {
      // Unilateral exercise: sum reps from both sides
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
      // Bilateral exercise: standard calculation
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
 * Computes separate volume and reps totals for left/right limbs in unilateral exercises.
 * This enables imbalance detection and limb-specific progress tracking.
 *
 * Why: Critical for identifying and correcting strength imbalances
 * Performance: O(n) single-pass iteration
 * Optimization: Calculates all limb metrics in one loop to minimize iterations
 */
const computeLimbTotals = (sets: WorkoutSet[], currentUnit: WeightUnit) => {
  let leftVolume = 0;
  let rightVolume = 0;
  let leftRepsTotal = 0;
  let rightRepsTotal = 0;
  let hasLeft = false;
  let hasRight = false;

  sets.forEach((set) => {
    const leftWeight = normalizeWeightValue(set.leftWeight, set.unit, currentUnit);
    const rightWeight = normalizeWeightValue(set.rightWeight, set.unit, currentUnit);
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

/**
 * Computes aggregate session statistics for all exercises in a workout.
 * This is the most expensive calculation, processing all sets across all exercises.
 *
 * Why: Provides comprehensive workout summary for completion screen
 * Performance: O(n*m) where n = exercises, m = avg sets per exercise
 * Optimization: Running in worker is CRITICAL - prevents UI freezing with large workouts
 *               (e.g., 10 exercises × 5 sets = 50 iterations without blocking render)
 */
const computeSessionStats = (
  exercises: Array<{ sets: WorkoutSet[]; isUnilateral?: boolean }>,
  currentUnit: WeightUnit
) => {
  const sessionTotals = {
    leftVolume: 0,
    rightVolume: 0,
    totalVolume: 0,
    leftReps: 0,
    rightReps: 0,
    totalReps: 0,
    hasLeft: false,
    hasRight: false,
    hasVolume: false,
    hasReps: false,
  };

  exercises.forEach((exercise) => {
    const workingSets = exercise.sets.filter((s) => !s.is_warmup);

    if (exercise.isUnilateral) {
      // Unilateral exercise: track left/right separately
      const limbTotals = computeLimbTotals(workingSets, currentUnit);

      if (limbTotals.leftVolume !== null) {
        sessionTotals.leftVolume += limbTotals.leftVolume;
        sessionTotals.hasLeft = true;
        sessionTotals.hasVolume = true;
      }
      if (limbTotals.rightVolume !== null) {
        sessionTotals.rightVolume += limbTotals.rightVolume;
        sessionTotals.hasRight = true;
        sessionTotals.hasVolume = true;
      }
      if (limbTotals.leftReps !== null) {
        sessionTotals.leftReps += limbTotals.leftReps;
        sessionTotals.hasReps = true;
      }
      if (limbTotals.rightReps !== null) {
        sessionTotals.rightReps += limbTotals.rightReps;
        sessionTotals.hasReps = true;
      }

      const hasVolumeContribution =
        limbTotals.leftVolume !== null || limbTotals.rightVolume !== null;
      const hasRepContribution =
        limbTotals.leftReps !== null || limbTotals.rightReps !== null;

      if (hasVolumeContribution) {
        sessionTotals.totalVolume +=
          (limbTotals.leftVolume ?? 0) + (limbTotals.rightVolume ?? 0);
        sessionTotals.hasVolume = true;
      }
      if (hasRepContribution) {
        sessionTotals.totalReps +=
          (limbTotals.leftReps ?? 0) + (limbTotals.rightReps ?? 0);
        sessionTotals.hasReps = true;
      }
    } else {
      // Bilateral exercise: add to total volume
      const volume = computeVolume(workingSets, currentUnit);
      const reps = computeTotalReps(workingSets);

      if (volume !== null) {
        sessionTotals.totalVolume += volume;
        sessionTotals.hasVolume = true;
      }
      if (reps !== null) {
        sessionTotals.totalReps += reps;
        sessionTotals.hasReps = true;
      }
    }
  });

  return {
    leftVolume: sessionTotals.hasLeft ? sessionTotals.leftVolume : null,
    rightVolume: sessionTotals.hasRight ? sessionTotals.rightVolume : null,
    totalVolume: sessionTotals.hasVolume ? sessionTotals.totalVolume : null,
    leftReps: sessionTotals.hasLeft ? sessionTotals.leftReps : null,
    rightReps: sessionTotals.hasRight ? sessionTotals.rightReps : null,
    totalReps: sessionTotals.hasReps ? sessionTotals.totalReps : null,
    hasLeft: sessionTotals.hasLeft,
    hasRight: sessionTotals.hasRight,
  };
};

/**
 * Main message handler for the worker.
 * Routes calculation requests to appropriate functions and returns results.
 *
 * Why: Enables non-blocking calculations via message passing
 * Pattern: Request-response with optional requestId for tracking multiple concurrent requests
 */
self.onmessage = (event: MessageEvent<CalculationRequest>) => {
  const { type, data, requestId } = event.data;

  try {
    let result: any;

    switch (type) {
      case "computeVolume":
        result = computeVolume(data.sets ?? [], data.currentUnit ?? "kg");
        break;

      case "computeHeaviestWeight":
        result = computeHeaviestWeight(data.sets ?? [], data.currentUnit ?? "kg");
        break;

      case "computeTotalReps":
        result = computeTotalReps(data.sets ?? []);
        break;

      case "computeLimbTotals":
        result = computeLimbTotals(data.sets ?? [], data.currentUnit ?? "kg");
        break;

      case "computeSessionStats":
        result = computeSessionStats(data.exercises ?? [], data.currentUnit ?? "kg");
        break;

      case "aggregateUnilateral":
        if (data.aggregationType === "weight") {
          result = aggregateUnilateralWeight(data.leftValue, data.rightValue);
        } else if (data.aggregationType === "reps") {
          result = aggregateUnilateralReps(data.leftValue, data.rightValue);
        } else if (data.aggregationType === "rir") {
          result = aggregateUnilateralRir(data.leftValue, data.rightValue);
        }
        break;

      default:
        throw new Error(`Unknown calculation type: ${type}`);
    }

    const response: CalculationResponse = {
      type,
      result,
      requestId,
    };

    self.postMessage(response);
  } catch (error) {
    const response: CalculationResponse = {
      type,
      result: null,
      requestId,
      error: error instanceof Error ? error.message : "Unknown error",
    };

    self.postMessage(response);
  }
};

// Export for TypeScript type checking (not executed in worker context)
export {};
