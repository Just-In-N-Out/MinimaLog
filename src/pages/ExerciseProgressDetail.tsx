import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { ChevronLeft, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";

interface WorkoutData {
  date: string;
  maxWeight: number;
  maxReps: number;
  volume: number;
}

interface Exercise {
  id: string;
  name: string;
  equipment?: string;
  muscle_group?: string;
}

const ExerciseProgressDetail = () => {
  const { exerciseId } = useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [exercise, setExercise] = useState<Exercise | null>(null);
  const [chartData, setChartData] = useState<WorkoutData[]>([]);
  const [unit, setUnit] = useState<"kg" | "lb">("kg");

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth"); return; }
    loadExerciseData();
  }, [exerciseId, user, authLoading]);

  const loadExerciseData = async () => {
    if (!user) return;
    try {
      // Get exercise details
      const { data: exerciseData } = await supabase
        .from("exercises")
        .select("id, name, equipment, muscle_group")
        .eq("id", exerciseId)
        .single();

      if (exerciseData) {
        setExercise(exerciseData);
      }

      // Get user's default unit
      const { data: profile } = await supabase
        .from("profiles")
        .select("unit_default")
        .eq("id", user.id)
        .single();

      if (profile) {
        setUnit(profile.unit_default);
      }

      // Single RPC: server-side aggregation for chart data
      const { data: chartRows, error } = await supabase.rpc("get_exercise_chart_data", {
        p_user_id: user.id,
        p_exercise_id: exerciseId,
      });

      if (error) throw error;

      if (!chartRows || chartRows.length === 0) {
        setLoading(false);
        return;
      }

      // Deduplicate by formatted date (keep highest weight per day)
      const workoutMap = new Map<string, WorkoutData>();
      for (const row of chartRows) {
        const date = format(new Date(row.workout_date), "MMM dd");
        if (!workoutMap.has(date) || row.max_weight > workoutMap.get(date)!.maxWeight) {
          workoutMap.set(date, {
            date,
            maxWeight: Number(row.max_weight),
            maxReps: Number(row.max_reps),
            volume: Number(row.volume),
          });
        }
      }

      setChartData(Array.from(workoutMap.values()));
    } catch (error) {
      console.error("Error loading exercise data:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <TrendingUp className="h-8 w-8 animate-pulse" />
      </div>
    );
  }

  if (!exercise) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button
          variant="ghost"
          onClick={() => navigate("/progress")}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-muted-foreground">Exercise not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-4xl mx-auto p-4 space-y-6">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/progress")}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{exercise.name}</h1>
            <p className="text-sm text-muted-foreground">
              {exercise.equipment} • {exercise.muscle_group}
            </p>
          </div>
        </div>

        {chartData.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No workout data available for this exercise</p>
          </Card>
        ) : (
          <>
            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Max Weight Progress</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                    label={{ value: unit, angle: -90, position: "insideLeft" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="maxWeight"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))", r: 4 }}
                    name={`Max Weight (${unit})`}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Max Reps Progress</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="maxReps"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))", r: 4 }}
                    name="Max Reps"
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-6">
              <h2 className="text-lg font-semibold mb-4">Volume Progress</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis
                    dataKey="date"
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    tick={{ fill: "hsl(var(--muted-foreground))" }}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "var(--radius)",
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="volume"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={{ fill: "hsl(var(--primary))", r: 4 }}
                    name={`Total Volume (${unit})`}
                  />
                </LineChart>
              </ResponsiveContainer>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default ExerciseProgressDetail;
