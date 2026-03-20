import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/AuthContext";
import { usePRs } from "@/hooks/queries/usePRs";
import { Trophy, TrendingUp, Weight, Dumbbell } from "lucide-react";
import { format } from "date-fns";
import PRCalculator from "@/components/PRCalculator";

const PRs = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { data: prs = [], isLoading } = usePRs(user?.id);
  const loading = authLoading || isLoading;

  // Get the highest PR for each of the big three lifts
  const getTopPR = (category: string) => {
    const categoryPRs = prs.filter(pr => {
      const name = pr.exercise.name.toLowerCase();
      return name.includes(category);
    });

    if (categoryPRs.length === 0) return null;

    // Sort by est_1rm or weight to find the highest
    return categoryPRs.reduce((max, pr) => {
      const maxValue = max.est_1rm || max.weight;
      const prValue = pr.est_1rm || pr.weight;
      return prValue > maxValue ? pr : max;
    });
  };

  const liftConfigs = [
    { 
      category: 'squat', 
      title: 'Squat',
      icon: <Dumbbell className="h-12 w-12" />,
    },
    { 
      category: 'bench', 
      title: 'Bench Press',
      icon: <Weight className="h-12 w-12" />,
    },
    { 
      category: 'deadlift', 
      title: 'Deadlift',
      icon: <Trophy className="h-12 w-12" />,
    },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Trophy className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading PRs...</p>
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
            <Trophy className="h-5 w-5 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-bold">Personal Records</h1>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl space-y-6">
        {/* PR Calculator */}
        <PRCalculator />

        {prs.length === 0 ? (
          <Card className="border-2">
            <CardContent className="py-12 text-center">
              <Trophy className="h-16 w-16 mx-auto mb-4 opacity-50" />
              <h3 className="text-xl font-semibold mb-2">No PRs yet</h3>
              <p className="text-muted-foreground mb-6">
                Complete squat, bench, or deadlift workouts to track your PRs
              </p>
              <Button onClick={() => navigate("/start-workout")}>
                Start Training
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {liftConfigs.map((config) => {
              const topPR = getTopPR(config.category);
              
              return (
                <Card key={config.category} className="border-2">
                  <CardContent className="pt-6 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                        {config.icon}
                      </div>
                      <h3 className="text-lg font-semibold">{config.title}</h3>
                      {topPR ? (
                        <>
                          <div className="text-3xl font-bold">
                            {topPR.weight} {topPR.unit}
                          </div>
                          {topPR.est_1rm && (
                            <p className="text-sm text-muted-foreground">
                              Est. 1RM: {topPR.est_1rm.toFixed(1)} {topPR.unit}
                            </p>
                          )}
                          <p className="text-sm text-muted-foreground">
                            {format(new Date(topPR.achieved_at), "MMM d, yyyy")}
                          </p>
                        </>
                      ) : (
                        <p className="text-muted-foreground text-sm">No PR yet</p>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default PRs;
