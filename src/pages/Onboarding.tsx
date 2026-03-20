import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

const vibes = [
  { id: "beast", label: "Beast Mode 🔥", description: "Pure intensity, crush every rep" },
  { id: "casual", label: "Casual 😎", description: "Relaxed pace, steady progress" },
  { id: "social", label: "Social Lifter 💪", description: "Community-driven, inspire others" }
];

const goals = [
  { id: "strength", label: "Build Raw Strength", icon: "💪" },
  { id: "consistency", label: "Stay Consistent", icon: "📅" },
  { id: "transform", label: "Transform My Body", icon: "⚡" }
];

const trackingStyles = [
  { id: "numbers", label: "Numbers & PRs 📊", description: "Data-driven progress" },
  { id: "feeling", label: "How I Feel 💫", description: "Energy & confidence" },
  { id: "visual", label: "Visual Progress 📸", description: "See the change" }
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [step, setStep] = useState(1);
  const [selectedVibe, setSelectedVibe] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [selectedTracking, setSelectedTracking] = useState("");

  const handleComplete = async () => {
    const prefs = {
      vibe: selectedVibe,
      goal: selectedGoal,
      tracking_style: selectedTracking
    };

    // Check if user is already authenticated
    const { data: { user } } = await supabase.auth.getUser();
    
    if (user) {
      // User is already logged in, update profile directly
      await supabase
        .from("profiles" as any)
        .update({
          onboarding_completed: true,
          vibe: prefs.vibe,
          goal: prefs.goal,
          tracking_style: prefs.tracking_style
        })
        .eq("id", user.id);
      
      toast({
        title: "Profile updated!",
        description: "Your preferences have been saved",
      });
      navigate("/");
    } else {
      // User is not logged in, save to localStorage for after signup
      localStorage.setItem("onboarding_data", JSON.stringify(prefs));
      navigate("/loading");
    }
  };

  const canProceed = () => {
    if (step === 1) return selectedVibe !== "";
    if (step === 2) return selectedGoal !== "";
    if (step === 3) return selectedTracking !== "";
    return false;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-2">Welcome to MinimaLog</h1>
          <p className="text-muted-foreground">Your journey starts here. Let's personalize your experience.</p>
        </div>

        <div className="flex justify-center gap-2 mb-8">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={`h-2 w-20 rounded-full transition-all ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {step === 1 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-semibold mb-2">Choose Your Vibe</h2>
              <p className="text-muted-foreground">How do you want to approach your training?</p>
            </div>
            <div className="grid gap-4">
              {vibes.map((vibe) => (
                <Card
                  key={vibe.id}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    selectedVibe === vibe.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedVibe(vibe.id)}
                >
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-2">{vibe.label}</h3>
                    <p className="text-muted-foreground">{vibe.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-semibold mb-2">What's Your Main Goal?</h2>
              <p className="text-muted-foreground">Let's focus on what matters most to you</p>
            </div>
            <div className="grid gap-4">
              {goals.map((goal) => (
                <Card
                  key={goal.id}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    selectedGoal === goal.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedGoal(goal.id)}
                >
                  <CardContent className="p-6">
                    <div className="text-4xl mb-2">{goal.icon}</div>
                    <h3 className="text-xl font-semibold">{goal.label}</h3>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="text-center mb-6">
              <h2 className="text-2xl font-semibold mb-2">How Do You Track Success?</h2>
              <p className="text-muted-foreground">Choose how you'll measure your progress</p>
            </div>
            <div className="grid gap-4">
              {trackingStyles.map((style) => (
                <Card
                  key={style.id}
                  className={`cursor-pointer transition-all hover:shadow-lg ${
                    selectedTracking === style.id ? "ring-2 ring-primary" : ""
                  }`}
                  onClick={() => setSelectedTracking(style.id)}
                >
                  <CardContent className="p-6">
                    <h3 className="text-xl font-semibold mb-2">{style.label}</h3>
                    <p className="text-muted-foreground">{style.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-4 mt-8">
          {step > 1 && (
            <Button
              variant="outline"
              onClick={() => setStep(step - 1)}
              className="flex-1"
            >
              Back
            </Button>
          )}
          <Button
            onClick={() => {
              if (step === 3) {
                handleComplete();
              } else {
                setStep(step + 1);
              }
            }}
            disabled={!canProceed()}
            className="flex-1"
          >
            {step === 3 ? "Start Lifting" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default Onboarding;
