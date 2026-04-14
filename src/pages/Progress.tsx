import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Paywall } from "@/components/Paywall";
import { FeatureLock } from "@/components/FeatureLock";
import { ExerciseImage } from "@/components/ExerciseImage";
import { getSupabaseSession } from "@/lib/session";
import { TrendingUp, Search, Dumbbell, RefreshCw } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LiquidGlassHeader } from "@/components/LiquidGlassHeader";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { convertWeight } from "@/lib/conversions";
import { useExerciseProgress } from "@/hooks/useExerciseProgress";
import { useUserProfile } from "@/hooks/useUserProfile";
import { useQueryClient } from "@tanstack/react-query";

// Pull-to-refresh constants
const PULL_TO_REFRESH_THRESHOLD = 80;
const PULL_TO_REFRESH_MAX_DISTANCE = 120;
const PULL_DEAD_ZONE = 15;
const PULL_DAMPING = 0.55;

interface Exercise {
  id: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  image_url: string | null;
}

interface ExerciseProgress {
  exercise: Exercise;
  totalSets: number;
  maxWeight: number;
  unit: string;
  lastWorkout: string;
  detailExerciseId: string;
  isUnilateral?: boolean;
  maxWeightLeft?: number;
  maxWeightRight?: number;
  maxRepsLeft?: number;
  maxRepsRight?: number;
}

interface RawWorkout {
  id: string;
  ended_at: string | null;
  started_at: string | null;
  created_at: string | null;
}

interface RawWorkoutExercise {
  id: string;
  workout_id: string;
  exercise_id: string;
  exercise: Exercise | null;
  sets: Array<{
    set_no: number | null;
    weight: number | null;
    reps: number | null;
    rir: number | null;
    unit: "kg" | "lb" | null;
    is_warmup: boolean | null;
    is_unilateral: boolean | null;
    left_weight: number | null;
    right_weight: number | null;
    left_reps: number | null;
    right_reps: number | null;
    left_rir: number | null;
    right_rir: number | null;
  }> | null;
}

const Progress = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isPremium, isLoading: subscriptionLoading, hasHydrated } = useSubscription();

  // Treat as premium if: actually premium OR still loading OR not yet hydrated from localStorage
  // This prevents the flash of "need premium" on app resume
  const effectiveIsPremium = isPremium || subscriptionLoading || !hasHydrated;

  // Debug logging for subscription state
  console.log('[Progress] 🎯 Render - subscription state:', {
    isPremium,
    subscriptionLoading,
    hasHydrated,
    effectiveIsPremium,
  });
  const [showPaywall, setShowPaywall] = useState(false);
  const [search, setSearch] = useState("");
  const [userId, setUserId] = useState<string | null>(null);

  // Pull-to-refresh refs
  const mainContainerRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
  const isHandlingPullRef = useRef(false);

  // Pull-to-refresh state
  const [pullState, setPullState] = useState<{
    isPulling: boolean;
    pullDistance: number;
    visualDistance: number;
    isRefreshing: boolean;
  }>({
    isPulling: false,
    pullDistance: 0,
    visualDistance: 0,
    isRefreshing: false,
  });

  // OPTIMIZATION: Use React Query for profile
  const { data: profile } = useUserProfile(userId ?? "", undefined);
  const preferredUnit: "kg" | "lb" = profile?.unit_default === "lb" ? "lb" : "kg";

  // OPTIMIZATION: Use React Query for exercise progress data (auto-caches, auto-refetches)
  const { data: workoutExercisesData, isLoading: loading } = useExerciseProgress(userId ?? "", 60);

  // Initialize user on mount
  useEffect(() => {
    const initUser = async () => {
      try {
        const session = await getSupabaseSession();
        if (!session?.user) {
          navigate("/auth");
          return;
        }
        setUserId(session.user.id);
      } catch (error) {
        console.error("Failed to get session:", error);
        navigate("/auth");
      }
    };
    initUser();
  }, [navigate]);

  // OPTIMIZATION: Process exercise progress data with useMemo (only recalc when data/unit changes)
  const progress = useMemo(() => {
    if (!workoutExercisesData || workoutExercisesData.length === 0) {
      return [];
    }

    const toNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    // Group ALL workout_exercises by exercise_id AND tracking mode (bilateral/unilateral)
    // This ensures progress is tracked separately for the same exercise done both ways
    const exerciseMap = new Map<string, typeof workoutExercisesData>();
    for (const item of workoutExercisesData) {
      const sets = item.sets ?? [];
      const hasUnilateralSets = sets.some((set) => set.is_unilateral);
      const key = `${item.exercise_id}:${hasUnilateralSets ? "unilateral" : "bilateral"}`;
      const existing = exerciseMap.get(key) || [];
      existing.push(item);
      exerciseMap.set(key, existing);
    }

    const progressArray: ExerciseProgress[] = [];
    for (const [exerciseId, workoutExercises] of exerciseMap.entries()) {
      if (workoutExercises.length === 0) continue;

      // Get exercise info from first item (all should have same exercise data)
      const exerciseInfo = workoutExercises[0].exercise;
      if (!exerciseInfo) continue;

      // Collect ALL sets from ALL workouts for this exercise
      const allSets = workoutExercises.flatMap((we) => we.sets ?? []);
      const workingSets = allSets.filter((set) => !set.is_warmup);
      const setsForStats = workingSets.length > 0 ? workingSets : allSets;

      if (setsForStats.length === 0) continue;

      const convertToPreferred = (value: number | null, setUnit: "kg" | "lb" | null) => {
        if (value === null) return null;
        if (!setUnit || setUnit === preferredUnit) return value;
        return convertWeight(value, setUnit, preferredUnit);
      };

      // Check if exercise is unilateral (check any set)
      const isUnilateral = setsForStats.some((set) => set.is_unilateral);

      // Calculate max weight across ALL sets from ALL workouts
      let maxWeightValue: number | null = null;
      let maxWeightLeft: number | null = null;
      let maxWeightRight: number | null = null;
      let maxRepsLeft: number | null = null;
      let maxRepsRight: number | null = null;

      if (isUnilateral) {
        // For unilateral exercises, track left and right separately
        for (const set of setsForStats) {
          if (!set.is_unilateral) continue;

          const leftWeight = toNumber(set.left_weight);
          const rightWeight = toNumber(set.right_weight);
          const leftReps = toNumber(set.left_reps);
          const rightReps = toNumber(set.right_reps);

          if (leftWeight !== null && leftWeight > 0) {
            const converted = convertToPreferred(leftWeight, set.unit);
            if (converted !== null) {
              maxWeightLeft = maxWeightLeft === null ? converted : Math.max(maxWeightLeft, converted);
            }
          }

          if (rightWeight !== null && rightWeight > 0) {
            const converted = convertToPreferred(rightWeight, set.unit);
            if (converted !== null) {
              maxWeightRight = maxWeightRight === null ? converted : Math.max(maxWeightRight, converted);
            }
          }

          if (leftReps !== null && leftReps > 0) {
            maxRepsLeft = maxRepsLeft === null ? leftReps : Math.max(maxRepsLeft, leftReps);
          }

          if (rightReps !== null && rightReps > 0) {
            maxRepsRight = maxRepsRight === null ? rightReps : Math.max(maxRepsRight, rightReps);
          }
        }

        // Set maxWeightValue to the max of both sides for sorting purposes
        if (maxWeightLeft !== null || maxWeightRight !== null) {
          maxWeightValue = Math.max(maxWeightLeft ?? 0, maxWeightRight ?? 0);
        }
      } else {
        // For bilateral exercises, use existing logic
        maxWeightValue = setsForStats.reduce<number | null>((acc, set) => {
          const weight = toNumber(set.weight);
          if (weight === null || weight === 0) return acc;
          const converted = convertToPreferred(weight, set.unit);
          if (converted === null) return acc;
          return acc === null ? converted : Math.max(acc, converted);
        }, null);
      }

      // Find the most recent workout date for this exercise
      let mostRecentDate: string | null = null;
      for (const we of workoutExercises) {
        const workout = we.workouts;
        const workoutDate = workout?.ended_at ?? workout?.started_at ?? workout?.created_at ?? null;
        if (workoutDate && (!mostRecentDate || workoutDate > mostRecentDate)) {
          mostRecentDate = workoutDate;
        }
      }

      if (maxWeightValue !== null) {
        // Add suffix to exercise name to distinguish bilateral vs unilateral tracking
        // Only add "(Unilateral)" suffix for unilateral exercises, bilateral shows normal name
        const baseName = (exerciseInfo.name ?? "Unknown").replace(/\s*\(Unilateral\)\s*$/i, '').trim();
        const displayName = isUnilateral ? `${baseName} (Unilateral)` : baseName;

        progressArray.push({
          exercise: {
            id: exerciseInfo.id,
            name: displayName,
            equipment: exerciseInfo.equipment ?? null,
            muscle_group: exerciseInfo.muscle_group ?? null,
            image_url: exerciseInfo.image_url ?? null,
          },
          totalSets: setsForStats.length,
          maxWeight: maxWeightValue,
          unit: preferredUnit,
          lastWorkout: mostRecentDate ?? "",
          detailExerciseId: exerciseId.split(':')[0],
          isUnilateral,
          maxWeightLeft,
          maxWeightRight,
          maxRepsLeft,
          maxRepsRight,
        });
      }
    }

    return progressArray.sort((a, b) => {
      const aDate = a.lastWorkout ? new Date(a.lastWorkout).getTime() : 0;
      const bDate = b.lastWorkout ? new Date(b.lastWorkout).getTime() : 0;
      return bDate - aDate;
    });
  }, [workoutExercisesData, preferredUnit]);

  const filteredProgress = useMemo(() => {
    if (!search.trim()) return progress;
    const query = search.trim().toLowerCase();
    return progress.filter(
      (item) =>
        item.exercise.name.toLowerCase().includes(query) ||
        item.exercise.muscle_group?.toLowerCase().includes(query),
    );
  }, [search, progress]);

  // Pull-to-refresh: Invalidate queries (triggers automatic refetch)
  const refreshProgress = useCallback(async () => {
    if (pullState.isRefreshing) return;
    setPullState((prev) => ({
      ...prev,
      isPulling: false,
      pullDistance: 0,
      visualDistance: 0,
      isRefreshing: true,
    }));

    // Invalidate queries - this triggers automatic refetch for active queries
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['exerciseProgress'] }),
      queryClient.invalidateQueries({ queryKey: ['userProfile'] }),
    ]);

    // Stop refreshing immediately after invalidation completes
    setPullState({
      isPulling: false,
      pullDistance: 0,
      visualDistance: 0,
      isRefreshing: false,
    });
  }, [pullState.isRefreshing, queryClient]);

  // Pull-to-refresh touch handlers
  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (pullState.isRefreshing || !mainContainerRef.current) return;
      const scrollTop = mainContainerRef.current.scrollTop;
      if (scrollTop > 0) return;
      touchStartYRef.current = event.touches[0].clientY;
      lastTouchYRef.current = touchStartYRef.current;
      isHandlingPullRef.current = true;
      setPullState((prev) => ({ ...prev, isPulling: false, pullDistance: 0, visualDistance: 0 }));
    },
    [pullState.isRefreshing]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isHandlingPullRef.current || touchStartYRef.current === null) return;
      if (mainContainerRef.current && mainContainerRef.current.scrollTop > 0) {
        isHandlingPullRef.current = false;
        setPullState((prev) => ({
          ...prev,
          isPulling: false,
          pullDistance: 0,
          visualDistance: 0,
        }));
        return;
      }

      const currentY = event.touches[0].clientY;
      lastTouchYRef.current = currentY;
      const delta = currentY - touchStartYRef.current;

      if (delta <= 0) {
        setPullState((prev) => ({
          ...prev,
          isPulling: false,
          pullDistance: 0,
          visualDistance: 0,
        }));
        return;
      }

      const effectiveDelta = Math.max(0, delta - PULL_DEAD_ZONE);
      const dampedDistance = effectiveDelta * PULL_DAMPING;
      const clampedDistance = Math.min(dampedDistance, PULL_TO_REFRESH_MAX_DISTANCE);

      setPullState((prev) => ({
        ...prev,
        isPulling: true,
        pullDistance: clampedDistance,
        visualDistance: clampedDistance,
      }));
    },
    []
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isHandlingPullRef.current) return;
    isHandlingPullRef.current = false;
    const shouldRefresh = pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD && !pullState.isRefreshing;
    if (shouldRefresh) {
      setPullState((prev) => ({
        ...prev,
        isPulling: false,
        pullDistance: 0,
        visualDistance: 0,
        isRefreshing: true,
      }));
      await refreshProgress();
    } else {
      setPullState((prev) => ({
        ...prev,
        isPulling: false,
        pullDistance: 0,
        visualDistance: 0,
      }));
    }
    touchStartYRef.current = null;
    lastTouchYRef.current = null;
  }, [pullState.pullDistance, pullState.isRefreshing, refreshProgress]);

  const loadProgress_DEPRECATED = useCallback(async () => {
    try {
      setLoading(true);
      const session = await getSupabaseSession();
      const user = session?.user;
      if (!user) {
        navigate("/auth");
        return;
      }

      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("unit_default")
        .eq("id", user.id)
        .maybeSingle();
      if (profileError) throw profileError;
      const unitPref: "kg" | "lb" = profileData?.unit_default === "lb" ? "lb" : "kg";
      setPreferredUnit(unitPref);

      const { data: recentWorkouts, error: workoutsError } = await supabase
        .from("workouts")
        .select("id, ended_at, started_at, created_at")
        .eq("user_id", user.id)
        .not("ended_at", "is", null)
        .order("ended_at", { ascending: false, nullsLast: true })
        .limit(60);
      if (workoutsError) throw workoutsError;

      const workoutList = (recentWorkouts ?? []).filter(
        (workout): workout is RawWorkout => Boolean(workout?.id),
      );
      if (import.meta.env.DEV) console.log("[progress] fetched workouts", {
        rawCount: recentWorkouts?.length ?? 0,
        filteredCount: workoutList.length,
      });
      if (workoutList.length === 0) {
        setProgress([]);
        return;
      }

      const workoutIds = workoutList.map((workout) => workout.id);
      const workoutMeta = new Map<string, RawWorkout>();
      workoutList.forEach((workout) => {
        workoutMeta.set(workout.id, workout);
      });

      const { data: workoutExercisesData, error: workoutExercisesError } = await supabase
        .from("workout_exercises")
        .select(
          `
            id,
            workout_id,
            exercise_id,
            exercise:exercises!workout_exercises_exercise_id_fkey(id,name,equipment,muscle_group),
            sets(
              id,
              set_no,
              weight,
              reps,
              rir,
              unit,
              is_warmup,
              is_unilateral,
              left_weight,
              right_weight,
              left_reps,
              right_reps,
              left_rir,
              right_rir
            )
          `
        )
        .in("workout_id", workoutIds);
      if (workoutExercisesError) throw workoutExercisesError;

      if (import.meta.env.DEV) console.log("[progress] fetched workout exercises", {
        count: workoutExercisesData?.length ?? 0,
      });

      const exercisesByWorkout = new Map<string, RawWorkoutExercise[]>();
      (workoutExercisesData ?? []).forEach((item) => {
        if (!item?.workout_id) return;
        const list = exercisesByWorkout.get(item.workout_id) ?? [];
        list.push(item as RawWorkoutExercise);
        exercisesByWorkout.set(item.workout_id, list);
      });

      const toNumber = (value: unknown): number | null => {
        if (value === null || value === undefined || value === "") return null;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
      };

      const snapshots = new Map<
        string,
        {
          exercise: Exercise;
          endedAt: string | null;
          sets: RawWorkoutExercise["sets"];
        }
      >();

      for (const workout of workoutList) {
        const workoutExercises = exercisesByWorkout.get(workout.id) ?? [];
        if (workoutExercises.length === 0) continue;

        const endedAt =
          workout.ended_at ??
          workout.started_at ??
          workout.created_at ??
          null;

        for (const row of workoutExercises) {
          const exerciseId = row.exercise_id;
          const exerciseInfo = row.exercise;
          if (!exerciseId || !exerciseInfo) continue;
          if (snapshots.has(exerciseId)) continue;

          const orderedSets =
            (row.sets ?? []).slice().sort((a, b) => {
              const aNo = typeof a.set_no === "number" ? a.set_no : Number(a.set_no ?? 0);
              const bNo = typeof b.set_no === "number" ? b.set_no : Number(b.set_no ?? 0);
              return aNo - bNo;
            }) ?? [];

          if (orderedSets.length === 0) continue;

          snapshots.set(exerciseId, {
            exercise: {
              id: exerciseInfo.id,
              name: exerciseInfo.name ?? "Unknown exercise",
              equipment: exerciseInfo.equipment ?? null,
              muscle_group: exerciseInfo.muscle_group ?? null,
            },
            endedAt,
            sets: orderedSets.map((set) => ({
              ...set,
              weight: toNumber(set.weight),
              reps: toNumber(set.reps),
              rir: toNumber(set.rir),
              left_weight: toNumber(set.left_weight),
              right_weight: toNumber(set.right_weight),
              left_reps: toNumber(set.left_reps),
              right_reps: toNumber(set.right_reps),
              left_rir: toNumber(set.left_rir),
              right_rir: toNumber(set.right_rir),
            })),
          });
        }
      }

      if (import.meta.env.DEV) console.log("[progress] built snapshots", { count: snapshots.size });

      if (snapshots.size === 0) {
        setProgress([]);
        return;
      }

      const progressArray = Array.from(snapshots.entries())
        .map(([exerciseId, snapshot]) => {
          const sets = snapshot.sets ?? [];
          const workingSets = sets.filter((set) => !set.is_warmup);
          const setsForStats = workingSets.length > 0 ? workingSets : sets;
          if (setsForStats.length === 0) {
            return null;
          }

          const convertToPreferred = (value: number | null, setUnit: "kg" | "lb" | null) => {
            if (value === null || value === undefined) return null;
            const fromUnit = setUnit ?? unitPref;
            return fromUnit === unitPref ? value : convertWeight(value, fromUnit, unitPref);
          };

          const maxWeightValue = setsForStats.reduce<number | null>((acc, set) => {
            const candidates = [
              convertToPreferred(set.weight, set.unit),
              convertToPreferred(set.left_weight, set.unit),
              convertToPreferred(set.right_weight, set.unit),
            ].filter((value): value is number => value !== null);
            if (!candidates.length) {
              return acc;
            }
            const candidateMax = Math.max(...candidates);
            if (acc === null || candidateMax > acc) {
              return candidateMax;
            }
            return acc;
          }, null);

          const endedAt = snapshot.endedAt ?? new Date().toISOString();

          return {
            exercise: snapshot.exercise,
            totalSets: sets.length,
            maxWeight: maxWeightValue !== null ? Number(maxWeightValue.toFixed(2)) : 0,
            unit: unitPref,
            lastWorkout: endedAt,
            detailExerciseId: exerciseId,
          } as ExerciseProgress;
        })
        .filter((entry): entry is ExerciseProgress => entry !== null)
        .sort((a, b) => new Date(b.lastWorkout).getTime() - new Date(a.lastWorkout).getTime());

      if (import.meta.env.DEV) console.log("[progress] final progress array", { count: progressArray.length });

      setProgress(progressArray);
    } catch (error) {
      console.error("Failed to load progress", error);
      toast({
        title: "Error",
        description:
          error instanceof Error ? error.message : "Unable to load progress",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  // OPTIMIZATION: React Query auto-refetches, but we can also invalidate on events
  useEffect(() => {
    const invalidateProgress = () => {
      // Force immediate refetch by invalidating and refetching
      queryClient.invalidateQueries({ queryKey: ['exerciseProgress'] });
      queryClient.invalidateQueries({ queryKey: ['personalRecords'] });
      queryClient.refetchQueries({ queryKey: ['exerciseProgress'] });
      queryClient.refetchQueries({ queryKey: ['personalRecords'] });
    };

    window.addEventListener("post:created", invalidateProgress);
    window.addEventListener("post:deleted:confirmed", invalidateProgress);
    window.addEventListener("post:delete:failed", invalidateProgress);
    window.addEventListener("pr:updated", invalidateProgress);

    return () => {
      window.removeEventListener("post:created", invalidateProgress);
      window.removeEventListener("post:deleted:confirmed", invalidateProgress);
      window.removeEventListener("post:delete:failed", invalidateProgress);
      window.removeEventListener("pr:updated", invalidateProgress);
    };
  }, [queryClient]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <TrendingUp className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading progress...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      <LiquidGlassHeader>
        <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
          <TrendingUp className="h-5 w-5 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Progress</h1>
      </LiquidGlassHeader>

      <main
        ref={mainContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Pull to refresh indicator */}
        <div
          className="sticky top-0 z-20 mt-4 flex justify-center transition-all duration-150"
          style={{
            height: pullState.isRefreshing
              ? 60
              : pullState.isPulling
              ? Math.min(60, pullState.visualDistance * 0.4)
              : 0,
            opacity: pullState.isPulling || pullState.isRefreshing ? 1 : 0,
          }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw
              className={`h-4 w-4 ${
                pullState.isRefreshing
                  ? "animate-spin"
                  : pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD
                  ? "text-primary"
                  : ""
              }`}
            />
            <span>
              {pullState.isRefreshing
                ? "Refreshing..."
                : pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD
                ? "Release to refresh"
                : "Pull to refresh"}
            </span>
          </div>
        </div>

        <div className="container mx-auto px-4 py-6 space-y-4" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search exercises..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-10 h-12 text-base"
            />
          </div>
          {filteredProgress.length === 0 ? (
            <Card className="border-2">
              <CardContent className="py-12 text-center">
                <Dumbbell className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">
                  {progress.length === 0 ? "No progress data yet" : "No exercises found"}
                </h3>
                <p className="text-muted-foreground">
                  {progress.length === 0
                    ? "Share workouts with details to track your progress"
                    : "Try a different search term"}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Limit free users to 1 exercise */}
              {(effectiveIsPremium ? filteredProgress : filteredProgress.slice(0, 1)).map((item) => {
              const lastWorkoutDate = item.lastWorkout ? new Date(item.lastWorkout) : null;
              const lastWorkoutLabel =
                lastWorkoutDate && !Number.isNaN(lastWorkoutDate.getTime())
                  ? format(lastWorkoutDate, "MMM d, yyyy")
                  : "Unknown";

              return (
                <Card
                  key={`${item.detailExerciseId}-${item.isUnilateral ? 'unilateral' : 'bilateral'}`}
                  className="border-2 cursor-pointer transition-colors active:scale-[0.98]"
                  onClick={() => {
                    if (Capacitor.isNativePlatform()) {
                      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
                    }
                    navigate(`/exercise-progress/${item.detailExerciseId}`);
                  }}
                >
                  <CardHeader>
                    <div className="flex items-start gap-3">
                      <ExerciseImage
                        exerciseId={item.exercise.id}
                        imageUrl={item.exercise.image_url || undefined}
                        exerciseName={item.exercise.name}
                        className="w-14 h-14 sm:w-16 sm:h-16"
                      />
                      <div className="flex-1 min-w-0">
                        <CardTitle className="text-xl">{item.exercise.name}</CardTitle>
                        {item.exercise.muscle_group && (
                          <CardDescription>{item.exercise.muscle_group}</CardDescription>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Total sets logged</span>
                      <span className="font-semibold">{item.totalSets}</span>
                    </div>
                    {item.isUnilateral ? (
                      <>
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Best weight</span>
                          <div className="font-semibold text-right">
                            <div>
                              L: {item.maxWeightLeft !== null && item.maxWeightLeft !== undefined
                                ? (Number.isInteger(item.maxWeightLeft)
                                  ? item.maxWeightLeft
                                  : item.maxWeightLeft.toFixed(1))
                                : "-"} {preferredUnit}
                              {item.maxRepsLeft !== null && item.maxRepsLeft !== undefined
                                ? ` × ${Number.isInteger(item.maxRepsLeft) ? item.maxRepsLeft : item.maxRepsLeft.toFixed(1)}`
                                : ""}
                            </div>
                            <div>
                              R: {item.maxWeightRight !== null && item.maxWeightRight !== undefined
                                ? (Number.isInteger(item.maxWeightRight)
                                  ? item.maxWeightRight
                                  : item.maxWeightRight.toFixed(1))
                                : "-"} {preferredUnit}
                              {item.maxRepsRight !== null && item.maxRepsRight !== undefined
                                ? ` × ${Number.isInteger(item.maxRepsRight) ? item.maxRepsRight : item.maxRepsRight.toFixed(1)}`
                                : ""}
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">Best weight</span>
                        <span className="font-semibold">
                          {Number.isInteger(item.maxWeight)
                            ? item.maxWeight
                            : item.maxWeight.toFixed(1)} {preferredUnit}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Last logged</span>
                      <span className="font-semibold">{lastWorkoutLabel}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Show locked exercises for free users */}
            {!effectiveIsPremium && filteredProgress.length > 1 && (
              <div className="relative">
                <div className="absolute inset-0 z-10 flex items-center justify-center">
                  <FeatureLock
                    featureName="All Exercise Analytics"
                    onUpgrade={() => setShowPaywall(true)}
                  />
                </div>
                <div className="opacity-30 pointer-events-none blur-sm space-y-4">
                  {filteredProgress.slice(1, 3).map((item) => (
                    <Card key={`locked-${item.detailExerciseId}`} className="border-2">
                      <CardHeader>
                        <div className="flex items-start gap-3">
                          <ExerciseImage
                            exerciseId={item.exercise.id}
                            imageUrl={item.exercise.image_url || undefined}
                            exerciseName={item.exercise.name}
                            className="w-14 h-14 sm:w-16 sm:h-16"
                          />
                          <div className="flex-1 min-w-0">
                            <CardTitle className="text-xl">{item.exercise.name}</CardTitle>
                            {item.exercise.muscle_group && (
                              <CardDescription>{item.exercise.muscle_group}</CardDescription>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">Total sets logged</span>
                          <span className="font-semibold">{item.totalSets}</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            )}
            </>
          )}
        </div>
      </main>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} feature="All Exercise Analytics" />
    </div>
  );
};

export default Progress;
