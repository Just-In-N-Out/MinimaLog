import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Plus, Check, Trash2, RefreshCw, Trophy, Save, X } from "lucide-react";
import ExercisePicker from "@/components/ExercisePicker";
import { convertWeight } from "@/lib/conversions";
import { checkForPR, savePR } from "@/lib/prDetection";
import CreatePostDialog from "@/components/CreatePostDialog";
import { WorkoutTimer } from "@/components/WorkoutTimer";
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

interface Exercise {
  id: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
}

interface WorkoutExercise {
  id: string;
  exercise_id: string;
  order_index: number;
  exercise: Exercise;
  sets: Set[];
  lastSessionWeight?: string;
}

interface Set {
  id?: string;
  set_no: number;
  weight: string;
  reps: string;
  rpe: string;
  rir: string;
  is_warmup: boolean;
  notes: string;
}

const WorkoutSession = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [workoutExercises, setWorkoutExercises] = useState<WorkoutExercise[]>([]);
  const [currentUnit, setCurrentUnit] = useState<"kg" | "lb">("kg");
  const [showCreatePost, setShowCreatePost] = useState(false);
  const [workoutStartedAt, setWorkoutStartedAt] = useState<string>("");
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const debounceTimers = useRef<Map<string, NodeJS.Timeout>>(new Map());

  useEffect(() => {
    loadWorkout();
    loadUserPreferences();
  }, [id]);

  // Flush pending debounced DB writes on unmount
  useEffect(() => {
    return () => {
      for (const timer of debounceTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  const loadUserPreferences = async () => {
    if (!user) return;
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("unit_default")
        .eq("id", user.id)
        .single();

      if (profile) {
        setCurrentUnit(profile.unit_default);
      }
    } catch (error) {
      console.error("Failed to load user preferences:", error);
    }
  };

  const loadWorkout = async () => {
    if (!user) return;
    try {

      // Query 1: Load exercises with their sets in a single joined query
      const { data: workoutExs, error } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          exercise_id,
          order_index,
          exercise:exercises (
            id,
            name,
            equipment,
            muscle_group
          ),
          sets (
            id,
            set_no,
            weight,
            reps,
            rpe,
            rir,
            is_warmup,
            notes,
            unit
          )
        `)
        .eq("workout_id", id)
        .order("order_index");

      if (error) throw error;

      // Query 2: Get current workout date
      const { data: currentWorkout } = await supabase
        .from("workouts")
        .select("started_at, user_id")
        .eq("id", id)
        .single();

      if (currentWorkout) {
        setWorkoutStartedAt(currentWorkout.started_at);
      }

      // Query 3: Batch-fetch previous workout data for all exercises at once
      const exerciseIds = (workoutExs || []).map((we: any) => we.exercise_id);
      const prevDataByExercise = new Map<string, string>();

      if (currentWorkout && exerciseIds.length > 0) {
        const { data: allPrevWorkoutExs } = await supabase
          .from("workout_exercises")
          .select(`
            id,
            exercise_id,
            workouts!inner (started_at),
            sets (set_no, weight, reps, is_warmup)
          `)
          .in("exercise_id", exerciseIds)
          .neq("workout_id", id)
          .lt("workouts.started_at", currentWorkout.started_at);

        if (allPrevWorkoutExs) {
          // Group by exercise_id and pick the most recent workout for each
          const exerciseGroups = new Map<string, any[]>();
          for (const pwe of allPrevWorkoutExs) {
            const group = exerciseGroups.get(pwe.exercise_id) || [];
            group.push(pwe);
            exerciseGroups.set(pwe.exercise_id, group);
          }

          for (const [exerciseId, group] of exerciseGroups) {
            // Sort by workout started_at descending, pick most recent
            group.sort((a: any, b: any) =>
              new Date(b.workouts.started_at).getTime() - new Date(a.workouts.started_at).getTime()
            );
            const mostRecent = group[0];
            const workingSets = (mostRecent.sets || [])
              .filter((s: any) => !s.is_warmup)
              .sort((a: any, b: any) => a.set_no - b.set_no);

            if (workingSets.length > 0) {
              prevDataByExercise.set(
                exerciseId,
                workingSets.map((s: any) => `${s.set_no}: ${s.weight}x ${s.reps}`).join(" • ")
              );
            }
          }
        }
      }

      // Combine exercises with their sets and last session data
      const exercisesWithSets = (workoutExs || []).map((we: any) => {
        const sortedSets = (we.sets || []).sort((a: any, b: any) => a.set_no - b.set_no);
        const formattedSets = sortedSets.map((s: any) => ({
          id: s.id,
          set_no: s.set_no,
          weight: s.weight?.toString() || "",
          reps: s.reps?.toString() || "",
          rpe: s.rpe?.toString() || "",
          rir: s.rir?.toString() || "",
          is_warmup: s.is_warmup,
          notes: s.notes || "",
        }));

        return {
          ...we,
          exercise: we.exercise,
          sets: formattedSets,
          lastSessionWeight: prevDataByExercise.get(we.exercise_id),
        };
      });

      setWorkoutExercises(exercisesWithSets);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load workout",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAddExercise = async (exercise: Exercise) => {
    try {
      // Query 1: Insert the exercise
      const { data: workoutEx, error } = await supabase
        .from("workout_exercises")
        .insert({
          workout_id: id,
          exercise_id: exercise.id,
          order_index: workoutExercises.length,
        })
        .select()
        .single();

      if (error) throw error;

      // Query 2: Get previous session data in one joined query (use cached workoutStartedAt)
      let lastSessionWeight: string | undefined = undefined;
      if (workoutStartedAt) {
        const { data: prevData } = await supabase
          .from("workout_exercises")
          .select(`
            id,
            workouts!inner(started_at),
            sets (set_no, weight, reps, is_warmup)
          `)
          .eq("exercise_id", exercise.id)
          .neq("workout_id", id)
          .lt("workouts.started_at", workoutStartedAt)
          .order("started_at", { ascending: false, foreignTable: "workouts" })
          .limit(1);

        if (prevData && prevData.length > 0) {
          const workingSets = (prevData[0].sets || [])
            .filter((s: any) => !s.is_warmup)
            .sort((a: any, b: any) => a.set_no - b.set_no);

          if (workingSets.length > 0) {
            lastSessionWeight = workingSets
              .map((s: any) => `${s.set_no}: ${s.weight}x ${s.reps}`)
              .join(" • ");
          }
        }
      }

      setWorkoutExercises([
        ...workoutExercises,
        {
          ...workoutEx,
          exercise,
          sets: [],
          lastSessionWeight,
        },
      ]);

      toast({
        title: "Exercise added",
        description: exercise.name,
      });

      setShowExercisePicker(false);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to add exercise",
        variant: "destructive",
      });
    }
  };

  const handleDeleteExercise = async (workoutExerciseId: string) => {
    try {
      const { error } = await supabase
        .from("workout_exercises")
        .delete()
        .eq("id", workoutExerciseId);

      if (error) throw error;

      setWorkoutExercises(workoutExercises.filter((we) => we.id !== workoutExerciseId));

      toast({
        title: "Exercise removed",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to delete exercise",
        variant: "destructive",
      });
    }
  };

  const handleAddSet = async (workoutExerciseId: string) => {
    const exercise = workoutExercises.find((we) => we.id === workoutExerciseId);
    if (!exercise) return;

    const lastSet = exercise.sets[exercise.sets.length - 1];
    const newSet: Set = {
      set_no: exercise.sets.length + 1,
      weight: lastSet?.weight || "",
      reps: lastSet?.reps || "",
      rpe: lastSet?.rpe || "",
      rir: lastSet?.rir || "",
      is_warmup: false,
      notes: "",
    };

    try {
      const { data, error } = await supabase
        .from("sets")
        .insert({
          workout_exercise_id: workoutExerciseId,
          set_no: newSet.set_no,
          weight: parseFloat(newSet.weight) || 0,
          unit: currentUnit,
          reps: parseInt(newSet.reps) || 0,
          rpe: newSet.rpe ? parseFloat(newSet.rpe) : null,
          rir: newSet.rir ? parseInt(newSet.rir) : null,
          is_warmup: newSet.is_warmup,
          notes: newSet.notes,
        })
        .select()
        .single();

      if (error) throw error;

      // Convert database values to strings for form inputs
      const formattedSet: Set = {
        id: data.id,
        set_no: data.set_no,
        weight: data.weight?.toString() || "",
        reps: data.reps?.toString() || "",
        rpe: data.rpe?.toString() || "",
        rir: data.rir?.toString() || "",
        is_warmup: data.is_warmup,
        notes: data.notes || "",
      };

      setWorkoutExercises(
        workoutExercises.map((we) =>
          we.id === workoutExerciseId
            ? { ...we, sets: [...we.sets, formattedSet] }
            : we
        )
      );

      // Check for 1RM PR only after adding set
      if (data.weight && data.reps && !data.is_warmup) {
        try {
          const prResult = await checkForPR(user!.id, exercise.exercise.id, {
            weight: data.weight,
            reps: data.reps,
            unit: currentUnit,
            is_warmup: false,
          });

          // Only notify for 1RM PRs, not rep PRs
          if (prResult.is1RMPR) {
            await savePR(user!.id, exercise.exercise.id, {
              weight: data.weight,
              reps: data.reps,
              unit: currentUnit,
              is_warmup: false,
            });

            toast({
              title: "🎉 NEW 1RM PR!",
              description: `${exercise.exercise.name}: Est. 1RM ${prResult.new1RM.toFixed(1)}${currentUnit}`,
            });
          }
        } catch (error) {
          console.error("PR detection error:", error);
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to add set",
        variant: "destructive",
      });
    }
  };

  const handleDeleteSet = async (workoutExerciseId: string, setId: string) => {
    try {
      const { error } = await supabase
        .from("sets")
        .delete()
        .eq("id", setId);

      if (error) throw error;

      setWorkoutExercises(
        workoutExercises.map((we) =>
          we.id === workoutExerciseId
            ? { ...we, sets: we.sets.filter((s) => s.id !== setId) }
            : we
        )
      );

      toast({
        title: "Set deleted",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to delete set",
        variant: "destructive",
      });
    }
  };

  const handleUpdateSet = async (
    workoutExerciseId: string,
    setId: string,
    field: keyof Set,
    value: any
  ) => {
    // Normalize numeric values to remove leading zeros
    let normalizedValue = value;
    if (field === "weight" && value) {
      const parsed = parseFloat(value);
      normalizedValue = isNaN(parsed) ? value : parsed.toString();
    } else if (field === "reps" && value) {
      const parsed = parseInt(value);
      normalizedValue = isNaN(parsed) ? value : parsed.toString();
    } else if (field === "rpe" && value) {
      const parsed = parseFloat(value);
      normalizedValue = isNaN(parsed) ? value : parsed.toString();
    } else if (field === "rir" && value) {
      const parsed = parseInt(value);
      normalizedValue = isNaN(parsed) ? value : parsed.toString();
    }

    // Update local state immediately for responsive UI
    setWorkoutExercises(
      workoutExercises.map((we) =>
        we.id === workoutExerciseId
          ? {
              ...we,
              sets: we.sets.map((s) =>
                s.id === setId ? { ...s, [field]: normalizedValue } : s
              ),
            }
          : we
      )
    );

    // Debounce the database write (500ms)
    const timerKey = `${setId}-${field}`;
    const existing = debounceTimers.current.get(timerKey);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(async () => {
      debounceTimers.current.delete(timerKey);

      const updates: any = { [field]: normalizedValue };
      if (field === "weight" && normalizedValue) {
        updates.weight = parseFloat(normalizedValue);
      } else if (field === "reps" && normalizedValue) {
        updates.reps = parseInt(normalizedValue);
      } else if (field === "rpe" && normalizedValue) {
        updates.rpe = parseFloat(normalizedValue);
      } else if (field === "rir" && normalizedValue) {
        updates.rir = parseInt(normalizedValue);
      }

      try {
        const { error } = await supabase
          .from("sets")
          .update(updates)
          .eq("id", setId);

        if (error) throw error;
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to update set",
          variant: "destructive",
        });
      }
    }, 500);

    debounceTimers.current.set(timerKey, timer);
  };

  const handleConvertWeight = async (workoutExerciseId: string, setId: string, currentWeight: string) => {
    if (!currentWeight || isNaN(parseFloat(currentWeight))) return;

    const weight = parseFloat(currentWeight);
    const newUnit = currentUnit === "kg" ? "lb" : "kg";
    const converted = convertWeight(weight, currentUnit, newUnit);

    try {
      const { error } = await supabase
        .from("sets")
        .update({ 
          weight: converted,
          unit: newUnit
        })
        .eq("id", setId);

      if (error) throw error;

      setWorkoutExercises(
        workoutExercises.map((we) =>
          we.id === workoutExerciseId
            ? {
                ...we,
                sets: we.sets.map((s) =>
                  s.id === setId ? { ...s, weight: converted.toFixed(1) } : s
                ),
              }
            : we
        )
      );

      toast({
        title: "Weight converted",
        description: `${weight}${currentUnit} → ${converted.toFixed(1)}${newUnit}`,
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to convert weight",
        variant: "destructive",
      });
    }
  };

  const handleSaveAsTemplate = async () => {
    if (!templateName.trim()) {
      toast({
        title: "Template name required",
        description: "Please enter a name for your template",
        variant: "destructive",
      });
      return;
    }

    if (workoutExercises.length === 0) {
      toast({
        title: "No exercises",
        description: "Add exercises before saving as template",
        variant: "destructive",
      });
      return;
    }

    if (!user) return;
    try {
      // Create template
      const { data: template, error: templateError } = await supabase
        .from("workout_templates")
        .insert({
          user_id: user.id,
          name: templateName,
        })
        .select()
        .single();

      if (templateError) throw templateError;

      // Add exercises to template in a single batch insert
      await supabase.from("template_exercises").insert(
        workoutExercises.map((we) => ({
          template_id: template.id,
          exercise_id: we.exercise_id,
          order_index: we.order_index,
        }))
      );

      toast({
        title: "Template saved",
        description: `"${templateName}" saved successfully`,
      });

      setShowSaveTemplate(false);
      setTemplateName("");
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to save template",
        variant: "destructive",
      });
    }
  };

  const handleCompleteWorkout = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from("workouts")
        .update({ ended_at: new Date().toISOString() })
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Workout complete!",
        description: "Great job crushing it",
      });

      setShowCreatePost(true);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to complete workout",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTerminateWorkout = async () => {
    try {
      const exerciseIds = workoutExercises.map(w => w.id);

      // Batch delete all sets, exercises, metrics, and workout
      if (exerciseIds.length > 0) {
        await supabase.from("sets").delete().in("workout_exercise_id", exerciseIds);
      }
      await supabase.from("workout_exercises").delete().eq("workout_id", id);
      await supabase.from("session_metrics").delete().eq("workout_id", id);

      const { error } = await supabase
        .from("workouts")
        .delete()
        .eq("id", id);

      if (error) throw error;

      toast({
        title: "Workout cancelled",
        description: "Workout has been terminated",
      });

      navigate("/");
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to terminate workout",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-lg text-muted-foreground">Loading workout...</p>
      </div>
    );
  }

  if (showExercisePicker) {
    return (
      <ExercisePicker
        onSelect={handleAddExercise}
        onCancel={() => setShowExercisePicker(false)}
      />
    );
  }

  if (showSaveTemplate) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="border-2 w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Save as Template</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="templateName" className="text-base">Template Name</Label>
              <Input
                id="templateName"
                type="text"
                value={templateName}
                onChange={(e) => setTemplateName(e.target.value)}
                placeholder="e.g. Push Day"
                className="h-12 text-base mt-2"
              />
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleSaveAsTemplate}
                className="flex-1 h-12"
              >
                Save Template
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setShowSaveTemplate(false);
                  setTemplateName("");
                }}
                className="flex-1 h-12"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => navigate("/")}
                className="h-10 w-10"
                aria-label="Go back"
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <h1 className="text-2xl font-bold">Training</h1>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => setShowTerminateDialog(true)}
                variant="ghost"
                className="h-10"
              >
                <X className="h-5 w-5 mr-2" />
                Cancel
              </Button>
              <Button
                onClick={() => setShowSaveTemplate(true)}
                disabled={workoutExercises.length === 0}
                variant="outline"
                className="h-10"
              >
                <Save className="h-5 w-5 mr-2" />
                Save Template
              </Button>
              <Button
                onClick={handleCompleteWorkout}
                disabled={saving || workoutExercises.length === 0}
                className="h-10"
              >
                <Check className="h-5 w-5 mr-2" />
                Finish
              </Button>
            </div>
          </div>
          {workoutStartedAt && (
            <div className="flex justify-center">
              <WorkoutTimer startedAt={workoutStartedAt} />
            </div>
          )}
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        {/* Unit Toggle */}
        <div className="flex justify-end">
          <div className="flex gap-1 bg-muted rounded-md p-1">
            <Button
              variant={currentUnit === "kg" ? "default" : "ghost"}
              size="sm"
              onClick={() => setCurrentUnit("kg")}
              className="h-10 min-w-[60px]"
            >
              kg
            </Button>
            <Button
              variant={currentUnit === "lb" ? "default" : "ghost"}
              size="sm"
              onClick={() => setCurrentUnit("lb")}
              className="h-10 min-w-[60px]"
            >
              lb
            </Button>
          </div>
        </div>

        {/* Exercises */}
        {workoutExercises.map((we) => (
          <Card key={we.id} className="border-2">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <CardTitle className="text-xl">
                      {we.exercise.name}
                      {we.lastSessionWeight ? ` - ${we.lastSessionWeight}` : ""}
                    </CardTitle>
                  </div>
                  {we.exercise.equipment && (
                    <p className="text-sm text-muted-foreground">
                      {we.exercise.equipment} • {we.exercise.muscle_group}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDeleteExercise(we.id)}
                  className="h-10 w-10 text-destructive"
                  aria-label="Delete exercise"
                >
                  <Trash2 className="h-5 w-5" />
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Set headers */}
              <div className="grid grid-cols-12 gap-2 text-xs font-semibold text-muted-foreground px-2">
                <div className="col-span-1">SET</div>
                <div className="col-span-2">WEIGHT</div>
                <div className="col-span-2">REPS</div>
                <div className="col-span-2">RPE</div>
                <div className="col-span-2">RIR</div>
                <div className="col-span-1">WARMUP</div>
                <div className="col-span-2"></div>
              </div>

              {/* Sets */}
              {we.sets.map((set) => (
                <div key={set.id} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-1 text-center font-bold text-sm">
                    {set.set_no}
                  </div>
                  <Input
                    type="number"
                    step="0.5"
                    value={set.weight}
                    onChange={(e) =>
                      handleUpdateSet(we.id, set.id!, "weight", e.target.value)
                    }
                    className="col-span-2 h-11 text-sm"
                    placeholder="-"
                  />
                  <Input
                    type="number"
                    value={set.reps}
                    onChange={(e) =>
                      handleUpdateSet(we.id, set.id!, "reps", e.target.value)
                    }
                    className="col-span-2 h-11 text-sm"
                    placeholder="-"
                  />
                  <Input
                    type="number"
                    step="0.5"
                    min="1"
                    max="10"
                    value={set.rpe}
                    onChange={(e) =>
                      handleUpdateSet(we.id, set.id!, "rpe", e.target.value)
                    }
                    className="col-span-2 h-11 text-sm"
                    placeholder="-"
                  />
                  <Input
                    type="number"
                    min="0"
                    max="5"
                    value={set.rir}
                    onChange={(e) =>
                      handleUpdateSet(we.id, set.id!, "rir", e.target.value)
                    }
                    className="col-span-2 h-11 text-sm"
                    placeholder="-"
                  />
                  <div className="col-span-1 flex justify-center">
                    <Checkbox
                      checked={set.is_warmup}
                      onCheckedChange={(checked) =>
                        handleUpdateSet(we.id, set.id!, "is_warmup", checked)
                      }
                      className="h-6 w-6"
                    />
                  </div>
                  <div className="col-span-2 flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleConvertWeight(we.id, set.id!, set.weight)}
                      className="h-9 w-9"
                      aria-label="Convert weight"
                      title="Convert kg/lb"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteSet(we.id, set.id!)}
                      className="h-9 w-9 text-destructive"
                      aria-label="Delete set"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {/* Add Set Button */}
              <Button
                variant="outline"
                onClick={() => handleAddSet(we.id)}
                className="w-full h-12 mt-2"
              >
                <Plus className="h-5 w-5 mr-2" />
                Add Set
              </Button>
            </CardContent>
          </Card>
        ))}

        {/* Add Exercise Button */}
        <Button
          onClick={() => setShowExercisePicker(true)}
          className="w-full h-14 text-lg font-bold"
        >
          <Plus className="h-6 w-6 mr-2" />
          Add Exercise
        </Button>
      </main>

      <CreatePostDialog
        open={showCreatePost}
        onOpenChange={setShowCreatePost}
        workoutId={id!}
        onSuccess={() => navigate("/")}
      />

      <AlertDialog open={showTerminateDialog} onOpenChange={setShowTerminateDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workout and all its data. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Workout</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTerminateWorkout}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Workout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default WorkoutSession;
