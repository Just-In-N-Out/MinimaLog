import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Dumbbell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface Exercise {
  id: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  body_part: string | null;
  is_bodyweight: boolean;
}

interface ExercisePickerProps {
  onSelect: (exercise: Exercise) => void;
  onCancel: () => void;
}

const ExercisePicker = ({ onSelect, onCancel }: ExercisePickerProps) => {
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [filteredExercises, setFilteredExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [customExercise, setCustomExercise] = useState({
    name: "",
    equipment: "",
    muscle_group: "",
    body_part: "",
    is_bodyweight: false,
  });
  const { toast } = useToast();
  const { user } = useAuth();

  useEffect(() => {
    loadExercises();
  }, []);

  useEffect(() => {
    if (search.trim()) {
      const filtered = exercises.filter((ex) =>
        ex.name.toLowerCase().includes(search.toLowerCase()) ||
        ex.muscle_group?.toLowerCase().includes(search.toLowerCase()) ||
        ex.equipment?.toLowerCase().includes(search.toLowerCase())
      );
      setFilteredExercises(filtered);
    } else {
      setFilteredExercises(exercises);
    }
  }, [search, exercises]);

  const loadExercises = async () => {
    try {
      const { data, error } = await supabase
        .from("exercises")
        .select("id, name, equipment, muscle_group, is_custom, owner_user_id")
        .order("name");

      if (error) throw error;
      setExercises(data || []);
      setFilteredExercises(data || []);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load exercises",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const createCustomExercise = async () => {
    if (!customExercise.name.trim()) {
      toast({
        title: "Error",
        description: "Exercise name is required",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("exercises")
        .insert({
          name: customExercise.name.trim(),
          equipment: customExercise.equipment.trim() || null,
          muscle_group: customExercise.muscle_group.trim() || null,
          body_part: customExercise.body_part.trim() || null,
          is_bodyweight: customExercise.is_bodyweight,
          owner_user_id: user.id,
        })
        .select()
        .single();

      if (error) throw error;

      toast({
        title: "Custom exercise created",
        description: `${customExercise.name} added to your library`,
      });

      // Reset form and add to exercises list
      setCustomExercise({
        name: "",
        equipment: "",
        muscle_group: "",
        body_part: "",
        is_bodyweight: false,
      });
      setShowCreateForm(false);
      
      // Add to local state immediately
      setExercises([...exercises, data]);
      
      // Select the newly created exercise
      onSelect(data);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create exercise",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const groupedExercises = filteredExercises.reduce((acc, exercise) => {
    const group = exercise.body_part || "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(exercise);
    return acc;
  }, {} as Record<string, Exercise[]>);

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      {/* Header */}
      <div className="border-b p-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {showCreateForm ? "Create Custom Exercise" : "Add Exercise"}
          </h2>
          <Button 
            variant="ghost" 
            onClick={() => {
              if (showCreateForm) {
                setShowCreateForm(false);
                setCustomExercise({
                  name: "",
                  equipment: "",
                  muscle_group: "",
                  body_part: "",
                  is_bodyweight: false,
                });
              } else {
                onCancel();
              }
            }} 
            className="h-10"
          >
            {showCreateForm ? "Back" : "Cancel"}
          </Button>
        </div>
        {!showCreateForm && (
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
        )}
      </div>

      {/* Custom Exercise Form */}
      {showCreateForm ? (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6 max-w-2xl mx-auto">
            <Card className="border-2">
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="exercise-name">Exercise Name *</Label>
                  <Input
                    id="exercise-name"
                    type="text"
                    placeholder="e.g., Overhead Press"
                    value={customExercise.name}
                    onChange={(e) =>
                      setCustomExercise({ ...customExercise, name: e.target.value })
                    }
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="equipment">Equipment</Label>
                  <Select
                    value={customExercise.equipment}
                    onValueChange={(value) =>
                      setCustomExercise({ ...customExercise, equipment: value })
                    }
                  >
                    <SelectTrigger id="equipment" className="h-12">
                      <SelectValue placeholder="Select equipment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="barbell">Barbell</SelectItem>
                      <SelectItem value="dumbbell">Dumbbell</SelectItem>
                      <SelectItem value="cable">Cable</SelectItem>
                      <SelectItem value="machine">Machine</SelectItem>
                      <SelectItem value="bodyweight">Bodyweight</SelectItem>
                      <SelectItem value="bands">Bands</SelectItem>
                      <SelectItem value="kettlebell">Kettlebell</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="muscle-group">Muscle Group</Label>
                  <Select
                    value={customExercise.muscle_group}
                    onValueChange={(value) =>
                      setCustomExercise({ ...customExercise, muscle_group: value })
                    }
                  >
                    <SelectTrigger id="muscle-group" className="h-12">
                      <SelectValue placeholder="Select muscle group" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chest">Chest</SelectItem>
                      <SelectItem value="back">Back</SelectItem>
                      <SelectItem value="shoulders">Shoulders</SelectItem>
                      <SelectItem value="arms">Arms</SelectItem>
                      <SelectItem value="legs">Legs</SelectItem>
                      <SelectItem value="core">Core</SelectItem>
                      <SelectItem value="cardio">Cardio</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="body-part">Body Part</Label>
                  <Select
                    value={customExercise.body_part}
                    onValueChange={(value) =>
                      setCustomExercise({ ...customExercise, body_part: value })
                    }
                  >
                    <SelectTrigger id="body-part" className="h-12">
                      <SelectValue placeholder="Select body part" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upper body">Upper Body</SelectItem>
                      <SelectItem value="lower body">Lower Body</SelectItem>
                      <SelectItem value="full body">Full Body</SelectItem>
                      <SelectItem value="core">Core</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <Button
                  onClick={createCustomExercise}
                  disabled={creating || !customExercise.name.trim()}
                  className="w-full h-12"
                >
                  {creating ? "Creating..." : "Create Exercise"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      ) : (
        <>
          {/* Exercise List */}
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              {/* Create Custom Exercise Card - Always show at top */}
              <Card
                className="border-2 border-primary cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setShowCreateForm(true)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                      <Dumbbell className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-base">Create Custom Exercise</h4>
                      <p className="text-sm text-muted-foreground">
                        Can't find what you're looking for? Add your own
                      </p>
                    </div>
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              {loading ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading exercises...
                </div>
              ) : filteredExercises.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-lg">No exercises found</p>
                  <p className="text-sm mt-2">Try a different search term or create a custom exercise</p>
                </div>
              ) : (
                Object.entries(groupedExercises).map(([group, exercises]) => (
                  <div key={group}>
                    <h3 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
                      {group}
                    </h3>
                    <div className="space-y-2">
                      {exercises.map((exercise) => (
                        <Card
                          key={exercise.id}
                          className="border-2 cursor-pointer hover:bg-muted/50 transition-colors"
                          onClick={() => onSelect(exercise)}
                        >
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <h4 className="font-semibold text-base">
                                  {exercise.name}
                                </h4>
                                <div className="flex gap-2 mt-1 text-sm text-muted-foreground">
                                  {exercise.equipment && (
                                    <span>{exercise.equipment}</span>
                                  )}
                                  {exercise.muscle_group && (
                                    <span>• {exercise.muscle_group}</span>
                                  )}
                                </div>
                              </div>
                              <Plus className="h-6 w-6 text-muted-foreground" />
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </>
      )}
    </div>
  );
};

export default ExercisePicker;
