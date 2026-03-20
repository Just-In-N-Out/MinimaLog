import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Dumbbell, Library } from "lucide-react";
import TemplatePicker from "@/components/TemplatePicker";

const StartWorkout = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  
  // Pre-session metrics (no bodyweight)
  const [sleep, setSleep] = useState("3");
  const [mood, setMood] = useState("3");
  const [preworkout, setPreworkout] = useState(false);

  const handleStartFromTemplate = async (template: any) => {
    if (!user) { navigate("/auth"); return; }
    setLoading(true);
    try {

      // Create workout
      const { data: workout, error: workoutError } = await supabase
        .from("workouts")
        .insert({
          user_id: user.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      // Save pre-session metrics if provided
      if (sleep || mood || preworkout) {
        const { error: metricsError } = await supabase
          .from("session_metrics")
          .insert({
            workout_id: workout.id,
            sleep: parseInt(sleep),
            mood: parseInt(mood),
            preworkout,
          });

        if (metricsError) throw metricsError;
      }

      // Load template exercises
      const { data: templateExercises } = await supabase
        .from("template_exercises")
        .select("exercise_id, order_index")
        .eq("template_id", template.id)
        .order("order_index");

      // Add exercises to workout in a single batch insert
      if (templateExercises && templateExercises.length > 0) {
        await supabase.from("workout_exercises").insert(
          templateExercises.map((te) => ({
            workout_id: workout.id,
            exercise_id: te.exercise_id,
            order_index: te.order_index,
          }))
        );
      }

      toast({
        title: "Workout started",
        description: `Using template: ${template.name}`,
      });

      navigate(`/workout/${workout.id}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start workout from template",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleStartWorkout = async () => {
    if (!user) { navigate("/auth"); return; }
    setLoading(true);
    try {
      // Create workout
      const { data: workout, error: workoutError } = await supabase
        .from("workouts")
        .insert({
          user_id: user.id,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (workoutError) throw workoutError;

      // Save pre-session metrics if provided
      if (sleep || mood || preworkout) {
        const { error: metricsError } = await supabase
          .from("session_metrics")
          .insert({
            workout_id: workout.id,
            sleep: parseInt(sleep),
            mood: parseInt(mood),
            preworkout,
          });

        if (metricsError) throw metricsError;
      }

      toast({
        title: "Workout started",
        description: "Let's get it!",
      });

      navigate(`/workout/${workout.id}`);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to start workout",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (showTemplatePicker) {
    return (
      <TemplatePicker
        onSelect={handleStartFromTemplate}
        onCancel={() => setShowTemplatePicker(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/")}
            className="h-10 w-10"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Start Workout</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-2xl">
        <Card className="border-2">
          <CardHeader>
            <div className="flex justify-center mb-4">
              <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
                <Dumbbell className="h-8 w-8 text-primary-foreground" />
              </div>
            </div>
            <CardTitle className="text-center text-2xl">Pre-Session Check</CardTitle>
            <CardDescription className="text-center text-base">
              How are you feeling today? (optional)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Sleep Quality */}
            <div className="space-y-3">
              <Label className="text-base">Sleep Quality (1-5)</Label>
              <RadioGroup value={sleep} onValueChange={setSleep} className="flex gap-2">
                {[1, 2, 3, 4, 5].map((val) => (
                  <div key={val} className="flex-1">
                    <RadioGroupItem
                      value={val.toString()}
                      id={`sleep-${val}`}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`sleep-${val}`}
                      className="flex h-12 items-center justify-center rounded-md border-2 border-muted bg-background hover:bg-muted cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary peer-data-[state=checked]:text-primary-foreground font-semibold text-lg"
                    >
                      {val}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Mood */}
            <div className="space-y-3">
              <Label className="text-base">Mood (1-5)</Label>
              <RadioGroup value={mood} onValueChange={setMood} className="flex gap-2">
                {[1, 2, 3, 4, 5].map((val) => (
                  <div key={val} className="flex-1">
                    <RadioGroupItem
                      value={val.toString()}
                      id={`mood-${val}`}
                      className="peer sr-only"
                    />
                    <Label
                      htmlFor={`mood-${val}`}
                      className="flex h-12 items-center justify-center rounded-md border-2 border-muted bg-background hover:bg-muted cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary peer-data-[state=checked]:text-primary-foreground font-semibold text-lg"
                    >
                      {val}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Pre-workout */}
            <div className="flex items-center space-x-3 py-2">
              <Checkbox
                id="preworkout"
                checked={preworkout}
                onCheckedChange={(checked) => setPreworkout(checked as boolean)}
                className="h-6 w-6"
              />
              <Label
                htmlFor="preworkout"
                className="text-base leading-relaxed cursor-pointer"
              >
                Took pre-workout supplement
              </Label>
            </div>

            {/* Action Buttons */}
            <div className="pt-4 space-y-3">
              <Button
                onClick={handleStartWorkout}
                className="w-full h-14 text-lg font-bold"
                disabled={loading}
              >
                {loading ? "Starting..." : "Start Empty Workout"}
              </Button>
              <Button
                onClick={() => setShowTemplatePicker(true)}
                variant="outline"
                className="w-full h-12 text-base"
                disabled={loading}
              >
                <Library className="h-5 w-5 mr-2" />
                Start from Template
              </Button>
              <Button
                variant="outline"
                onClick={() => navigate("/")}
                className="w-full h-12 text-base"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default StartWorkout;
