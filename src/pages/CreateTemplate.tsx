import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Save, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Paywall } from "@/components/Paywall";
import ExercisePicker from "@/components/ExercisePicker";
import DraggableExerciseList from "@/components/DraggableExerciseList";
import type { Exercise } from "@/pages/WorkoutSession/types";
import { nameSupportsUnilateralToggle } from "@/data/gymExercises";

interface TemplateExercise {
  id: string;
  exerciseId: string;
  name: string;
  isUnilateral?: boolean;
  exercise?: Exercise;
}

const CreateTemplate = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canCreateTemplate } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);
  const [name, setName] = useState("");
  const [exercises, setExercises] = useState<TemplateExercise[]>([]);
  const [saving, setSaving] = useState(false);
  const [showExercisePicker, setShowExercisePicker] = useState(false);

  const handleExerciseSelect = (exercise: any) => {
    const exerciseId = exercise.supabaseId ?? exercise.id;
    if (!exerciseId) return;
    setExercises((prev) => {
      if (prev.some((item) => item.exerciseId === exerciseId)) {
        toast({
          title: "Already added",
          description: `${exercise.name} is already in this template.`,
        });
        return prev;
      }

      // Correctly determine if exercise supports unilateral based on all sources
      const supportsUnilateral = exercise.supportsUnilateral ||
                                Boolean(exercise.is_unilateral) ||
                                nameSupportsUnilateralToggle(exercise.name);

      return [
        ...prev,
        {
          id: `${exerciseId}-${Date.now()}`,
          exerciseId,
          name: exercise.name,
          isUnilateral: false,
          exercise: {
            ...(exercise as Exercise),
            supportsUnilateral,
            is_unilateral: exercise.is_unilateral || false,
          },
        },
      ];
    });
  };

  const handleSaveTemplate = async () => {
    // Check template limit for free users
    if (!canCreateTemplate) {
      setShowPaywall(true);
      return;
    }

    if (!name.trim()) {
      toast({
        title: "Template name required",
        description: "Please give your template a name",
        variant: "destructive",
      });
      return;
    }

    if (exercises.length === 0) {
      toast({
        title: "Add exercises",
        description: "Add at least one exercise to the template",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        toast({
          title: "Authentication required",
          description: "Please sign in to create a template",
          variant: "destructive",
        });
        navigate("/auth");
        return;
      }

      const { data: template, error: templateError } = await supabase
        .from("workout_templates")
        .insert({ user_id: user.id, name })
        .select()
        .single();

      if (templateError || !template) throw templateError;

      if (exercises.length > 0) {
        const payload = exercises.map((exercise, index) => ({
          template_id: template.id,
          exercise_id: exercise.exerciseId,
          order_index: index,
          is_unilateral: exercise.isUnilateral ?? false,
        }));
        const { error: exerciseError } = await supabase
          .from("template_exercises")
          .insert(payload);
        if (exerciseError) throw exerciseError;
      }

      toast({
        title: "Template created",
        description: `Saved “${name}” successfully`,
      });
      navigate("/start-workout");
    } catch (error: any) {
      console.error("Failed to create template", error);
      toast({
        title: "Error",
        description: "Unable to save template",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  if (showExercisePicker) {
    return (
      <ExercisePicker
        onSelect={(exercise) => {
          handleExerciseSelect(exercise);
          setShowExercisePicker(false);
        }}
        onCancel={() => setShowExercisePicker(false)}
      />
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header
        className="border-b bg-background safe-area-top"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px) + 1rem, 3rem)" }}
      >
        <div className="container mx-auto px-4 pt-4 pb-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Create Template</h1>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto pb-[calc(env(safe-area-inset-bottom, 0px)+2rem)]">
        <div className="container mx-auto px-4 py-6 max-w-3xl space-y-6">
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-2xl">Template Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label htmlFor="template-name" className="text-sm font-semibold">
                  Template name
                </Label>
                <Input
                  id="template-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Push Day, Full Body"
                  className="mt-2 h-12 text-base"
                />
              </div>

              <div className="space-y-3">
                <Label className="text-sm font-semibold">Exercises</Label>
                <Button
                  type="button"
                  variant="outline"
                  className="h-12 w-full sm:w-auto"
                  onClick={() => setShowExercisePicker(true)}
                >
                  <Plus className="h-5 w-5 mr-2" />
                  Add Exercise
                </Button>

                {exercises.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Choose exercises from the library or create your own. You can adjust order later.
                  </p>
                ) : (
                  <DraggableExerciseList
                    items={exercises}
                    onReorder={(next) => setExercises(next)}
                    onRemove={(id) =>
                      setExercises((prev) => prev.filter((exercise) => exercise.id !== id))
                    }
                    onToggleUnilateral={(id, isUnilateral) =>
                      setExercises((prev) =>
                        prev.map((exercise) =>
                          exercise.id === id ? { ...exercise, isUnilateral } : exercise
                        )
                      )
                    }
                  />
                )}
              </div>

              <Button
                onClick={handleSaveTemplate}
                className="w-full h-12 text-base"
                disabled={saving}
              >
                <Save className="h-5 w-5 mr-2" />
                {saving ? "Saving..." : "Save Template"}
              </Button>
            </CardContent>
          </Card>
        </div>
      </main>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} feature="Unlimited Templates" />
    </div>
  );
};

export default CreateTemplate;
