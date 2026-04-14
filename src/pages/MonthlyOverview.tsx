import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSupabaseSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { convertWeight } from "@/lib/conversions";
import { endOfMonth, format, parseISO, startOfMonth, subMonths } from "date-fns";
import { ArrowLeft, BarChart3 } from "lucide-react";

type WeightUnit = "kg" | "lb";

interface WorkoutExerciseRecord {
  id: string;
  workout_id: string;
  sets: Array<{
    weight: number;
    reps: number;
    is_warmup: boolean;
    unit: WeightUnit | null;
  }> | null;
}

interface PostRecord {
  id: string;
  created_at: string;
  workout_id: string;
}

interface WorkoutRecord {
  id: string;
  started_at: string | null;
  ended_at: string | null;
}

interface MonthlyMetrics {
  monthKey: string;
  workoutCount: number;
  totalExercises: number;
  totalSets: number;
  totalReps: number;
  totalVolume: number;
  durationMinutes: number;
  durationSamples: number;
}

const MONTH_WINDOW = 12;

const MonthlyOverview = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<MonthlyMetrics[]>([]);
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>("kg");
  const [visibleMonthKeys, setVisibleMonthKeys] = useState<Set<string>>(new Set());

  const loadMetrics = useCallback(async () => {
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
      const unitPref = profileData?.unit_default === "lb" ? "lb" : "kg";
      setPreferredUnit(unitPref);

      const now = new Date();
      const earliest = startOfMonth(subMonths(now, MONTH_WINDOW - 1));
      const earliestISO = earliest.toISOString();

      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select("id, created_at, workout_id")
        .eq("user_id", user.id)
        .eq("show_workout_details", true)
        .gte("created_at", earliestISO)
        .order("created_at", { ascending: false });
      if (postsError) throw postsError;

      const shareablePosts: PostRecord[] = (postsData ?? []).reduce<PostRecord[]>(
        (acc, raw) => {
          if (
            raw &&
            typeof raw.workout_id === "string" &&
            raw.workout_id &&
            typeof raw.created_at === "string"
          ) {
            acc.push({
              id: raw.id,
              created_at: raw.created_at,
              workout_id: raw.workout_id,
            });
          }
          return acc;
        },
        []
      );

      if (shareablePosts.length === 0) {
        setMetrics([]);
        return;
      }

      const workoutIds = Array.from(
        new Set(shareablePosts.map((post) => post.workout_id))
      );

      if (workoutIds.length === 0) {
        setMetrics([]);
        return;
      }

      const { data: workoutsData, error: workoutsError } = await supabase
        .from("workouts")
        .select("id, started_at, ended_at")
        .in("id", workoutIds);
      if (workoutsError) throw workoutsError;

      const workoutById = new Map<string, WorkoutRecord>();
      (workoutsData ?? []).forEach((workout: any) => {
        workoutById.set(workout.id, {
          id: workout.id,
          started_at: workout.started_at ?? null,
          ended_at: workout.ended_at ?? null,
        });
      });

      const { data: workoutExercises, error: workoutExercisesError } =
        await supabase
          .from("workout_exercises")
          .select("id, workout_id, sets(weight, reps, is_warmup, unit)")
          .in("workout_id", workoutIds);
      if (workoutExercisesError) throw workoutExercisesError;

      const exerciseByWorkout = new Map<string, WorkoutExerciseRecord[]>();
      (workoutExercises ?? []).forEach((row: WorkoutExerciseRecord) => {
        const list = exerciseByWorkout.get(row.workout_id) ?? [];
        list.push(row);
        exerciseByWorkout.set(row.workout_id, list);
      });

      const monthlyMap = new Map<string, MonthlyMetrics>();
      const processedWorkouts = new Set<string>();

      shareablePosts.forEach((post) => {
        if (processedWorkouts.has(post.workout_id)) {
          return;
        }
        processedWorkouts.add(post.workout_id);

        const workout = workoutById.get(post.workout_id);
        const referenceDate =
          workout?.started_at ??
          workout?.ended_at ??
          post.created_at;
        const parsedRef = referenceDate ? parseISO(referenceDate) : null;
        if (!parsedRef || Number.isNaN(parsedRef.getTime())) {
          return;
        }

        if (parsedRef < earliest) {
          return;
        }

        const monthKey = format(startOfMonth(parsedRef), "yyyy-MM");
        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, {
            monthKey,
            workoutCount: 0,
            totalExercises: 0,
            totalSets: 0,
            totalReps: 0,
            totalVolume: 0,
            durationMinutes: 0,
            durationSamples: 0,
          });
        }

        const monthEntry = monthlyMap.get(monthKey)!;
        monthEntry.workoutCount += 1;

        const exercises = exerciseByWorkout.get(post.workout_id) ?? [];
        monthEntry.totalExercises += exercises.length;

        exercises.forEach((exercise) => {
          const sets = exercise.sets ?? [];
          sets.forEach((set) => {
            if (set.is_warmup) return;
            const rawWeight = typeof set.weight === "number" ? set.weight : Number(set.weight ?? 0);
            const rawReps = typeof set.reps === "number" ? set.reps : Number(set.reps ?? 0);
            if (!Number.isFinite(rawWeight) || !Number.isFinite(rawReps)) return;
            const setUnit: WeightUnit = set.unit === "lb" ? "lb" : "kg";
            const converted = convertWeight(rawWeight, setUnit, unitPref);
            monthEntry.totalSets += 1;
            monthEntry.totalReps += rawReps;
            monthEntry.totalVolume += converted * rawReps;
          });
        });

        if (workout?.started_at && workout?.ended_at) {
          const start = parseISO(workout.started_at);
          const end = parseISO(workout.ended_at);
          if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) {
            const duration = Math.floor((end.getTime() - start.getTime()) / 60000);
            if (Number.isFinite(duration) && duration > 0) {
              monthEntry.durationMinutes += duration;
              monthEntry.durationSamples += 1;
            }
          }
        }
      });

      const sortedMetrics = Array.from(monthlyMap.values()).sort((a, b) => (a.monthKey < b.monthKey ? 1 : -1));
      setMetrics(sortedMetrics);
    } catch (error) {
      console.error("Failed to load monthly overview", error);
      toast({
        title: "Error",
        description: "Unable to load monthly overview.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  useEffect(() => {
    const refresh = () => {
      void loadMetrics();
    };

    const handlePrUpdate = () => {
      void loadMetrics();
    };

    window.addEventListener("post:deleted:confirmed", refresh);
    window.addEventListener("post:delete:failed", refresh);
    window.addEventListener("pr:updated", handlePrUpdate);
    return () => {
      window.removeEventListener("post:deleted:confirmed", refresh);
      window.removeEventListener("post:delete:failed", refresh);
      window.removeEventListener("pr:updated", handlePrUpdate);
    };
  }, [loadMetrics]);

  const metricsWithDerivedValues = useMemo(() => {
    return metrics.map((entry) => {
      const monthStart = startOfMonth(parseISO(`${entry.monthKey}-01`));
      const label = format(monthStart, "MMMM yyyy");
      const averageDurationMinutes =
        entry.durationSamples > 0 ? entry.durationMinutes / entry.durationSamples : 0;
      const averageDurationDisplay =
        averageDurationMinutes > 0
          ? averageDurationMinutes >= 60
            ? `${Math.floor(averageDurationMinutes / 60)}h ${Math.round(averageDurationMinutes % 60)}m`
            : `${Math.round(averageDurationMinutes)}m`
          : "—";
      const volumeDisplay =
        entry.totalVolume > 0 ? `${Math.round(entry.totalVolume)} ${preferredUnit}` : "—";
      const averageSetsPerWorkout =
        entry.workoutCount > 0 ? (entry.totalSets / entry.workoutCount).toFixed(1) : "0";
      const averageRepsPerSet =
        entry.totalSets > 0 ? (entry.totalReps / entry.totalSets).toFixed(1) : "0";

      const rangeLabel = `${format(monthStart, "MMM d")} – ${format(endOfMonth(monthStart), "MMM d")}`;

      return {
        ...entry,
        label,
        rangeLabel,
        volumeDisplay,
        averageDurationDisplay,
        averageSetsPerWorkout,
        averageRepsPerSet,
      };
    });
  }, [metrics, preferredUnit]);

  useEffect(() => {
    if (metricsWithDerivedValues.length === 0) {
      setVisibleMonthKeys(new Set());
      return;
    }

    if (typeof window === "undefined") {
      setVisibleMonthKeys(new Set(metricsWithDerivedValues.map((metric) => metric.monthKey)));
      return;
    }

    setVisibleMonthKeys(new Set());
    const timers: number[] = [];

    metricsWithDerivedValues.forEach((metric, index) => {
      const timer = window.setTimeout(() => {
        setVisibleMonthKeys((prev) => {
          if (prev.has(metric.monthKey)) return prev;
          const next = new Set(prev);
          next.add(metric.monthKey);
          return next;
        });
      }, index * 160);
      timers.push(timer);
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [metricsWithDerivedValues]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <BarChart3 className="h-12 w-12 animate-pulse mx-auto mb-4 text-primary" />
          <p className="text-lg text-muted-foreground">Loading monthly overview...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-background overflow-y-auto"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px) + 1rem, 2.5rem)",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px) + 1.5rem, 1.5rem)",
      }}
    >
      <div className="container max-w-4xl mx-auto px-4 space-y-6">
        <div className="flex items-center gap-3 pt-2">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Monthly Overview</h1>
            <p className="text-sm text-muted-foreground">
              Key training metrics across the last {Math.min(MONTH_WINDOW, metricsWithDerivedValues.length)} months.
            </p>
          </div>
        </div>

        {metricsWithDerivedValues.length === 0 ? (
          <Card className="border-dashed bg-muted/30">
            <CardContent className="py-12 text-center">
              <BarChart3 className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h2 className="text-xl font-semibold mb-2">No workouts to analyze yet</h2>
              <p className="text-sm text-muted-foreground">
                Log a workout to start building your monthly training overview.
              </p>
            </CardContent>
          </Card>
        ) : (
          metricsWithDerivedValues.map((metric, index) => {
            const isVisible = visibleMonthKeys.has(metric.monthKey);
            const transitionDelay = `${Math.min(index * 0.08, 0.4)}s`;

            return (
              <Card
                key={metric.monthKey}
                className={`border shadow-sm transition-all duration-500 ${
                  isVisible ? "opacity-100 translate-y-0" : "pointer-events-none opacity-0 translate-y-6"
                }`}
                style={{ transitionDelay }}
              >
              <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg sm:text-xl">{metric.label}</CardTitle>
                  <CardDescription>{metric.rangeLabel}</CardDescription>
                </div>
                <div className="text-sm text-muted-foreground">
                  {metric.workoutCount} workout{metric.workoutCount !== 1 ? "s" : ""}
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Exercises Logged</p>
                  <p className="text-2xl font-semibold mt-2">{metric.totalExercises}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metric.workoutCount > 0
                      ? `${(metric.totalExercises / metric.workoutCount).toFixed(1)} per workout`
                      : "—"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Working Sets</p>
                  <p className="text-2xl font-semibold mt-2">{metric.totalSets}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Avg {metric.averageSetsPerWorkout} sets/workout
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Total Volume</p>
                  <p className="text-2xl font-semibold mt-2">{metric.volumeDisplay}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metric.totalSets > 0 ? `${metric.averageRepsPerSet} reps/set` : "—"}
                  </p>
                </div>
                <div className="rounded-xl border bg-muted/30 p-4">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Average Duration</p>
                  <p className="text-2xl font-semibold mt-2">{metric.averageDurationDisplay}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Logged for {metric.durationSamples} workout{metric.durationSamples === 1 ? "" : "s"}
                  </p>
                </div>
              </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default MonthlyOverview;
