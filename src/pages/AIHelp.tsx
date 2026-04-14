import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Paywall } from "@/components/Paywall";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Bot, Sparkles, Clock, AlertCircle, Shield } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { LiquidGlassHeader } from "@/components/LiquidGlassHeader";

interface AISuggestion {
  id: string;
  tips: string[];
  created_at: string;
  session_focus: string | null;
}

const DAILY_LIMIT = 5;

const AIHelp = () => {
  const [loading, setLoading] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [resetCountdown, setResetCountdown] = useState("");
  const [showConsentDialog, setShowConsentDialog] = useState(false);
  const [consentStatus, setConsentStatus] = useState<boolean | null>(null);
  const { toast} = useToast();
  const { isPremium } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);
  const queryClient = useQueryClient();

  // Get user ID and consent status on mount
  useEffect(() => {
    const initUser = async () => {
      const session = await getSupabaseSession();
      if (session?.user) {
        setUserId(session.user.id);

        // Fetch consent status
        const { data: profile } = await supabase
          .from("profiles")
          .select("ai_tips_consent")
          .eq("id", session.user.id)
          .single();

        setConsentStatus(profile?.ai_tips_consent ?? null);
      }
    };
    initUser();
  }, []);

  // Listen for consent changes from Profile Settings
  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const custom = event as CustomEvent<{
        ai_tips_consent?: boolean;
      }>;

      if (custom.detail?.ai_tips_consent !== undefined) {
        setConsentStatus(custom.detail.ai_tips_consent);
        if (import.meta.env.DEV) {
          console.log("AIHelp: Consent status updated to", custom.detail.ai_tips_consent);
        }
      }
    };

    window.addEventListener("profile:updated", handleProfileUpdated);
    return () => {
      window.removeEventListener("profile:updated", handleProfileUpdated);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const computeCountdown = () => {
      const now = new Date();
      const reset = new Date(now);
      reset.setHours(24, 0, 0, 0);
      const diff = reset.getTime() - now.getTime();

      if (diff <= 0) {
        setResetCountdown("soon");
        return;
      }

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      setResetCountdown(`${hours}h ${minutes}m`);
    };

    computeCountdown();
    const interval = window.setInterval(computeCountdown, 60000);
    return () => window.clearInterval(interval);
  }, []);

  // Fetch suggestion history
  const { data: suggestions = [], isLoading: historyLoading } = useQuery({
    queryKey: ["ai-suggestions", userId],
    queryFn: async () => {
      if (!userId) return [];

      const { data, error } = await supabase
        .from("ai_suggestions")
        .select("id, tips, created_at, session_focus")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(6);

      if (error) throw error;
      return (data as AISuggestion[]) || [];
    },
    enabled: !!userId,
    staleTime: 0,
  });

  // Check today's usage
  const { data: usageData } = useQuery({
    queryKey: ["ai-usage", userId],
    queryFn: async () => {
      if (!userId) return null;

      const today = new Date().toISOString().split("T")[0];
      const { data, error } = await supabase
        .from("ai_usage_tracking")
        .select("request_count")
        .eq("user_id", userId)
        .eq("date", today)
        .maybeSingle();

      if (error && error.code !== "PGRST116") {
        console.error("Error fetching usage:", error);
        return null;
      }

      const count = data?.request_count ?? 0;
      return { count, remaining: Math.max(DAILY_LIMIT - count, 0) };
    },
    enabled: !!userId,
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  useEffect(() => {
    if (usageData) {
      setRemaining(usageData.remaining);
    }
  }, [usageData]);

  const handleConsentResponse = async (consented: boolean) => {
    if (!userId) return;

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          ai_tips_consent: consented,
          ai_tips_consent_granted_at: consented ? new Date().toISOString() : null,
        })
        .eq("id", userId);

      if (error) throw error;

      setConsentStatus(consented);
      setShowConsentDialog(false);

      // Dispatch profile update event so the toggle in Profile Settings reflects the change
      window.dispatchEvent(
        new CustomEvent("profile:updated", {
          detail: {
            id: userId,
            ai_tips_consent: consented,
            ai_tips_consent_granted_at: consented ? new Date().toISOString() : null,
          },
        })
      );

      if (consented) {
        // Proceed with generating tips
        await performTipGeneration();
      } else {
        toast({
          title: "AI Tips Disabled",
          description: "You can enable this feature anytime in Privacy Settings.",
        });
      }
    } catch (error) {
      console.error("Error updating consent:", error);
      toast({
        title: "Error",
        description: "Failed to save consent preference. Please try again.",
        variant: "destructive",
      });
    }
  };

  const generateTips = async () => {
    // Check if user is premium
    if (!isPremium) {
      setShowPaywall(true);
      return;
    }

    if (!userId) {
      toast({
        title: "Not signed in",
        description: "Please sign in to get AI tips.",
        variant: "destructive",
      });
      return;
    }

    if (remaining !== null && remaining <= 0) {
      toast({
        title: "Daily limit reached",
        description: `You've used all ${DAILY_LIMIT} daily suggestions. Come back tomorrow!`,
        variant: "destructive",
      });
      return;
    }

    // Check consent status
    if (consentStatus === null || consentStatus === false) {
      // User hasn't consented or has toggled it off - show consent dialog
      setShowConsentDialog(true);
      return;
    }

    // User has consented - proceed with generation
    await performTipGeneration();
  };

  const performTipGeneration = async () => {
    setLoading(true);

    try {
      const session = await getSupabaseSession();
      if (!session) {
        throw new Error("Not authenticated");
      }

      const response = await supabase.functions.invoke("generate-ai-tips");

      console.log("Raw response:", response);
      console.log("Response data:", response.data);
      console.log("Response error:", response.error);

      // If there's an error, try to get more details
      if (response.error) {
        console.error("Edge function error:", response.error);

        // Try to extract the actual error from the response
        if ((response.error as any).context) {
          console.log("Error context:", (response.error as any).context);
        }

        // The actual error data might be in response.data even when there's an error
        if (response.data) {
          console.log("Error data from response:", response.data);
        }
      }

      // Check if data contains an error (edge function returned error as data)
      if (response.data?.error || response.error) {
        const errorData = response.data || {};
        console.error("Full error data:", errorData);

        if (errorData.error === "Daily limit reached") {
          setRemaining(0);
          toast({
            title: "Daily limit reached",
            description: errorData.message || "Come back tomorrow for more tips!",
            variant: "destructive",
          });
          return;
        }

        // If we have an error object, throw it
        if (response.error) {
          throw new Error(errorData.message || errorData.error || "Edge function error");
        }
      }

      const { data, error } = response;
      console.log("Parsed data:", data);

      if (data?.error) {
        console.error("Data error:", data.error);
        console.error("Data message:", data.message);
        console.error("Data details:", data.details);

        if (data.error === "Daily limit reached") {
          setRemaining(0);
          toast({
            title: "Daily limit reached",
            description: data.message || "Come back tomorrow for more tips!",
            variant: "destructive",
          });
          return;
        }

        throw new Error(data.message || data.error);
      }

      // Success!
      setRemaining(data.remaining ?? 0);

      // Refresh the suggestions history
      queryClient.invalidateQueries({ queryKey: ["ai-suggestions", userId] });
      queryClient.invalidateQueries({ queryKey: ["ai-usage", userId] });

      toast({
        title: "Tips generated!",
        description: data.message || `${data.remaining} suggestion${data.remaining === 1 ? '' : 's'} remaining today`,
      });
    } catch (err: any) {
      console.error("Error generating tips:", err);
      console.error("Error type:", typeof err);
      console.error("Error keys:", Object.keys(err));
      console.error("Full error object:", JSON.stringify(err, null, 2));

      let errorMessage = "Something went wrong generating tips.";

      if (err?.message?.includes("Insufficient data")) {
        errorMessage = "Log at least one workout before asking for tips.";
      } else if (err?.message?.includes("auth")) {
        errorMessage = "Please sign in to get AI tips.";
      } else if (err?.message) {
        errorMessage = `Error: ${err.message}`;
      }

      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const latestSuggestion = suggestions[0];
  const hasHistory = suggestions.length > 1;

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header */}
      <LiquidGlassHeader>
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Bot className="h-5 w-5 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">AI Coach</h1>
      </LiquidGlassHeader>

      <main
        className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)' }}
      >
        <div className="container mx-auto px-4 pb-8 space-y-6 max-w-2xl">

          {/* Usage counter */}
          {remaining !== null && (
            <Card className="p-5 bg-primary/5 border-primary/20 rounded-2xl">
              <div className="flex flex-col items-center gap-4">
                <span className="text-sm font-medium text-center">
                  {remaining > 0
                    ? `${remaining} of ${DAILY_LIMIT} suggestions remaining today`
                    : "Daily limit reached - come back tomorrow!"}
                </span>
                {remaining > 0 && (
                  <Button
                    onClick={generateTips}
                    disabled={loading || remaining <= 0}
                    className="rounded-full px-6 shadow-sm"
                    size="sm"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Analyzing
                      </>
                    ) : (
                      "Generate Tips"
                    )}
                  </Button>
                )}
                <p className="text-xs text-muted-foreground text-center">
                  Keep logging workouts—the AI tailors smarter tips as your history grows.
                </p>
                {resetCountdown && (
                  <p className="text-xs text-muted-foreground text-center">
                    Resets in {resetCountdown}
                  </p>
                )}
              </div>
            </Card>
          )}

          {/* Info card for first-time users */}
          {!historyLoading && suggestions.length === 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>5 tips per day powered by Google Gemini AI.</AlertDescription>
            </Alert>
          )}

          {/* Latest tips */}
          {latestSuggestion && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Latest Tips</h2>
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  {new Date(latestSuggestion.created_at).toLocaleDateString([], {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </div>
              </div>

              <div className="space-y-3">
                {latestSuggestion.tips.map((tip, index) => {
                  // Check if tip starts with emoji indicator
                  const isGeneralTip = tip.startsWith("💡");
                  const isPersonalizedTip = tip.startsWith("💪");

                  // Remove emoji from display text if present
                  const displayTip = isGeneralTip || isPersonalizedTip
                    ? tip.slice(2).trim()
                    : tip;

                  return (
                    <Card
                      key={index}
                      className={`p-4 border-l-4 ${
                        isGeneralTip
                          ? 'border-l-blue-500/60 bg-blue-50/30 dark:bg-blue-950/20'
                          : isPersonalizedTip
                          ? 'border-l-purple-500/60 bg-purple-50/30 dark:bg-purple-950/20'
                          : 'border-l-primary/40'
                      }`}
                    >
                      <div className="flex gap-3">
                        <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-lg ${
                          isGeneralTip
                            ? 'bg-blue-100 dark:bg-blue-900/40'
                            : isPersonalizedTip
                            ? 'bg-purple-100 dark:bg-purple-900/40'
                            : 'bg-primary/10'
                        }`}>
                          {isGeneralTip ? "💡" : isPersonalizedTip ? "💪" : (index + 1)}
                        </div>
                        <div className="flex-1">
                          {(isGeneralTip || isPersonalizedTip) && (
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                isGeneralTip
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                                  : 'bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-300'
                              }`}>
                                {isGeneralTip ? "General Principle" : "Personalized"}
                              </span>
                            </div>
                          )}
                          <p className="text-sm leading-relaxed">{displayTip}</p>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!historyLoading && suggestions.length === 0 && !loading && (
            <Card className="p-12 text-center border-dashed">
              <div className="flex flex-col items-center gap-4">
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <div className="space-y-2">
                  <p className="text-lg font-medium">Ready to get started?</p>
                  <p className="text-sm text-muted-foreground max-w-md">
                    Our AI will analyze your workout history and provide personalized tips to help you progress.
                  </p>
                </div>
                <Button onClick={generateTips} size="lg" disabled={loading || (remaining !== null && remaining <= 0)}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Generating...
                    </>
                  ) : (
                    <>
                      <Sparkles className="mr-2 h-4 w-4" />
                      Generate My First Tips
                    </>
                  )}
                </Button>
              </div>
            </Card>
          )}

          {/* History */}
          {hasHistory && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Previous Tips</h2>
              <div className="space-y-3">
                {suggestions.slice(1).map((suggestion) => (
                  <Card key={suggestion.id} className="p-4 border-muted/50">
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                        <Clock className="h-3.5 w-3.5" />
                        {new Date(suggestion.created_at).toLocaleDateString([], {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      {suggestion.tips.map((tip, index) => (
                        <div key={index} className="flex gap-2 text-sm">
                          <span className="text-muted-foreground flex-shrink-0">{index + 1}.</span>
                          <span className="text-muted-foreground">{tip}</span>
                        </div>
                      ))}
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Loading state for history */}
          {historyLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          )}
        </div>
      </main>

      {/* AI Consent Dialog */}
      <AlertDialog open={showConsentDialog} onOpenChange={setShowConsentDialog}>
        <AlertDialogContent className="max-w-lg">
          <AlertDialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Shield className="h-6 w-6 text-amber-600 dark:text-amber-500" />
              </div>
              <AlertDialogTitle className="text-left">Share Data with Google AI?</AlertDialogTitle>
            </div>
            <AlertDialogDescription asChild>
              <div className="space-y-4 text-left">
                <p className="text-sm">
                  To generate personalized workout tips, we'll share some of your workout data with{" "}
                  <span className="font-semibold text-foreground">Google Gemini AI</span>, a third-party artificial intelligence service.
                </p>

                <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                  <div>
                    <h4 className="font-semibold text-sm text-foreground mb-2">What data is shared:</h4>
                    <ul className="text-xs space-y-1 list-disc list-inside ml-2">
                      <li>Recent workout history (last 2-4 weeks)</li>
                      <li>Exercise names, weights, reps, and sets</li>
                      <li>Wellness metrics (sleep quality, mood)</li>
                      <li>Your fitness goals and training preferences</li>
                    </ul>
                  </div>

                  <div>
                    <h4 className="font-semibold text-sm text-foreground mb-2">What's NOT shared:</h4>
                    <ul className="text-xs space-y-1 list-disc list-inside ml-2">
                      <li>Your email, username, or account info</li>
                      <li>Photos or profile pictures</li>
                      <li>Social connections or posts</li>
                    </ul>
                  </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                  <p className="text-xs text-blue-900 dark:text-blue-100">
                    <strong>Your control:</strong> This data is only sent when you click "Generate Tips." You can disable this feature anytime in Privacy Settings. Limited to 5 tips per day.
                  </p>
                </div>

                <p className="text-xs text-muted-foreground">
                  Google's use of your data is governed by their{" "}
                  <a
                    href="https://policies.google.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    privacy policy
                  </a>
                  .
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel onClick={() => handleConsentResponse(false)}>
              Don't Allow
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => handleConsentResponse(true)}
              className="bg-primary hover:bg-primary/90"
            >
              Allow & Generate Tips
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} feature="AI-Powered Workout Tips" />
    </div>
  );
};

export default AIHelp;
