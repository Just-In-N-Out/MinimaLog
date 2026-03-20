import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useWorkoutDetail } from "@/hooks/queries/useWorkoutDetail";
import { ArrowLeft, Dumbbell, Trophy } from "lucide-react";
import { format } from "date-fns";

const WorkoutDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, isLoading: loading, isError } = useWorkoutDetail(id);

  const workout = data?.workout;
  const exercises = data?.exercises || [];
  const metrics = data?.metrics;

  if (isError && !loading) {
    navigate("/history");
    return null;
  }

  const getWorkoutDuration = () => {
    if (!workout?.started_at || !workout?.ended_at) return "Unknown";
    
    const start = new Date(workout.started_at);
    const end = new Date(workout.ended_at);
    const diff = Math.floor((end.getTime() - start.getTime()) / 60000);
    
    if (diff < 60) return `${diff} minutes`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  };

  const getTotalVolume = () => {
    let volume = 0;
    exercises.forEach((ex) => {
      ex.sets.forEach((set) => {
        if (!set.is_warmup) {
          volume += set.weight * set.reps;
        }
      });
    });
    return volume.toFixed(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading workout...</p>
        </div>
      </div>
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
            onClick={() => navigate("/history")}
            className="h-10 w-10"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Workout Details</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-4">
        {/* Workout Summary */}
        <Card className="border-2">
          <CardHeader>
            <CardTitle className="text-2xl">
              {format(new Date(workout.started_at), "EEEE, MMMM d, yyyy")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {format(new Date(workout.started_at), "h:mm a")} • {getWorkoutDuration()}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold">{exercises.length}</p>
                <p className="text-sm text-muted-foreground">Exercises</p>
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {exercises.reduce((acc, ex) => acc + ex.sets.filter(s => !s.is_warmup).length, 0)}
                </p>
                <p className="text-sm text-muted-foreground">Working Sets</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{getTotalVolume()}</p>
                <p className="text-sm text-muted-foreground">Total Volume</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Pre-Session Metrics */}
        {metrics && (
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-lg">Pre-Session Metrics</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {metrics.bodyweight && (
                  <div>
                    <p className="text-sm text-muted-foreground">Bodyweight</p>
                    <p className="text-lg font-semibold">
                      {metrics.bodyweight} {metrics.bodyweight_unit}
                    </p>
                  </div>
                )}
                {metrics.sleep && (
                  <div>
                    <p className="text-sm text-muted-foreground">Sleep</p>
                    <p className="text-lg font-semibold">{metrics.sleep}/5</p>
                  </div>
                )}
                {metrics.mood && (
                  <div>
                    <p className="text-sm text-muted-foreground">Mood</p>
                    <p className="text-lg font-semibold">{metrics.mood}/5</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Pre-workout</p>
                  <p className="text-lg font-semibold">
                    {metrics.preworkout ? "Yes" : "No"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Exercises */}
        {exercises.map((we) => (
          <Card key={we.id} className="border-2">
            <CardHeader>
              <CardTitle className="text-xl">{we.exercise.name}</CardTitle>
              {we.exercise.equipment && (
                <p className="text-sm text-muted-foreground">
                  {we.exercise.equipment} • {we.exercise.muscle_group}
                </p>
              )}
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {/* Headers */}
                <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-muted-foreground pb-2 border-b">
                  <div className="text-center">SET</div>
                  <div className="col-span-2 text-center">WEIGHT</div>
                  <div className="text-center">REPS</div>
                  <div className="text-center">RPE</div>
                  <div className="text-center">RIR</div>
                  <div className="text-center">W-UP</div>
                </div>

                {/* Sets */}
                {we.sets.map((set) => (
                  <div key={set.id} className="grid grid-cols-7 gap-2 items-center text-sm">
                    <div className="text-center font-bold">{set.set_no}</div>
                    <div className="col-span-2 text-center">
                      {set.weight} {set.unit}
                    </div>
                    <div className="text-center">{set.reps}</div>
                    <div className="text-center">{set.rpe || "-"}</div>
                    <div className="text-center">{set.rir || "-"}</div>
                    <div className="text-center">{set.is_warmup ? "✓" : ""}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}

        {workout.notes && (
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-lg">Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm">{workout.notes}</p>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
};

export default WorkoutDetail;
