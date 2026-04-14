import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { usernameSchema } from "@/lib/validation";
import { Dumbbell } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { SmoothWheelPicker } from "@/components/SmoothWheelPicker";
import { LiquidGlassCard } from "@/components/LiquidGlassCard";
import { LiquidGlassOption } from "@/components/LiquidGlassOption";
import { LiquidGlassProgressBar } from "@/components/LiquidGlassProgressBar";

const LB_TO_KG = 0.45359237;
const KG_TO_LB = 1 / LB_TO_KG;

// Helper to trigger haptic feedback on native platforms
const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {
      console.log('Haptic feedback not available');
    });
  }
};

const trainingStyles = [
  { id: "solo", label: "Solo focus 🎯", description: "Train independently, self-motivated" },
  { id: "accountability", label: "With accountability 🤝", description: "Need check-ins and support" },
  { id: "social", label: "Social energy ⚡", description: "Thrive in community settings" }
];

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

const startReasons = [
  { id: "stronger", label: "To feel stronger — in body and in mind", icon: "💭" },
  { id: "consistent", label: "To prove I can stay consistent", icon: "🔁" },
  { id: "overcome", label: "To overcome something — stress, doubt, or a past version of me", icon: "❤️" },
  { id: "connect", label: "To connect with others who share this drive", icon: "🤝" }
];

const trainingTimes = [
  { id: "morning", label: "Early morning — own the day 🌅" },
  { id: "midday", label: "Midday — break up the day ☀️" },
  { id: "evening", label: "Evening — decompress after work 🌆" },
  { id: "flexible", label: "Whenever I can squeeze it in ⏰" }
];

const timeCommitments = [
  { id: "30min", label: "30 minutes or less ⚡" },
  { id: "45-60min", label: "45 minutes - 1 hour ⏱️" },
  { id: "60-90min", label: "1-1.5 hours 💪" },
  { id: "120min+", label: "2+ hours 🏋️" }
];

const fitnessJourneyStages = [
  { id: "starting", label: "Just starting out — this is all new to me 🌱" },
  { id: "returning", label: "Getting back into it — I've been here before 🔄" },
  { id: "experienced", label: "Been lifting for years — refining my craft 🏆" },
  { id: "recovering", label: "Recovering from setback — rebuilding stronger 💪" }
];

const obstacles = [
  { id: "time", label: "Finding time in my schedule ⏰" },
  { id: "motivation", label: "Staying motivated when I don't see results 📉" },
  { id: "knowledge", label: "Not knowing if I'm doing it right 🤔" },
  { id: "doubt", label: "Overcoming self-doubt or comparison 😔" },
  { id: "limitations", label: "Physical limitations or injuries 🩹" }
];

const workoutFeelings = [
  { id: "accomplished", label: "Accomplished — like I conquered something 🏔️" },
  { id: "peaceful", label: "Peaceful — released the stress ☮️" },
  { id: "powerful", label: "Powerful — reminded of my strength ⚡" },
  { id: "connected", label: "Connected — part of something bigger 🤝" }
];

const liftingMeanings = [
  { id: "therapy", label: "My daily therapy session 🧠" },
  { id: "discipline", label: "Proof that I'm disciplined 📋" },
  { id: "self-care", label: "My time to be selfish (in a good way) ⏳" },
  { id: "promise", label: "A promise I keep to myself 🤝" }
];

const motivationSources = [
  { id: "why_started", label: "Remembering why I started 💭" },
  { id: "just_show_up", label: "Just showing up — even if it's 10 minutes ⏱️" },
  { id: "feel_after", label: "Thinking about how good I'll feel after ✨" },
  { id: "support", label: "My support system pushing me 👥" }
];

const bestSelfVisions = [
  { id: "never_gives_up", label: "Someone who never gives up 🔥" },
  { id: "at_home_in_body", label: "Someone who feels at home in their body 🏡" },
  { id: "inspires_others", label: "Someone others look up to 🌟" },
  { id: "proves_wrong", label: "Someone who proves people wrong 💯" }
];

const oneYearGoals = [
  { id: "didnt_quit", label: "\"You didn't quit\" 🏃" },
  { id: "got_stronger", label: "\"You got so much stronger\" 💪" },
  { id: "believed_self", label: "\"You finally believed in yourself\" ❤️" },
  { id: "inspired_others", label: "\"You inspired someone else to start\" 🌟" }
];

const prideMetrics = [
  { id: "consistency", label: "Showing up consistently, no matter what 📅" },
  { id: "strength_goal", label: "Hitting a specific strength goal 🎯" },
  { id: "comfortable_in_skin", label: "Finally feeling comfortable in my skin 🦋" },
  { id: "routine", label: "Building a routine that sticks 🔁" }
];

const acknowledgmentMessages = {
  // Q4: Where are you in your fitness journey?
  starting: "Everyone starts somewhere. The fact you're here means you're already ahead of most people.",
  returning: "Welcome back. The fact you're returning shows real strength. This time will be different.",
  experienced: "Respect. Most people never get past year one. You know what consistency looks like.",
  recovering: "That takes real courage. Setbacks don't define you—how you come back does.",

  // Q9: What's been your biggest obstacle?
  time: "We get it. Life is chaos. But you're making the choice to prioritize yourself. That matters.",
  motivation: "The real gains happen when no one's watching. Trust the process—it's working even when you can't see it.",
  knowledge: "Doubt is normal. The fact you're asking means you care. We'll help you build that confidence.",
  doubt: "Your only competition is who you were yesterday. That voice in your head? We're gonna prove it wrong.",
  limitations: "Working around limitations takes more discipline than most will ever know. That's warrior mindset.",

  // Q12: What does lifting represent for you?
  therapy: "Hell yeah. The iron never judges. It just asks: how bad do you want it today?",
  discipline: "Discipline is doing it even when you don't feel like it. You already know the secret.",
  "self-care": "You can't pour from an empty cup. This isn't selfish—it's survival.",
  promise: "Most people break promises to themselves every day. Not you. That's character.",

  // Q14: When you imagine your best self, what do you see?
  never_gives_up: "Relentless. That's the word. Most people quit when it gets hard. You're built different.",
  at_home_in_body: "That feeling is waiting for you. Every rep, every session—you're getting closer.",
  inspires_others: "You inspire by showing up. Lead by example. The right people are watching.",
  proves_wrong: "Use that fire. Every doubt, every criticism—turn it into fuel. You're gonna shock them all.",

  // Q16: What would make you proud of yourself?
  consistency: "Consistency beats intensity every single time. You already understand what most never will.",
  strength_goal: "Goals give you direction. We're gonna help you get there, one rep at a time.",
  comfortable_in_skin: "That confidence is already inside you. We're just helping you uncover it.",
  routine: "Routines change lives. The fact you want this means you're ready. Let's build it together.",
};

const careLines = [
  "Here In MinimaLog",
  "We Care About Every",
  "Lift.",
  "Every Lifter.",
  "Every Story.",
  "Build Your Story, One Lift At A Time.",
];

const Onboarding = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [username, setUsername] = useState("");
  const [step, setStep] = useState(1);

  // Existing onboarding answers
  const [selectedTrainingStyle, setSelectedTrainingStyle] = useState("");
  const [selectedVibe, setSelectedVibe] = useState("");
  const [selectedGoal, setSelectedGoal] = useState("");
  const [selectedTracking, setSelectedTracking] = useState("");
  const [selectedReason, setSelectedReason] = useState("");

  // New onboarding answers
  const [selectedTrainingTime, setSelectedTrainingTime] = useState("");
  const [selectedTimeCommitment, setSelectedTimeCommitment] = useState("");
  const [selectedFitnessJourneyStage, setSelectedFitnessJourneyStage] = useState("");
  const [selectedObstacle, setSelectedObstacle] = useState("");
  const [selectedWorkoutFeeling, setSelectedWorkoutFeeling] = useState("");
  const [selectedLiftingMeaning, setSelectedLiftingMeaning] = useState("");
  const [selectedMotivationSource, setSelectedMotivationSource] = useState("");
  const [selectedBestSelfVision, setSelectedBestSelfVision] = useState("");
  const [selectedOneYearGoal, setSelectedOneYearGoal] = useState("");
  const [selectedPrideMetric, setSelectedPrideMetric] = useState("");

  // Acknowledgment screen state
  const [showAcknowledgment, setShowAcknowledgment] = useState(false);
  const [acknowledgmentMessage, setAcknowledgmentMessage] = useState("");
  const [visibleWords, setVisibleWords] = useState(0);
  const [acknowledgmentFadingOut, setAcknowledgmentFadingOut] = useState(false);

  // Welcome screen state
  const [showWelcome, setShowWelcome] = useState(true);
  const [welcomeVisibleWords, setWelcomeVisibleWords] = useState(0);
  const [welcomeFadingOut, setWelcomeFadingOut] = useState(false);

  const [showCareScreen, setShowCareScreen] = useState(false);
  const [visibleCareLines, setVisibleCareLines] = useState(0);
  const [showLogo, setShowLogo] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [unitPreference, setUnitPreference] = useState<"kg" | "lb" | "">("");
  const [weightKg, setWeightKg] = useState("");
  const [weightLb, setWeightLb] = useState("");
  const [heightCmInput, setHeightCmInput] = useState("");
  const [heightFeetInput, setHeightFeetInput] = useState("");
  const [heightInchesInput, setHeightInchesInput] = useState("");

  const cmToFeetInches = useCallback((cmValue: number) => {
    if (!Number.isFinite(cmValue) || cmValue <= 0) {
      return { feet: "", inches: "" };
    }
    const totalInches = cmValue / 2.54;
    const feet = Math.floor(totalInches / 12);
    const inches = Math.round(totalInches - feet * 12);
    return {
      feet: feet > 0 ? feet.toString() : "",
      inches: inches >= 0 ? inches.toString() : "",
    };
  }, []);

  const feetInchesToCm = useCallback((feetRaw: string, inchesRaw: string) => {
    const feet = Number.parseFloat(feetRaw || "0");
    const inches = Number.parseFloat(inchesRaw || "0");
    if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
    if (feet < 0 || inches < 0 || inches >= 12) return null;
    const totalInches = feet * 12 + inches;
    if (totalInches <= 0) return null;
    return totalInches * 2.54;
  }, []);

  const trimmedUsername = username.trim();
  const usernameValidation = usernameSchema.safeParse(trimmedUsername);
  const usernameError =
    trimmedUsername.length > 0 && !usernameValidation.success
      ? usernameValidation.error.errors[0].message
      : null;

  useEffect(() => {
    const loadExistingUsername = async () => {
      try {
        const session = await getSupabaseSession();
        const user = session?.user;
        if (!user) return;

        const { data, error } = await supabase
          .from("profiles")
          .select("username, unit_default, bodyweight, height_cm")
          .eq("id", user.id)
          .single();

        if (!error && data) {
          // Don't prefill username during onboarding - user must choose their own
          // (Skip loading if it's a default value like "User")
          if (data.username && data.username !== "User") {
            setUsername((current) => current || data.username || "");
          }

          // Only prefill unit preference and measurements if user has existing data
          // Don't set defaults during first-time onboarding
          if (data.unit_default) {
            const detectedUnit: "kg" | "lb" = data.unit_default === "lb" ? "lb" : "kg";

            // Only set unit preference if they also have bodyweight data (indicates they've been through onboarding)
            if (typeof data.bodyweight === "number" && Number.isFinite(data.bodyweight)) {
              setUnitPreference(detectedUnit);

              if (detectedUnit === "lb") {
                setWeightLb(data.bodyweight.toString());
              } else {
                setWeightKg(data.bodyweight.toString());
              }
            }

            if (typeof data.height_cm === "number" && Number.isFinite(data.height_cm) && data.height_cm > 0) {
              setHeightCmInput(data.height_cm.toString());
              const imperial = cmToFeetInches(data.height_cm);
              setHeightFeetInput(imperial.feet);
              setHeightInchesInput(imperial.inches);
            }
          }
        }
      } catch (fetchError) {
      if (import.meta.env.DEV) console.warn("Failed to load existing username");
      }
    };

    void loadExistingUsername();
  }, [cmToFeetInches]);

  const handleComplete = useCallback(
    async (reasonOverride?: string) => {
      const validation = usernameSchema.safeParse(trimmedUsername);
      if (!validation.success) {
      toast({
        title: "Pick a username",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      setStep(19); // Updated from 9 to 19
      return;
    }

    if (!unitPreference) {
      toast({
        title: "Choose your units",
        description: "Please select your preferred measurement system.",
        variant: "destructive",
      });
      setStep(3); // Updated from 6 to 3
      return;
    }

    const unitDefault: "kg" | "lb" = unitPreference;
    const bodyweightValue =
      unitDefault === "kg"
        ? Number.parseFloat(weightKg)
        : Number.parseFloat(weightLb);
    const heightValueCm =
      unitDefault === "kg"
        ? Number.parseFloat(heightCmInput)
        : feetInchesToCm(heightFeetInput, heightInchesInput);

    if (!Number.isFinite(bodyweightValue) || bodyweightValue <= 0 || !Number.isFinite(heightValueCm ?? NaN) || (heightValueCm ?? 0) <= 0) {
      toast({
        title: "Add your measurements",
        description: "Height and bodyweight are required to continue.",
        variant: "destructive",
      });
      setStep(17); // Updated from 7 to 17
      return;
    }

    const roundedHeightCm =
      heightValueCm !== null ? Math.round(heightValueCm * 10) / 10 : null;
    const roundedBodyweight = Math.round(bodyweightValue * 100) / 100;

    try {
      setCompleting(true);

      // CRITICAL: Set multiple flags IMMEDIATELY at the start of completion
      // This ensures we don't get redirected back to onboarding during the async operations
      if (typeof window !== "undefined") {
        (window as any).__onboardingJustCompleted = true;
        try {
          window.localStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }
        try {
          window.sessionStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }
      }

      // Normalize username to lowercase for case-insensitive uniqueness
      const normalizedUsername = trimmedUsername.toLowerCase();
      setUsername(normalizedUsername);

      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        toast({
          title: "Error",
          description: "Please sign in first",
          variant: "destructive",
        });
        navigate("/auth");
        return;
      }

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify({
          onboarding_completed: true,
          training_style: selectedTrainingStyle,
          vibe: selectedVibe,
          goal: selectedGoal,
          tracking_style: selectedTracking,
          username: normalizedUsername,
          unit_default: unitDefault,
          bodyweight: roundedBodyweight,
          height_cm: roundedHeightCm,
          training_time_preference: selectedTrainingTime,
          time_commitment: selectedTimeCommitment,
          fitness_journey_stage: selectedFitnessJourneyStage,
          biggest_obstacle: selectedObstacle,
          workout_feeling: selectedWorkoutFeeling,
          lifting_meaning: selectedLiftingMeaning,
          motivation_source: selectedMotivationSource,
          best_self_vision: selectedBestSelfVision,
          one_year_goal: selectedOneYearGoal,
          pride_metric: selectedPrideMetric,
        }),
      });

      if (!response.ok) {
        let message = "Failed to complete onboarding";
        try {
          const errorData = await response.json();
          if (errorData?.message) {
            message = errorData.message;
          }
        } catch {
          // Ignore JSON parse errors for empty responses
        }

        if (message.toLowerCase().includes("duplicate") || message.toLowerCase().includes("unique")) {
          toast({
            title: "Username taken",
            description: "Try a different username.",
            variant: "destructive",
          });
          setStep(19);
          return;
        }

        throw new Error(message);
      }

      const { error: publicProfileError } = await supabase
        .from("public_profiles")
        .update({ username: normalizedUsername })
        .eq("id", user.id);

      if (publicProfileError) {
        const errorMessage = publicProfileError.message || "Failed to update username";
        if (errorMessage.toLowerCase().includes("duplicate") || errorMessage.toLowerCase().includes("unique")) {
          toast({
            title: "Username taken",
            description: "Try a different username.",
            variant: "destructive",
          });
          setStep(19);
          return;
        }

        throw publicProfileError;
      }

      const finalReason = reasonOverride ?? selectedReason;

      if (finalReason && typeof window !== "undefined") {
        const selectedReasonData = startReasons.find((reason) => reason.id === finalReason);
        try {
          window.localStorage.setItem("minimalog_start_reason", finalReason);
          if (selectedReasonData) {
            window.localStorage.setItem("minimalog_start_reason_label", selectedReasonData.label);
          }
        } catch {
          // Ignore storage errors (private mode, etc.)
        }
      }

      setVisibleCareLines(0);
      setShowCareScreen(true);

      // Refresh the flags right before showing care screen
      if (typeof window !== "undefined") {
        (window as any).__onboardingJustCompleted = true;
        try {
          window.localStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }
        try {
          window.sessionStorage.setItem("onboarding:just-completed", String(Date.now()));
        } catch {
          // Ignore storage errors
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to save preferences",
        variant: "destructive",
      });
      } finally {
        setCompleting(false);
      }
    },
    [
      trimmedUsername,
      toast,
      setStep,
      setUsername,
      setCompleting,
      navigate,
      selectedTrainingStyle,
      selectedVibe,
      selectedGoal,
      selectedTracking,
      selectedReason,
      selectedTrainingTime,
      selectedTimeCommitment,
      selectedFitnessJourneyStage,
      selectedObstacle,
      selectedWorkoutFeeling,
      selectedLiftingMeaning,
      selectedMotivationSource,
      selectedBestSelfVision,
      selectedOneYearGoal,
      selectedPrideMetric,
      setVisibleCareLines,
      setShowCareScreen,
      unitPreference,
      weightKg,
      weightLb,
      heightCmInput,
      heightFeetInput,
      heightInchesInput,
      feetInchesToCm,
    ],
  );

  const handleSelectTrainingStyle = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedTrainingStyle(id);
      setStep(6); // Updated from 2 to 6
    },
    [completing, setSelectedTrainingStyle, setStep],
  );

  const handleSelectVibe = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedVibe(id);
      setStep(7); // Updated from 3 to 7
    },
    [completing, setSelectedVibe, setStep],
  );

  const handleSelectGoal = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedGoal(id);
      setStep(8); // Updated from 4 to 8
    },
    [completing, setSelectedGoal, setStep],
  );

  const handleSelectTracking = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedTracking(id);
      setStep(9); // Updated from 5 to 9
    },
    [completing, setSelectedTracking, setStep],
  );

  const handleSelectReason = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedReason(id);
      setStep(11); // Updated from 6 to 11
    },
    [completing, setSelectedReason, setStep],
  );

  const finishOnboarding = useCallback(() => {
    if (completing) return;
    void handleComplete();
  }, [completing, handleComplete]);

  // Helper function to show acknowledgment screen
  const showAcknowledgmentScreen = useCallback((answerId: string, nextStep: number) => {
    const message = acknowledgmentMessages[answerId];
    if (!message) {
      setStep(nextStep);
      return;
    }
    setAcknowledgmentMessage(message);
    setVisibleWords(0); // Start with no words, let them fade in
    setShowAcknowledgment(true);
    setAcknowledgmentFadingOut(false);

    // After acknowledgment animation completes, fade out and move to next step
    const words = message.split(' ');
    const fadeInDuration = Math.ceil(words.length / 3) * 1000; // 1000ms per batch of 3 words
    const readingDuration = 1800; // 1800ms after final phrase before fade out (more time to read)
    const fadeOutDuration = 1200; // 1200ms to fade out (slower, smoother transition)

    // Start fade out and set next step (so new question renders underneath)
    setTimeout(() => {
      setStep(nextStep);
      setAcknowledgmentFadingOut(true);
    }, fadeInDuration + readingDuration);

    // Close acknowledgment screen after fade completes
    setTimeout(() => {
      setShowAcknowledgment(false);
      setAcknowledgmentFadingOut(false);
    }, fadeInDuration + readingDuration + fadeOutDuration);
  }, []);

  // New question handlers
  const handleSelectTrainingTime = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedTrainingTime(id);
      setStep(2);
    },
    [completing],
  );

  const handleSelectTimeCommitment = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedTimeCommitment(id);
      setStep(3);
    },
    [completing],
  );

  const handleSelectFitnessJourneyStage = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedFitnessJourneyStage(id);
      showAcknowledgmentScreen(id, 5);
    },
    [completing, showAcknowledgmentScreen],
  );

  const handleSelectObstacle = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedObstacle(id);
      showAcknowledgmentScreen(id, 10);
    },
    [completing, showAcknowledgmentScreen],
  );

  const handleSelectWorkoutFeeling = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedWorkoutFeeling(id);
      setStep(12);
    },
    [completing],
  );

  const handleSelectLiftingMeaning = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedLiftingMeaning(id);
      showAcknowledgmentScreen(id, 13);
    },
    [completing, showAcknowledgmentScreen],
  );

  const handleSelectMotivationSource = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedMotivationSource(id);
      setStep(14);
    },
    [completing],
  );

  const handleSelectBestSelfVision = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedBestSelfVision(id);
      showAcknowledgmentScreen(id, 15);
    },
    [completing, showAcknowledgmentScreen],
  );

  const handleSelectOneYearGoal = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedOneYearGoal(id);
      setStep(16);
    },
    [completing],
  );

  const handleSelectPrideMetric = useCallback(
    (id: string) => {
      if (completing) return;
      triggerHaptic();
      setSelectedPrideMetric(id);
      showAcknowledgmentScreen(id, 17);
    },
    [completing, showAcknowledgmentScreen],
  );


  // Set default weight when entering step 17 if not already set
  useEffect(() => {
    if (step === 17) { // Updated from 7 to 17
      if (unitPreference === "kg" && !weightKg) {
        setWeightKg("70");
      } else if (unitPreference === "lb" && !weightLb) {
        setWeightLb("150");
      }
    }
  }, [step, unitPreference, weightKg, weightLb]);

  // Set default height when entering step 18 if not already set
  useEffect(() => {
    if (step === 18) { // Updated from 8 to 18
      if (unitPreference === "kg" && !heightCmInput) {
        setHeightCmInput("175");
      } else if (unitPreference === "lb" && !heightFeetInput && !heightInchesInput) {
        setHeightFeetInput("5");
        setHeightInchesInput("10");
      }
    }
  }, [step, unitPreference, heightCmInput, heightFeetInput, heightInchesInput]);

  useEffect(() => {
    if (!unitPreference) return; // Don't convert if no unit preference selected yet

    if (unitPreference === "kg") {
      if (!weightKg && weightLb) {
        const pounds = Number.parseFloat(weightLb);
        if (Number.isFinite(pounds) && pounds > 0) {
          setWeightKg((pounds * LB_TO_KG).toFixed(1));
        }
      }
      if (!heightCmInput && (heightFeetInput || heightInchesInput)) {
        const cm = feetInchesToCm(heightFeetInput, heightInchesInput);
        if (cm && Number.isFinite(cm) && cm > 0) {
          setHeightCmInput(cm.toFixed(1));
        }
      }
    } else if (unitPreference === "lb") {
      if (!weightLb && weightKg) {
        const kilos = Number.parseFloat(weightKg);
        if (Number.isFinite(kilos) && kilos > 0) {
          setWeightLb((kilos * KG_TO_LB).toFixed(1));
        }
      }
      if (!heightFeetInput && !heightInchesInput && heightCmInput) {
        const cm = Number.parseFloat(heightCmInput);
        if (Number.isFinite(cm) && cm > 0) {
          const { feet, inches } = cmToFeetInches(cm);
          setHeightFeetInput(feet);
          setHeightInchesInput(inches);
        }
      }
    }
  }, [
    unitPreference,
    weightKg,
    weightLb,
    heightCmInput,
    heightFeetInput,
    heightInchesInput,
    cmToFeetInches,
    feetInchesToCm,
  ]);

  // Acknowledgment screen word-by-word animation
  useEffect(() => {
    if (!showAcknowledgment) return;

    const words = acknowledgmentMessage.split(' ');
    const delayBetweenBatch = 1000; // 1000ms per batch of 3 words

    // Show first batch immediately
    setVisibleWords(3);
    triggerHaptic();

    // Show 3 words at a time for remaining batches
    let batchCount = 1; // Start at 1 since we already showed first batch
    const interval = setInterval(() => {
      setVisibleWords((prev) => {
        if (prev >= words.length) {
          clearInterval(interval);
          return prev;
        }
        batchCount++;
        // Haptic with every batch
        triggerHaptic();
        return prev + 3; // Show 3 words at a time
      });
    }, delayBetweenBatch);

    return () => {
      clearInterval(interval);
    };
  }, [showAcknowledgment, acknowledgmentMessage]);

  // Welcome screen word-by-word animation
  useEffect(() => {
    if (!showWelcome) return;

    const welcomeMessage = "Welcome to MinimaLog Your journey starts here Let's customize your experience";
    const words = welcomeMessage.split(' ');
    const delayBetweenBatch = 1000; // 1000ms per batch of 3 words

    // Show first batch immediately
    setWelcomeVisibleWords(3);
    triggerHaptic();

    // Show 3 words at a time for remaining batches
    let batchCount = 1;
    const interval = setInterval(() => {
      setWelcomeVisibleWords((prev) => {
        if (prev >= words.length) {
          clearInterval(interval);
          return prev;
        }
        batchCount++;
        triggerHaptic();
        return prev + 3;
      });
    }, delayBetweenBatch);

    // After animation completes, fade out and start onboarding
    const words_length = words.length;
    const fadeInDuration = Math.ceil(words_length / 3) * 1000;
    const readingDuration = 1800;
    const fadeOutDuration = 1200;

    setTimeout(() => {
      setWelcomeFadingOut(true);
    }, fadeInDuration + readingDuration);

    setTimeout(() => {
      setShowWelcome(false);
      setWelcomeFadingOut(false);
    }, fadeInDuration + readingDuration + fadeOutDuration);

    return () => {
      clearInterval(interval);
    };
  }, [showWelcome]);

  useEffect(() => {
    if (!showCareScreen) return;

    const delayBetweenLines = 900;
    const initialTimeout = setTimeout(() => {
      setVisibleCareLines(1);
      triggerHaptic();
    }, 200);
    const interval = setInterval(() => {
      setVisibleCareLines((prev) => {
        if (prev >= careLines.length) {
          clearInterval(interval);
          return prev;
        }
        triggerHaptic();
        return prev + 1;
      });
    }, delayBetweenLines);

    const logoTimeout = setTimeout(() => {
      triggerHaptic();
      setShowLogo(true);
    }, delayBetweenLines * (careLines.length + 1));

    const timeout = setTimeout(() => {
      navigate("/loading");
    }, delayBetweenLines * (careLines.length + 1) + 2000);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
      clearTimeout(logoTimeout);
      clearTimeout(timeout);
    };
  }, [showCareScreen, navigate]);

  return (
    <>
    <div className="h-full w-full flex flex-col bg-background">
      {/* Progress bar - sticky at top */}
      <div className="sticky top-0 z-50 bg-background safe-area-top pb-4">
        <div className="w-full max-w-2xl mx-auto mt-8 px-8">
          <LiquidGlassProgressBar progress={(step / 19) * 100} />
        </div>
      </div>

      {/* Content area - allow scrolling for long questions */}
      <div className="flex-1 overflow-y-auto flex flex-col px-4">
        <div className="flex-1 flex flex-col justify-center py-6 pt-2">
          <LiquidGlassCard className="w-full max-w-2xl mx-auto p-6">

        {/* Q1: Training Time */}
        {step === 1 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 1</p>
              <h2 className="text-2xl font-bold">What time of day do you train best?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {trainingTimes.map((time, idx) => (
                <LiquidGlassOption
                  key={time.id}
                  index={idx}
                  selected={selectedTrainingTime === time.id}
                  onClick={() => handleSelectTrainingTime(time.id)}
                >
                  <h3 className="text-xl font-semibold">{time.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q2: Time Commitment */}
        {step === 2 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 2</p>
              <h2 className="text-2xl font-bold">How much time can you realistically commit per session?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {timeCommitments.map((commitment, idx) => (
                <LiquidGlassOption
                  key={commitment.id}
                  index={idx}
                  selected={selectedTimeCommitment === commitment.id}
                  onClick={() => handleSelectTimeCommitment(commitment.id)}
                >
                  <h3 className="text-xl font-semibold">{commitment.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q3: Units - MOVED HERE */}
        {step === 3 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 3</p>
              <h2 className="text-2xl font-bold">Choose Your Units</h2>
            </div>
            <div className="max-w-md mx-auto grid gap-3 pb-6">
              <LiquidGlassOption
                index={0}
                selected={unitPreference === "kg"}
                onClick={() => {
                  setUnitPreference("kg");
                  setStep(4);
                }}
              >
                <div className="text-center">
                  <h3 className="text-xl font-semibold mb-2">Metric</h3>
                  <p className="text-muted-foreground">Kilograms & Centimeters</p>
                </div>
              </LiquidGlassOption>
              <LiquidGlassOption
                index={1}
                selected={unitPreference === "lb"}
                onClick={() => {
                  setUnitPreference("lb");
                  setStep(4);
                }}
              >
                <div className="text-center">
                  <h3 className="text-xl font-semibold mb-2">Imperial</h3>
                  <p className="text-muted-foreground">Pounds & Feet/Inches</p>
                </div>
              </LiquidGlassOption>
            </div>
          </div>
        )}

        {/* Q4: Fitness Journey Stage */}
        {step === 4 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 4</p>
              <h2 className="text-2xl font-bold">Where are you in your fitness journey?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {fitnessJourneyStages.map((stage, idx) => (
                <LiquidGlassOption
                  key={stage.id}
                  index={idx}
                  selected={selectedFitnessJourneyStage === stage.id}
                  onClick={() => handleSelectFitnessJourneyStage(stage.id)}
                >
                  <h3 className="text-xl font-semibold">{stage.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q5: Training Style */}
        {step === 5 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 5</p>
              <h2 className="text-2xl font-bold">How do you train best?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {trainingStyles.map((style, idx) => (
                <LiquidGlassOption
                  key={style.id}
                  index={idx}
                  selected={selectedTrainingStyle === style.id}
                  onClick={() => handleSelectTrainingStyle(style.id)}
                >
                  <h3 className="text-xl font-semibold mb-2">{style.label}</h3>
                  <p className="text-muted-foreground">{style.description}</p>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q6: Vibe */}
        {step === 6 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 6</p>
              <h2 className="text-2xl font-bold">Choose Your Vibe</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {vibes.map((vibe, idx) => (
                <LiquidGlassOption
                  key={vibe.id}
                  index={idx}
                  selected={selectedVibe === vibe.id}
                  onClick={() => handleSelectVibe(vibe.id)}
                >
                  <h3 className="text-xl font-semibold mb-2">{vibe.label}</h3>
                  <p className="text-muted-foreground">{vibe.description}</p>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q7: Goal */}
        {step === 7 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 7</p>
              <h2 className="text-2xl font-bold">What's Your Main Goal?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {goals.map((goal, idx) => (
                <LiquidGlassOption
                  key={goal.id}
                  index={idx}
                  selected={selectedGoal === goal.id}
                  onClick={() => handleSelectGoal(goal.id)}
                >
                  <div className="text-4xl mb-2">{goal.icon}</div>
                  <h3 className="text-xl font-semibold">{goal.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q8: Tracking Style */}
        {step === 8 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 8</p>
              <h2 className="text-2xl font-bold">How Do You Track Success?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {trackingStyles.map((style, idx) => (
                <LiquidGlassOption
                  key={style.id}
                  index={idx}
                  selected={selectedTracking === style.id}
                  onClick={() => handleSelectTracking(style.id)}
                >
                  <h3 className="text-xl font-semibold mb-2">{style.label}</h3>
                  <p className="text-muted-foreground">{style.description}</p>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q9: Obstacles */}
        {step === 9 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 9</p>
              <h2 className="text-2xl font-bold">What's been your biggest obstacle?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {obstacles.map((obstacle, idx) => (
                <LiquidGlassOption
                  key={obstacle.id}
                  index={idx}
                  selected={selectedObstacle === obstacle.id}
                  onClick={() => handleSelectObstacle(obstacle.id)}
                >
                  <h3 className="text-xl font-semibold">{obstacle.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q10: Why Did You Start Lifting */}
        {step === 10 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 10</p>
              <h2 className="text-2xl font-bold">Why Did You Start Lifting?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {startReasons.map((reason, idx) => (
                <LiquidGlassOption
                  key={reason.id}
                  index={idx}
                  selected={selectedReason === reason.id}
                  onClick={() => handleSelectReason(reason.id)}
                >
                  <div className="flex items-start gap-4">
                    <span className="text-3xl leading-none">{reason.icon}</span>
                    <p className="text-base font-medium leading-relaxed">{reason.label}</p>
                  </div>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q11: Workout Feeling */}
        {step === 11 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 11</p>
              <h2 className="text-2xl font-bold">How do you want to feel after a workout?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {workoutFeelings.map((feeling, idx) => (
                <LiquidGlassOption
                  key={feeling.id}
                  index={idx}
                  selected={selectedWorkoutFeeling === feeling.id}
                  onClick={() => handleSelectWorkoutFeeling(feeling.id)}
                >
                  <h3 className="text-xl font-semibold">{feeling.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q12: Lifting Meaning */}
        {step === 12 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 12</p>
              <h2 className="text-2xl font-bold">What does lifting represent for you?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {liftingMeanings.map((meaning, idx) => (
                <LiquidGlassOption
                  key={meaning.id}
                  index={idx}
                  selected={selectedLiftingMeaning === meaning.id}
                  onClick={() => handleSelectLiftingMeaning(meaning.id)}
                >
                  <h3 className="text-xl font-semibold">{meaning.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q13: Motivation Source */}
        {step === 13 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 13</p>
              <h2 className="text-2xl font-bold">On days when you don't want to train, what usually helps?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {motivationSources.map((source, idx) => (
                <LiquidGlassOption
                  key={source.id}
                  index={idx}
                  selected={selectedMotivationSource === source.id}
                  onClick={() => handleSelectMotivationSource(source.id)}
                >
                  <h3 className="text-xl font-semibold">{source.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q14: Best Self Vision */}
        {step === 14 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 14</p>
              <h2 className="text-2xl font-bold">When you imagine your best self, what do you see?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {bestSelfVisions.map((vision, idx) => (
                <LiquidGlassOption
                  key={vision.id}
                  index={idx}
                  selected={selectedBestSelfVision === vision.id}
                  onClick={() => handleSelectBestSelfVision(vision.id)}
                >
                  <h3 className="text-xl font-semibold">{vision.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q15: One Year Goal */}
        {step === 15 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 15</p>
              <h2 className="text-2xl font-bold">One year from now, what do you hope to tell your current self?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {oneYearGoals.map((goal, idx) => (
                <LiquidGlassOption
                  key={goal.id}
                  index={idx}
                  selected={selectedOneYearGoal === goal.id}
                  onClick={() => handleSelectOneYearGoal(goal.id)}
                >
                  <h3 className="text-xl font-semibold">{goal.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q16: Pride Metric */}
        {step === 16 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 16</p>
              <h2 className="text-2xl font-bold">What would make you proud of yourself?</h2>
            </div>
            <div className="grid gap-3 pb-6">
              {prideMetrics.map((metric, idx) => (
                <LiquidGlassOption
                  key={metric.id}
                  index={idx}
                  selected={selectedPrideMetric === metric.id}
                  onClick={() => handleSelectPrideMetric(metric.id)}
                >
                  <h3 className="text-xl font-semibold">{metric.label}</h3>
                </LiquidGlassOption>
              ))}
            </div>
          </div>
        )}

        {/* Q17: Weight */}
        {step === 17 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 17</p>
              <h2 className="text-2xl font-bold">What's Your Weight?</h2>
            </div>
            <div className="max-w-md mx-auto space-y-4">
              <SmoothWheelPicker
                value={unitPreference === "kg" ? Number.parseFloat(weightKg) || 70 : Number.parseFloat(weightLb) || 150}
                min={unitPreference === "kg" ? 30 : 66}
                max={unitPreference === "kg" ? 200 : 440}
                step={unitPreference === "kg" ? 0.5 : 1}
                onChange={(val) => {
                  if (unitPreference === "kg") {
                    setWeightKg(val.toString());
                  } else {
                    setWeightLb(val.toString());
                  }
                }}
                unit={unitPreference === "kg" ? "kg" : "lbs"}
              />
              <Button
                className="w-full h-12 text-base font-semibold"
                onClick={() => {
                  const weight = unitPreference === "kg" ? Number.parseFloat(weightKg) : Number.parseFloat(weightLb);
                  if (!Number.isFinite(weight) || weight <= 0) {
                    toast({
                      title: "Enter your weight",
                      description: "Please select a valid weight to continue.",
                      variant: "destructive",
                    });
                    return;
                  }
                  triggerHaptic();
                  setStep(18);
                }}
                disabled={completing}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Q18: Height */}
        {step === 18 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 18</p>
              <h2 className="text-2xl font-bold">What's Your Height?</h2>
            </div>
            <div className="max-w-md mx-auto space-y-4">
              {unitPreference === "kg" ? (
                <SmoothWheelPicker
                  value={Number.parseFloat(heightCmInput) || 175}
                  min={140}
                  max={220}
                  step={1}
                  onChange={(val) => setHeightCmInput(val.toString())}
                  unit="cm"
                />
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-center text-sm text-muted-foreground mb-2">Feet</p>
                    <SmoothWheelPicker
                      value={Number.parseInt(heightFeetInput) || 5}
                      min={4}
                      max={7}
                      step={1}
                      onChange={(val) => setHeightFeetInput(val.toString())}
                      unit="ft"
                    />
                  </div>
                  <div>
                    <p className="text-center text-sm text-muted-foreground mb-2">Inches</p>
                    <SmoothWheelPicker
                      value={Number.parseInt(heightInchesInput) || 10}
                      min={0}
                      max={11}
                      step={1}
                      onChange={(val) => setHeightInchesInput(val.toString())}
                      unit="in"
                    />
                  </div>
                </div>
              )}
              <Button
                className="w-full h-12 text-base font-semibold mt-8"
                onClick={() => {
                  const heightCm = unitPreference === "kg"
                    ? Number.parseFloat(heightCmInput)
                    : feetInchesToCm(heightFeetInput, heightInchesInput);
                  if (!Number.isFinite(heightCm ?? NaN) || (heightCm ?? 0) <= 0) {
                    toast({
                      title: "Enter your height",
                      description: "Please select a valid height to continue.",
                      variant: "destructive",
                    });
                    return;
                  }
                  triggerHaptic();
                  setStep(19);
                }}
                disabled={completing}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {/* Q19: Username */}
        {step === 19 && (
          <div className="flex-1 flex flex-col justify-start">
            <div className="text-center mb-8">
              <p className="text-sm font-medium text-muted-foreground mb-2">Question 19</p>
              <h2 className="text-2xl font-bold">Pick Your Display Name</h2>
            </div>
            <div className="max-w-md mx-auto w-full space-y-3">
              <div className="space-y-2 text-left">
                <Label htmlFor="onboarding-username" className="text-sm font-medium text-muted-foreground">
                  Username
                </Label>
                <Input
                  id="onboarding-username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="letters and numbers only"
                  autoCapitalize="none"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={20}
                  enterKeyHint="done"
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      finishOnboarding();
                    }
                  }}
                  className="h-12 text-base"
                />
              </div>
              <p className="text-xs text-muted-foreground">3-20 characters · letters and numbers only</p>
              {usernameError && (
                <p className="text-sm text-destructive" role="alert">
                  {usernameError}
                </p>
              )}
              <Button
                className="w-full h-12 text-base font-semibold"
                disabled={!usernameValidation.success || completing}
                onClick={finishOnboarding}
              >
                Let's Begin
              </Button>
            </div>
          </div>
        )}
          </LiquidGlassCard>
        </div>
      </div>

    </div>

    {/* Welcome Screen */}
    {showWelcome && (
      <div className={`fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gray-100 dark:bg-zinc-900 px-8 transition-[opacity_1.2s_ease-out] ${
        welcomeFadingOut ? 'opacity-0' : 'opacity-100'
      }`}>
        {/* Logo and Branding */}
        <div className={`mb-12 space-y-4 transition-all duration-500 ease-out ${
          welcomeVisibleWords > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="flex justify-center">
            <div className="h-28 w-28 rounded-full bg-primary flex items-center justify-center">
              <Dumbbell className="h-14 w-14 text-primary-foreground" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold leading-none pb-1 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              MinimaLog
            </h1>
            <p className="text-lg text-muted-foreground font-light">
              You log, We track
            </p>
          </div>
        </div>

        {/* Message */}
        <div className="text-center max-w-3xl">
          <p className="text-4xl md:text-5xl font-black text-black dark:text-white leading-relaxed">
            {"Welcome to MinimaLog Your journey starts here Let's customize your experience".split(' ').map((word, index) => (
              <span
                key={index}
                className={`inline-block transition-all duration-500 ease-out ${
                  index < welcomeVisibleWords ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
                } mr-2`}
              >
                {word}
              </span>
            ))}
          </p>
        </div>
      </div>
    )}

    {/* Acknowledgment Screen */}
    {showAcknowledgment && (
      <div className={`fixed inset-0 z-[999] flex flex-col items-center justify-center bg-gray-100 dark:bg-zinc-900 px-8 transition-[opacity_1.2s_ease-out] ${
        acknowledgmentFadingOut ? 'opacity-0' : 'opacity-100'
      }`}>
        {/* Logo and Branding */}
        <div className={`mb-12 space-y-4 transition-all duration-500 ease-out ${
          visibleWords > 0 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'
        }`}>
          <div className="flex justify-center">
            <div className="h-28 w-28 rounded-full bg-primary flex items-center justify-center">
              <Dumbbell className="h-14 w-14 text-primary-foreground" />
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-3xl font-bold leading-none pb-1 bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
              MinimaLog
            </h1>
            <p className="text-lg text-muted-foreground font-light">
              You log, We track
            </p>
          </div>
        </div>

        {/* Message */}
        <div className="text-center max-w-3xl">
          <p className="text-4xl md:text-5xl font-black text-black dark:text-white leading-relaxed">
            {acknowledgmentMessage.split(' ').map((word, index) => (
              <span
                key={index}
                className={`inline-block transition-all duration-500 ease-out ${
                  index < visibleWords ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-8'
                } mr-2`}
              >
                {word}
              </span>
            ))}
          </p>
        </div>
      </div>
    )}

    {showCareScreen && (
      <div className="fixed inset-0 z-[999] flex flex-col bg-white dark:bg-black px-8">
        <div className="flex-1 flex flex-col items-start justify-center space-y-4 text-left pt-16">
          {careLines.map((line, index) => (
            <p
              key={line}
              className={`text-4xl font-bold text-black dark:text-white transition-all duration-700 ease-out transform ${
                index < visibleCareLines ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
              }`}
            >
              {line}
            </p>
          ))}
        </div>
        <div className="flex justify-center pb-12">
          <div
            className={`flex flex-col items-center gap-4 transition-all duration-700 ease-out ${
              showLogo ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
            }`}
          >
            <div className="h-24 w-24 rounded-full bg-primary flex items-center justify-center animate-pulse">
              <Dumbbell className="h-12 w-12 text-primary-foreground" />
            </div>
            <div className="text-center space-y-2">
              <h1 className="text-5xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
                MinimaLog
              </h1>
              <p className="text-sm uppercase tracking-[0.4em] text-muted-foreground">
                You log · We track
              </p>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
  );
};

export default Onboarding;
