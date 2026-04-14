import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LiquidGlassProgressBar } from "@/components/LiquidGlassProgressBar";
import { Dumbbell } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

// Helper to trigger haptic feedback on native platforms
const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {
      console.log('Haptic feedback not available');
    });
  }
};

const customizationMessages = [
  "Analyzing your vibe...",
  "Setting up your goals...",
  "Configuring tracking preferences...",
  "Optimizing your experience...",
  "Almost ready..."
];

const LoadingScreen = () => {
  const navigate = useNavigate();
  const [progress, setProgress] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          clearInterval(progressInterval);
          return 100;
        }
        // Vibrate every 5% progress (very frequent)
        if (Math.floor(prev) % 5 === 0 && prev > 0) {
          triggerHaptic();
        }
        return prev + 1.25; // 100% in 8 seconds (100 / 80 steps)
      });
    }, 100);

    // Change message every 1.6 seconds (8 seconds / 5 messages)
    const messageInterval = setInterval(() => {
      setMessageIndex((prev) => {
        if (prev >= customizationMessages.length - 1) {
          clearInterval(messageInterval);
          return prev;
        }
        triggerHaptic();
        return prev + 1;
      });
    }, 1600);

    const timer = setTimeout(() => {
      // Set multiple flags to ensure onboarding completion is recognized
      if (typeof window !== "undefined") {
        // Set window property (most reliable, checked first)
        (window as any).__onboardingJustCompleted = true;

        try {
          // Set localStorage (more persistent than sessionStorage)
          window.localStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }

        try {
          // Also set sessionStorage as backup
          window.sessionStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }
      }
      // Navigate to home after loading screen completes
      navigate("/");
    }, 8000);

    return () => {
      clearTimeout(timer);
      clearInterval(progressInterval);
      clearInterval(messageInterval);
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 text-center">
        {/* Logo and tagline */}
        <div className="space-y-4 animate-fade-in">
          <div className="flex justify-center">
            <div className="h-24 w-24 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <Dumbbell className="h-12 w-12 text-primary-foreground" />
            </div>
          </div>
          <div>
            <h1 className="text-5xl font-bold leading-none pb-1 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              MinimaLog
            </h1>
            <p className="text-2xl text-muted-foreground font-light">
              You log, We track
            </p>
          </div>
        </div>

        {/* Progress section with liquid glass */}
        <div className="space-y-4 pt-2">
          <LiquidGlassProgressBar progress={progress} />
          <p className="text-lg text-muted-foreground animate-fade-in h-8">
            {customizationMessages[messageIndex]}
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;
