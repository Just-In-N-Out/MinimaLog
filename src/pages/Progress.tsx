import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { useExerciseProgress } from "@/hooks/queries/useExerciseProgress";
import { TrendingUp, Search, Dumbbell } from "lucide-react";

const Progress = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: progress = [], isLoading } = useExerciseProgress(user?.id);
  const loading = authLoading || isLoading;
  const [search, setSearch] = useState("");

  const filteredProgress = useMemo(() => {
    if (search.trim()) {
      return progress.filter((p: any) =>
        p.exercise.name.toLowerCase().includes(search.toLowerCase()) ||
        p.exercise.muscle_group?.toLowerCase().includes(search.toLowerCase())
      );
    }
    return progress;
  }, [search, progress]);

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
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background z-10 py-4">
        <div className="container mx-auto px-4 space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
              <TrendingUp className="h-5 w-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold">Progress</h1>
          </div>
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
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 space-y-4">
        {filteredProgress.length === 0 ? (
          <Card className="border-2">
            <CardContent className="py-12 text-center">
              <Dumbbell className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">
                {progress.length === 0 ? "No progress data yet" : "No exercises found"}
              </h3>
              <p className="text-muted-foreground">
                {progress.length === 0
                  ? "Complete workouts to see your progress"
                  : "Try a different search term"}
              </p>
            </CardContent>
          </Card>
        ) : (
          filteredProgress.map((p) => (
            <Card 
              key={p.exercise.id} 
              className="border cursor-pointer hover:border-primary transition-colors"
              onClick={() => navigate(`/exercise-progress/${p.exercise.id}`)}
            >
              <CardHeader>
                <CardTitle className="text-xl">{p.exercise.name}</CardTitle>
                {p.exercise.equipment && (
                  <CardDescription className="text-base">
                    {p.exercise.equipment} • {p.exercise.muscle_group}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-2xl font-bold">{p.totalSets}</p>
                    <p className="text-sm text-muted-foreground">Total Sets</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {p.maxWeight} {p.unit}
                    </p>
                    <p className="text-sm text-muted-foreground">Max Weight</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold">
                      {Math.floor(
                        (new Date().getTime() - new Date(p.lastWorkout).getTime()) /
                          (1000 * 60 * 60 * 24)
                      )}d
                    </p>
                    <p className="text-sm text-muted-foreground">Last Done</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </main>
    </div>
  );
};

export default Progress;
