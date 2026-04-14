import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Trophy, TrendingUp, Weight, Dumbbell } from "lucide-react";
import { format } from "date-fns";
import PRCalculator from "@/components/PRCalculator";

interface PR {
  id: string;
  exercise_id: string;
  reps: number;
  weight: number;
  unit: "kg" | "lb";
  est_1rm: number | null;
  estimate_formula: string | null;
  achieved_at: string;
  exercise: {
    id: string;
    name: string;
    equipment: string | null;
    muscle_group: string | null;
  };
}

const PRs = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [prs, setPrs] = useState<PR[]>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    loadPRs();
  }, []);

  useEffect(() => {
    const handleRefresh = () => {
      loadPRs();
    };

    window.addEventListener("post:deleted:confirmed", handleRefresh);
    window.addEventListener("post:delete:failed", handleRefresh);
    return () => {
      window.removeEventListener("post:deleted:confirmed", handleRefresh);
      window.removeEventListener("post:delete:failed", handleRefresh);
    };
  }, []);

  useEffect(() => {
    const handlePrUpdated = (event: Event) => {
      const custom = event as CustomEvent<{ userId?: string; prs?: unknown }>;
      if (!custom.detail?.userId || !userId) return;
      if (custom.detail.userId !== userId) return;

      const incoming = Array.isArray(custom.detail.prs) ? custom.detail.prs : [];
      const filtered = incoming.filter((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const name = ((entry as any).exercise_name ?? "").toLowerCase();
        return name.includes("squat") || name.includes("bench") || name.includes("deadlift");
      });

      const formatted: PR[] = filtered.map((entry: any) => ({
        id: `event-${entry.exercise_id}`,
        exercise_id: entry.exercise_id,
        reps: entry.reps ?? 1,
        weight: Number(entry.weight) || 0,
        unit: entry.unit === "lb" ? "lb" : "kg",
        est_1rm:
          entry.est_1rm === null || entry.est_1rm === undefined
            ? null
            : Number(entry.est_1rm),
        estimate_formula: "epley",
        achieved_at: entry.achieved_at ?? new Date().toISOString(),
        exercise: {
          id: entry.exercise_id,
          name: entry.exercise_name ?? "Exercise",
          equipment: null,
          muscle_group: null,
        },
      }));

      setPrs(formatted);
      setLoading(false);
    };

    window.addEventListener("pr:updated", handlePrUpdated);
    return () => {
      window.removeEventListener("pr:updated", handlePrUpdated);
    };
  }, [userId]);

  const loadPRs = async () => {
    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        navigate("/auth");
        return;
      }

      setUserId(user.id);

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Fetch PRs via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/prs?user_id=eq.${user.id}&select=id,exercise_id,reps,weight,unit,est_1rm,estimate_formula,achieved_at,exercise:exercises(id,name,equipment,muscle_group)&order=achieved_at.desc`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'apikey': apiKey
        }
      });

      if (!response.ok) throw new Error('Failed to load PRs');
      const prData = await response.json();

      // Filter to only big three lifts using flexible matching
      const filteredPRs = (prData || []).filter(pr => {
        const name = pr.exercise.name.toLowerCase();
        return name.includes('squat') || 
               name.includes('bench') || 
               name.includes('deadlift');
      });

      setPrs(filteredPRs);
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load PRs",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

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
