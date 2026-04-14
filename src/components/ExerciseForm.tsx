import { memo, useMemo, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { RefreshCw, Trash2 } from "lucide-react";
import type { WorkoutExerciseState, WorkoutSetState, WeightUnit } from "@/pages/WorkoutSession";
import { cn } from "@/lib/utils";
import {
  aggregateUnilateralWeight,
  aggregateUnilateralReps,
  aggregateUnilateralRir,
  formatNumericString,
} from "@/pages/WorkoutSession/utils/aggregations";
import { ExerciseImage } from "@/components/ExerciseImage";
import { useNetworkStore } from "@/lib/network";

interface ExerciseFormProps {
  exercise: WorkoutExerciseState;
  currentUnit: WeightUnit;
  onAddSet: (workoutExerciseId: string) => void;
  onDeleteExercise: (workoutExerciseId: string) => void;
  onDeleteSet: (workoutExerciseId: string, setId: string) => void;
  onUpdateSet: (workoutExerciseId: string, setId: string, field: keyof WorkoutSetState, value: string | boolean) => void;
  onConvertWeight: (
    workoutExerciseId: string,
    setId: string,
    currentWeight: string,
    setUnit: WeightUnit,
    options?: { side?: "left" | "right" | "both" }
  ) => void;
  onToggleUnilateral: (workoutExerciseId: string, nextValue: boolean) => void;
  isUnilateral: boolean;
  togglePending: boolean;
  canToggleUnilateral: boolean;
}

const formatUnitLabel = (unit: WeightUnit) => (unit === "lb" ? "lb" : "kg");

const KEYCAP_DIGITS: Record<string, string> = {
  "0": "0️⃣",
  "1": "1️⃣",
  "2": "2️⃣",
  "3": "3️⃣",
  "4": "4️⃣",
  "5": "5️⃣",
  "6": "6️⃣",
  "7": "7️⃣",
  "8": "8️⃣",
  "9": "9️⃣",
  "10": "🔟",
};

const formatNumberAsKeycap = (value: number | string): string => {
  const stringValue = typeof value === "number" ? value.toString() : value;
  if (!stringValue) return "";
  if (KEYCAP_DIGITS[stringValue]) return KEYCAP_DIGITS[stringValue];
  return stringValue
    .split("")
    .map((digit) => KEYCAP_DIGITS[digit] ?? digit)
    .join("");
};

const buildSetSignature = (setData: WorkoutSetState) => {
  const parts = [
    setData.id,
    setData.weight,
    setData.reps,
    setData.rir,
    setData.leftWeight,
    setData.rightWeight,
    setData.leftReps,
    setData.rightReps,
    setData.leftRir,
    setData.rightRir,
    setData.is_warmup ? "1" : "0",
    setData.unit,
    setData.weightEdited ? "1" : "0",
    setData.repsEdited ? "1" : "0",
    setData.rirEdited ? "1" : "0",
  ];
  return parts.join(":");
};

const buildSetsSignature = (sets: WorkoutSetState[]) => sets.map(buildSetSignature).join("|");

interface UnilateralColumnProps {
  title: string;
  unit: WeightUnit;
  disabled: boolean;
  weight: string;
  reps: string;
  rir: string;
  onChange: (field: keyof Pick<WorkoutSetState, "leftWeight" | "rightWeight" | "leftReps" | "rightReps" | "leftRir" | "rightRir">, value: string) => void;
  prefix: "left" | "right";
  weightPrefilled: boolean;
  repsPrefilled: boolean;
  rirPrefilled: boolean;
}

const UnilateralColumn = ({
  title,
  unit,
  disabled,
  weight,
  reps,
  rir,
  onChange,
  prefix,
  weightPrefilled,
  repsPrefilled,
  rirPrefilled,
}: UnilateralColumnProps) => (
  <div className="flex-1 min-w-[160px] space-y-2">
    <div className="flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
    </div>
    <div className="grid grid-cols-2 gap-2 items-start">
      <div className="flex flex-col space-y-0.5 -translate-y-1">
        <span className="text-[10px] text-muted-foreground text-center leading-tight">
          ({formatUnitLabel(unit)})
        </span>
        <SetInputField
          value={weight}
          disabled={disabled}
          onChange={(value) =>
            onChange(`${prefix === "left" ? "leftWeight" : "rightWeight"}` as any, value)
          }
          onFocusPrefilled={weightPrefilled}
          placeholder="Weight"
          ariaLabel={`${title} weight (${formatUnitLabel(unit)})`}
          inputMode="decimal"
          pattern="[0-9]*\\.?[0-9]*"
          className={cn("h-9 text-sm text-center", weightPrefilled && "text-[#9CA3AF] italic")}
        />
      </div>
      <div className="flex flex-col space-y-0.5 -translate-y-1">
        <span className="text-[10px] text-transparent leading-tight select-none" aria-hidden="true">
          ({formatUnitLabel(unit)})
        </span>
        <SetInputField
          value={reps}
          disabled={disabled}
          onChange={(value) =>
            onChange(`${prefix === "left" ? "leftReps" : "rightReps"}` as any, value)
          }
          onFocusPrefilled={repsPrefilled}
          placeholder="Reps"
          ariaLabel={`${title} reps`}
          inputMode="numeric"
          pattern="[0-9]*"
          className={cn("h-9 text-sm text-center", repsPrefilled && "text-[#9CA3AF] italic")}
        />
      </div>
    </div>
    <SetInputField
      value={rir}
      disabled={disabled}
      onChange={(value) =>
        onChange(`${prefix === "left" ? "leftRir" : "rightRir"}` as any, value)
      }
      onFocusPrefilled={rirPrefilled}
      placeholder="RIR"
      ariaLabel={`${title} RIR`}
      inputMode="numeric"
      pattern="[0-9]*"
      className={cn("h-9 text-sm text-center", rirPrefilled && "text-[#9CA3AF] italic")}
    />
  </div>
);

interface SetInputFieldProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onFocusPrefilled?: boolean;
  ariaLabel: string;
  inputMode?: "decimal" | "numeric";
  pattern?: string;
  className?: string;
}

const SetInputField = memo(
  ({
    value,
    placeholder,
    disabled,
    onChange,
    onFocusPrefilled,
    ariaLabel,
    inputMode = "decimal",
    pattern,
    className,
  }: SetInputFieldProps) => (
    <Input
      type="text"
      inputMode={inputMode}
      pattern={pattern}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onFocus={(e) => onFocusPrefilled && e.target.select()}
      className={className}
      placeholder={placeholder}
      aria-label={ariaLabel}
      disabled={disabled}
    />
  ),
  (prev, next) =>
    prev.value === next.value &&
    prev.disabled === next.disabled &&
    prev.onFocusPrefilled === next.onFocusPrefilled &&
    prev.placeholder === next.placeholder &&
    prev.ariaLabel === next.ariaLabel &&
    prev.inputMode === next.inputMode &&
    prev.pattern === next.pattern &&
    prev.className === next.className &&
    prev.onChange === next.onChange
);

interface SetRowProps {
  setData: WorkoutSetState;
  currentUnit: WeightUnit;
  onUpdate: (field: keyof WorkoutSetState, value: string | boolean) => void;
  onConvert: (options?: { side?: "left" | "right" | "both" }) => void;
  onDelete: () => void;
  disabled: boolean;
  allowOptimisticEditing: boolean;
}

const SetRow = memo(
  ({
    setData,
    currentUnit,
    onUpdate,
    onConvert,
    onDelete,
    disabled,
    allowOptimisticEditing,
  }: SetRowProps) => {
    if (!setData.id) return null;
    const isPending = (!!setData.isOptimistic && !allowOptimisticEditing) || disabled;
    const unitLabel = setData.unit || currentUnit;
    const targetUnit: WeightUnit = unitLabel === "kg" ? "lb" : "kg";
    const isUnilateral = Boolean(setData.is_unilateral);
    const setNoDisplay = formatNumberAsKeycap(setData.set_no ?? "");
    const weightPrefilled = Boolean(setData.weight) && setData.weightEdited === false;
    const repsPrefilled = Boolean(setData.reps) && setData.repsEdited === false;
    const rirPrefilled = Boolean(setData.rir) && setData.rirEdited === false;
    const warmupPrefilled =
      typeof setData.lastSession?.isWarmup === "boolean" && setData.warmupEdited === false;
    const leftWeightPrefilled = setData.weightEdited === false && Boolean(setData.leftWeight);
    const rightWeightPrefilled = setData.weightEdited === false && Boolean(setData.rightWeight);
    const leftRepsPrefilled = setData.repsEdited === false && Boolean(setData.leftReps);
    const rightRepsPrefilled = setData.repsEdited === false && Boolean(setData.rightReps);
    const leftRirPrefilled = setData.rirEdited === false && Boolean(setData.leftRir);
    const rightRirPrefilled = setData.rirEdited === false && Boolean(setData.rightRir);

    if (isUnilateral) {
      return (
        <div className={`rounded-lg border p-3 space-y-3 ${isPending ? "opacity-70" : ""}`}>
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold">Set {setData.set_no}</div>
            <Button
              type="button"
              variant={setData.is_warmup ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-9 sm:h-10 px-2.5 sm:px-4 text-xs sm:text-sm rounded-full whitespace-nowrap",
                warmupPrefilled && "text-[#9CA3AF] italic"
              )}
              onClick={(e) => {
                if (!isPending) {
                  onUpdate("is_warmup", !setData.is_warmup);
                  e.currentTarget.blur();
                }
              }}
              aria-label={`Set ${setData.set_no} warmup toggle`}
              disabled={isPending}
            >
              Warmup
            </Button>
          </div>

          <div className="flex flex-col md:flex-row gap-4">
            <UnilateralColumn
              title="Left"
              unit={unitLabel}
              disabled={isPending}
              weight={setData.leftWeight ?? ""}
              reps={setData.leftReps ?? ""}
              rir={setData.leftRir ?? ""}
              onChange={(field, value) => onUpdate(field, value)}
              prefix="left"
              weightPrefilled={leftWeightPrefilled}
              repsPrefilled={leftRepsPrefilled}
              rirPrefilled={leftRirPrefilled}
            />
            <UnilateralColumn
              title="Right"
              unit={unitLabel}
              disabled={isPending}
              weight={setData.rightWeight ?? ""}
              reps={setData.rightReps ?? ""}
              rir={setData.rightRir ?? ""}
              onChange={(field, value) => onUpdate(field, value)}
              prefix="right"
              weightPrefilled={rightWeightPrefilled}
              repsPrefilled={rightRepsPrefilled}
              rirPrefilled={rightRirPrefilled}
            />
          </div>

          <div className="flex items-center justify-between">
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                if (!isPending) {
                  onConvert({ side: "both" });
                  e.currentTarget.blur();
                }
              }}
              disabled={isPending}
              className="h-9 w-9"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                if (!isPending) {
                  onDelete();
                  e.currentTarget.blur();
                }
              }}
              disabled={isPending}
              className="h-9 w-9 text-destructive"
            >
              <Trash2 className="h-4.5 w-4.5" />
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className={`space-y-1 ${isPending ? "opacity-70" : ""}`}>
        <div className="grid w-full items-end gap-x-1 sm:gap-x-1.5 grid-cols-[auto,3.5rem,3.5rem,3.5rem,4.1rem,4.4rem] sm:grid-cols-[auto,4.75rem,4.75rem,4.75rem,4.75rem,4.75rem,5.25rem]">
          <span className="flex items-center justify-center h-9 sm:h-11 text-base sm:text-lg font-bold text-foreground -translate-y-1 sm:-translate-y-1.5 -translate-x-5 sm:-translate-x-6">
            {setNoDisplay || setData.set_no}
          </span>
          <div className="flex flex-col items-stretch -translate-x-5 sm:-translate-x-6">
            <div className="text-[9px] sm:text-[10px] uppercase tracking-wide text-muted-foreground mb-1 text-center leading-tight">
              <span className="block">Weight</span>
              <span className="block text-[8px] sm:text-[9px]">({formatUnitLabel(unitLabel)})</span>
            </div>
            <SetInputField
              value={setData.weight ?? ""}
              onChange={(value) => onUpdate("weight", value)}
              onFocusPrefilled={weightPrefilled}
              className={cn(
                "h-9 sm:h-11 text-sm sm:text-base text-center px-2.5 sm:px-3 w-full",
                weightPrefilled && "text-[#9CA3AF] italic"
              )}
              placeholder="-"
              ariaLabel={`Set ${setData.set_no} weight (${unitLabel})`}
              disabled={isPending}
              inputMode="decimal"
              pattern="[0-9]*\\.?[0-9]*"
            />
          </div>
          <div className="flex flex-col -translate-x-5 sm:-translate-x-6">
            <span className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground mb-1 text-center">
              Reps
            </span>
            <SetInputField
              value={setData.reps ?? ""}
              onChange={(value) => onUpdate("reps", value)}
              onFocusPrefilled={repsPrefilled}
              className={cn(
                "h-9 sm:h-11 text-sm sm:text-base text-center px-2.5 sm:px-3 w-full",
                repsPrefilled && "text-[#9CA3AF] italic"
              )}
              placeholder="-"
              ariaLabel={`Set ${setData.set_no} reps`}
              disabled={isPending}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
          <div className="flex flex-col -translate-x-5 sm:-translate-x-6">
            <span className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground mb-1 text-center">
              RIR
            </span>
            <SetInputField
              value={setData.rir ?? ""}
              onChange={(value) => onUpdate("rir", value)}
              onFocusPrefilled={rirPrefilled}
              className={cn(
                "h-9 sm:h-11 text-sm sm:text-base text-center px-2.5 sm:px-3 w-full",
                rirPrefilled && "text-[#9CA3AF] italic"
              )}
              placeholder="-"
              ariaLabel={`Set ${setData.set_no} RIR`}
              disabled={isPending}
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
          <div className="hidden sm:flex sm:flex-col sm:items-stretch sm:-translate-x-6">
            <Input
              type="number"
              step="0.5"
              min="1"
              max="10"
              value={setData.rpe}
              onChange={(e) => onUpdate("rpe", e.target.value)}
              className="h-11 text-sm px-3 w-full"
              placeholder="-"
              aria-label={`Set ${setData.set_no} RPE`}
              disabled={isPending}
            />
          </div>
          <div className="flex justify-center min-w-[4.25rem] sm:min-w-[4.75rem] -translate-x-5 sm:-translate-x-6">
            <Button
              type="button"
              variant={setData.is_warmup ? "default" : "outline"}
              size="sm"
              className={cn(
                "h-9 sm:h-10 px-2.5 sm:px-4 text-xs sm:text-sm rounded-full whitespace-nowrap",
                warmupPrefilled && "text-[#9CA3AF] italic"
              )}
              onClick={(e) => {
                onUpdate("is_warmup", !setData.is_warmup);
                e.currentTarget.blur();
              }}
              aria-label={`Set ${setData.set_no} warmup toggle`}
              disabled={isPending}
            >
              Warmup
            </Button>
          </div>
          <div className="min-w-[5.5rem] sm:min-w-[6.25rem] grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 sm:gap-x-3 self-stretch -translate-x-6 sm:-translate-x-7">
            <div className="flex flex-col items-center justify-center gap-0.5 flex-shrink-0 justify-self-end translate-x-3 sm:translate-x-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  if (!isPending) {
                    onConvert();
                    e.currentTarget.blur();
                  }
                }}
                className="h-8 w-8 sm:h-9 sm:w-9"
                aria-label={`Convert weight to ${targetUnit}`}
                title={`Convert to ${targetUnit}`}
                disabled={isPending}
              >
                <RefreshCw className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
              <span className="text-[10px] sm:text-xs uppercase tracking-wide text-muted-foreground">
                ({formatUnitLabel(unitLabel)})
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => {
                if (!isPending) {
                  onDelete();
                  e.currentTarget.blur();
                }
              }}
              className="h-8 w-8 sm:h-9 sm:w-9 flex items-center justify-center text-destructive"
              aria-label="Delete set"
              disabled={isPending}
            >
              <Trash2 className="h-4 w-4 sm:h-5 sm:w-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }
);

SetRow.displayName = "SetRow";

type SetHandlerMaps = {
  update: Record<string, (field: keyof WorkoutSetState, value: string | boolean) => void>;
  remove: Record<string, () => void>;
  convert: Record<string, (options?: { side?: "left" | "right" | "both" }) => void>;
};

interface SetsListProps {
  exerciseId: string | number;
  sets: WorkoutSetState[];
  currentUnit: WeightUnit;
  handlerMaps: SetHandlerMaps;
  exerciseDisabled: boolean;
  allowOptimisticEditing: boolean;
}

const SetsList = memo(
  ({
    exerciseId,
    sets,
    currentUnit,
    handlerMaps,
    exerciseDisabled,
    allowOptimisticEditing,
  }: SetsListProps) => (
    <div className="space-y-3">
      {sets.map((set) => {
        const setId = set.id;
        if (!setId) return null;
        return (
          <SetRow
            key={setId}
            setData={set}
            currentUnit={currentUnit}
            onUpdate={handlerMaps.update[setId]}
            onConvert={handlerMaps.convert[setId]}
            onDelete={handlerMaps.remove[setId]}
            disabled={exerciseDisabled}
            allowOptimisticEditing={allowOptimisticEditing}
          />
        );
      })}
    </div>
  ),
  (prev, next) =>
    prev.exerciseId === next.exerciseId &&
    prev.currentUnit === next.currentUnit &&
    prev.exerciseDisabled === next.exerciseDisabled &&
    prev.allowOptimisticEditing === next.allowOptimisticEditing &&
    buildSetsSignature(prev.sets) === buildSetsSignature(next.sets)
);

SetsList.displayName = "SetsList";

const areExerciseFormPropsEqual = (prev: ExerciseFormProps, next: ExerciseFormProps) => {
  if (prev.currentUnit !== next.currentUnit) return false;
  if (prev.isUnilateral !== next.isUnilateral) return false;
  if (prev.togglePending !== next.togglePending) return false;
  if (prev.canToggleUnilateral !== next.canToggleUnilateral) return false;
  if (prev.exercise.id !== next.exercise.id) return false;

  const prevExerciseMeta = prev.exercise.exercise || {};
  const nextExerciseMeta = next.exercise.exercise || {};

  if ((prevExerciseMeta.name ?? "") !== (nextExerciseMeta.name ?? "")) return false;
  if ((prevExerciseMeta.image_url ?? "") !== (nextExerciseMeta.image_url ?? "")) return false;
  if ((prevExerciseMeta.equipment ?? "") !== (nextExerciseMeta.equipment ?? "")) return false;
  if ((prevExerciseMeta.muscle_group ?? "") !== (nextExerciseMeta.muscle_group ?? "")) return false;

  const prevOptimistic = Boolean(prev.exercise.isOptimistic);
  const nextOptimistic = Boolean(next.exercise.isOptimistic);
  if (prevOptimistic !== nextOptimistic) return false;

  if (buildSetsSignature(prev.exercise.sets) !== buildSetsSignature(next.exercise.sets)) {
    return false;
  }

  return true;
};

export const ExerciseForm = memo(
  ({
    exercise,
    currentUnit,
    onAddSet,
    onDeleteExercise,
    onDeleteSet,
    onUpdateSet,
    onConvertWeight,
    onToggleUnilateral,
    isUnilateral,
    togglePending,
    canToggleUnilateral,
  }: ExerciseFormProps) => {
    const exerciseDisabled = Boolean(exercise.isOptimistic || togglePending);
    const offlineStoreFlag = useNetworkStore(
      (state) => state.debugOfflineMode || !state.isOnline || !state.isHighQuality
    );
    const allowOptimisticEditing =
      offlineStoreFlag || (typeof navigator !== "undefined" ? !navigator.onLine : false);
    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [localUnilateral, setLocalUnilateral] = useState(isUnilateral);

    useEffect(() => {
      setLocalUnilateral(isUnilateral);
    }, [isUnilateral]);
    const setIdSignature = useMemo(
      () => exercise.sets.map((set) => (set.id ? String(set.id) : "")).join("|"),
      [exercise.sets]
    );

    const handlerMaps = useMemo<SetHandlerMaps>(() => {
      const maps: SetHandlerMaps = { update: {}, remove: {}, convert: {} };
      const signatureIds = setIdSignature.split("|").filter(Boolean);
      signatureIds.forEach((setId) => {
        maps.update[setId] = (field, value) => onUpdateSet(exercise.id, setId, field, value);
        maps.remove[setId] = () => onDeleteSet(exercise.id, setId);
        maps.convert[setId] = (options) =>
          onConvertWeight(exercise.id, setId, "", currentUnit, options);
      });
      return maps;
    }, [exercise.id, currentUnit, onUpdateSet, onDeleteSet, onConvertWeight, setIdSignature]);

    const getDisplaySet = useCallback(
      (set: WorkoutSetState): WorkoutSetState => {
        const setIsUnilateral = Boolean(set.is_unilateral);
        if (localUnilateral === setIsUnilateral) {
          return set;
        }

        if (localUnilateral) {
          const bilateralWeight = set.weight ?? "";
          const bilateralReps = set.reps ?? "";
          const bilateralRir = set.rir ?? "";
          return {
            ...set,
            is_unilateral: true,
            leftWeight: set.leftWeight ?? bilateralWeight,
            rightWeight: set.rightWeight ?? bilateralWeight,
            leftReps: set.leftReps ?? bilateralReps,
            rightReps: set.rightReps ?? bilateralReps,
            leftRir: set.leftRir ?? bilateralRir,
            rightRir: set.rightRir ?? bilateralRir,
          };
        }

        const aggregatedWeight = formatNumericString(
          aggregateUnilateralWeight(set.leftWeight ?? "", set.rightWeight ?? "")
        );
        const aggregatedReps = formatNumericString(
          aggregateUnilateralReps(set.leftReps ?? "", set.rightReps ?? "")
        );
        const aggregatedRir = aggregateUnilateralRir(set.leftRir ?? "", set.rightRir ?? "");

        return {
          ...set,
          is_unilateral: false,
          weight: aggregatedWeight ?? set.weight ?? "",
          reps: aggregatedReps ?? set.reps ?? "",
          rir: aggregatedRir === null ? set.rir ?? "" : aggregatedRir.toString(),
        };
      },
      [localUnilateral]
    );

    const displaySets = useMemo(() => {
      if (localUnilateral === isUnilateral) {
        return exercise.sets;
      }
      return exercise.sets.map((set) => getDisplaySet(set));
    }, [exercise.sets, getDisplaySet, localUnilateral, isUnilateral]);

    return (
      <>
        <Card className="border">
          <CardHeader className="pb-2 sm:pb-4 px-3 sm:px-6 pt-3 sm:pt-6">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 flex-1 min-w-0">
                <div className="flex flex-col gap-2">
                  <ExerciseImage
                    exerciseId={exercise.exercise.id}
                    imageUrl={exercise.exercise.image_url || undefined}
                    exerciseName={exercise.exercise.name}
                    size="md"
                    className="w-16 h-16 sm:w-18 sm:h-18"
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <CardTitle className="text-base sm:text-xl mb-0.5 sm:mb-1 break-words leading-tight">
                    {exercise.exercise.name}
                    {localUnilateral && <span className="text-muted-foreground font-normal text-sm"> (Unilateral)</span>}
                  </CardTitle>
                  {exercise.exercise.equipment && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {exercise.exercise.equipment} • {exercise.exercise.muscle_group}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    if (!exerciseDisabled) {
                      setShowDeleteDialog(true);
                      e.currentTarget.blur();
                    }
                  }}
                  className="h-8 w-8 sm:h-9 sm:w-9 text-destructive flex-shrink-0"
                  aria-label="Delete exercise"
                  disabled={exerciseDisabled}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                {canToggleUnilateral && (
                  <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className={!localUnilateral ? "font-medium" : ""}>Bi</span>
                    <Switch
                      checked={localUnilateral}
                      onCheckedChange={(value) => {
                        if (exerciseDisabled) {
                          return;
                        }
                        setLocalUnilateral(value);
                        onToggleUnilateral(exercise.id, value);
                      }}
                      disabled={exerciseDisabled}
                      className="scale-75"
                    />
                    <span className={localUnilateral ? "font-medium" : ""}>Uni</span>
                  </div>
                )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 sm:space-y-4">
          <SetsList
            exerciseId={exercise.id}
            sets={displaySets}
            currentUnit={currentUnit}
            handlerMaps={handlerMaps}
            exerciseDisabled={exerciseDisabled}
            allowOptimisticEditing={allowOptimisticEditing}
          />

          <div className="pt-1 flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={(e) => {
                const button = e.currentTarget;
                onAddSet(exercise.id);
                requestAnimationFrame(() => {
                  requestAnimationFrame(() => {
                    button.blur();
                  });
                });
              }}
              className="h-8 sm:h-9 w-9 sm:w-10 flex items-center justify-center focus:outline-none focus-visible:outline-none active:outline-none focus-visible:ring-0"
              aria-label="Add set"
              disabled={exerciseDisabled}
            >
              +
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className="rounded-2xl max-w-[90vw] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">Delete Exercise?</AlertDialogTitle>
            <AlertDialogDescription className="text-base pt-2">
              Are you sure you want to delete <span className="font-semibold text-foreground">{exercise.exercise.name}</span>? This will remove all sets and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2 sm:gap-2">
            <AlertDialogCancel className="rounded-xl m-0 sm:m-0">
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onDeleteExercise(exercise.id);
                setShowDeleteDialog(false);
              }}
              className="rounded-xl bg-destructive text-destructive-foreground hover:bg-destructive/90 m-0 sm:m-0"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
    );
  },
  areExerciseFormPropsEqual
);

ExerciseForm.displayName = "ExerciseForm";
