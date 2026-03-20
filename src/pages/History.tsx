import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { useWorkoutHistory } from "@/hooks/queries/useWorkouts";
import { Calendar, Dumbbell } from "lucide-react";
import { format } from "date-fns";

const History = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: workouts = [], isLoading } = useWorkoutHistory(user?.id);
  const loading = authLoading || isLoading;

  const getWorkoutDuration = (workout: Workout) => {
    if (!workout.started_at || !workout.ended_at) return "Unknown";
    
    const start = new Date(workout.started_at);
    const end = new Date(workout.ended_at);
    const diff = Math.floor((end.getTime() - start.getTime()) / 60000); // minutes
    
    if (diff < 60) return `${diff}m`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
            <Calendar className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">History</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl">
        {workouts.length === 0 ? (
          <Card className="border-2">
            <CardContent className="py-12 text-center">
              <Dumbbell className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">No workouts yet</h3>
              <p className="text-muted-foreground mb-6">
                Complete your first workout to see it here
              </p>
              <Button onClick={() => navigate("/start-workout")}>
                Start Your First Workout
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {workouts.map((workout) => (
              <Card
                key={workout.id}
                className="border-2 cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => navigate(`/workout-detail/${workout.id}`)}
              >
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-xl">
                        {format(new Date(workout.started_at), "EEEE, MMMM d")}
                      </CardTitle>
                      <CardDescription className="text-base mt-1">
                        {format(new Date(workout.started_at), "h:mm a")} • {getWorkoutDuration(workout)}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-6 text-sm">
                    <div>
                      <span className="text-muted-foreground">Exercises: </span>
                      <span className="font-semibold">{workout.exercise_count}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Sets: </span>
                      <span className="font-semibold">{workout.set_count}</span>
                    </div>
                  </div>
                  {workout.notes && (
                    <p className="mt-3 text-sm text-muted-foreground line-clamp-2">
                      {workout.notes}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

export default History;
