/**
 * aggregations.ts
 *
 * Utility functions for aggregating unilateral exercise data.
 * Used when displaying bilateral equivalents of unilateral exercises.
 *
 * Performance: All functions are O(1) operations
 */

/**
 * Parses a numeric string, handling empty, null, or invalid values.
 *
 * Why: Ensures consistent numeric handling across all calculations
 * Performance: O(1)
 */
export const parseNumericString = (value?: string | null): number | null => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Formats a numeric value as a string for display.
 *
 * Why: Maintains consistent decimal formatting (integers shown without decimals)
 * Performance: O(1)
 */
export const formatNumericString = (value: number | null): string => {
  if (value === null || Number.isNaN(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

/**
 * Aggregates unilateral weight by taking the maximum of left/right.
 * Used for display in bilateral view (shows stronger side).
 *
 * Why: Users want to see their maximum capability when viewing aggregated data
 * Performance: O(1) operation
 *
 * @param left - Left limb weight (string)
 * @param right - Right limb weight (string)
 * @returns Maximum weight or null if both are null
 */
export const aggregateUnilateralWeight = (left?: string, right?: string): number | null => {
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
 *
 * @param left - Left limb reps (string)
 * @param right - Right limb reps (string)
 * @returns Maximum reps or null if both are null
 */
export const aggregateUnilateralReps = (left?: string, right?: string): number | null => {
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
 *
 * @param left - Left limb RIR (string)
 * @param right - Right limb RIR (string)
 * @returns Minimum RIR or null if both are null
 */
export const aggregateUnilateralRir = (left?: string, right?: string): number | null => {
  const leftValue = parseNumericString(left);
  const rightValue = parseNumericString(right);
  if (leftValue === null && rightValue === null) return null;
  if (leftValue === null) return rightValue;
  if (rightValue === null) return leftValue;
  return Math.min(leftValue, rightValue);
};

/**
 * Returns the first non-empty string value from the provided list.
 * Used for coalescing values with fallbacks.
 *
 * Why: Enables graceful fallback to alternative values
 * Performance: O(n) where n = number of values (typically 2-3)
 *
 * @param values - List of values to check
 * @returns First non-empty value or empty string
 */
export const coalesceNonEmpty = (...values: (string | null | undefined)[]): string => {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return "";
};
