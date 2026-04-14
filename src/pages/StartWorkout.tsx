console.log("FILE LOADED: StartWorkout.tsx");
import React, { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import TemplatePicker, { TemplateSummary } from "@/components/TemplatePicker";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Paywall } from "@/components/Paywall";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseSession, getCachedUserId } from "@/lib/session";
import { cn, generateUUID } from "@/lib/utils";
import {
  startLiveActivity,
  setLiveActivitiesMetadata,
  setLiveActivitiesWorkoutId,
} from "@/lib/liveActivity";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Dumbbell,
  Library,
  Loader2,
  PlusCircle,
  Moon,
  Zap,
  FlaskConical,
  Smile,
} from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { LiveActivities } from "@/lib/native-live-activities";
import { shouldUseOfflineMode } from "@/lib/network";
import { queueOperation } from "@/lib/db/operationQueue";
import { getDB } from "@/lib/db/indexedDB";
import { getTemplateByIdOffline, cacheTemplates } from "@/lib/cache/templateCache";
import { getUserPreferredUnit } from "@/lib/cache/userProfileCache";
import { nameSupportsUnilateralToggle } from "@/data/gymExercises";
import { stripUnilateralSuffix } from "@/pages/WorkoutSession/utils/unilateralNames";
import { vLog } from "@/components/VisualDebugLogger";

type SorenessArea = "none" | "upper" | "lower" | "full";

type CheckInResponses = {
  sleepQuality: number | null;
  preWorkoutTaken: boolean | null;
  sorenessArea: SorenessArea | null;
  energyLevel: number | null;
};

type CheckInOptionValue = number | boolean | SorenessArea;

type CheckInOption = {
  value: CheckInOptionValue;
  label: string;
  helper?: string;
};

type CheckInStepKey = keyof CheckInResponses;

type CheckInStepConfig = {
  key: CheckInStepKey;
  title: string;
  description?: string;
  type: "scale" | "binary" | "options";
  options: CheckInOption[];
};

type TemplateExerciseRow = {
  id: string;
  order_index: number | null;
  exercise_id: string;
  is_unilateral: boolean | null;
  exercises: {
    id: string;
    name: string;
    equipment: string | null;
    muscle_group: string | null;
    body_part: string | null;
    is_bodyweight: boolean | null;
    base_exercise_id: string | null;
    owner_user_id: string | null;
    image_url: string | null;
  } | null;
};

type TemplateExerciseDetails = {
  templateExerciseId: string;
  exerciseId: string;
  orderIndex: number;
  isUnilateral: boolean | null;
  exercise: TemplateExerciseRow["exercises"];
};

type TemplateWithExercises = TemplateSummary & {
  exercises: TemplateExerciseDetails[];
};

type SummaryItem = {
  key: string;
  label: string;
  value: string;
  helper?: string | null;
  icon: LucideIcon;
  active: boolean;
};

const INITIAL_CHECK_IN: CheckInResponses = {
  sleepQuality: null,
  preWorkoutTaken: null,
  sorenessArea: null,
  energyLevel: null,
};

const CHECK_IN_STEPS: CheckInStepConfig[] = [
  {
    key: "sleepQuality",
    title: "How did you sleep last night?",
    description: "1 = rough night, 5 = out like a light.",
    type: "scale",
    options: [
      { value: 1, label: "1", helper: "Rough" },
      { value: 2, label: "2", helper: "Restless" },
      { value: 3, label: "3", helper: "Okay" },
      { value: 4, label: "4", helper: "Solid" },
      { value: 5, label: "5", helper: "Great" },
    ],
  },
  {
    key: "preWorkoutTaken",
    title: "Did you take pre-workout?",
    type: "binary",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  },
  {
    key: "sorenessArea",
    title: "Any soreness today?",
    description: "Pick what stands out the most.",
    type: "options",
    options: [
      { value: "none", label: "Feeling fresh" },
      { value: "upper", label: "Upper body" },
      { value: "lower", label: "Lower body" },
      { value: "full", label: "Full body" },
    ],
  },
  {
    key: "energyLevel",
    title: "How's your energy level?",
    description: "1 = running on fumes, 5 = unstoppable.",
    type: "scale",
    options: [
      { value: 1, label: "1", helper: "Low" },
      { value: 2, label: "2", helper: "Below avg" },
      { value: 3, label: "3", helper: "Steady" },
      { value: 4, label: "4", helper: "Charged" },
      { value: 5, label: "5", helper: "Peak" },
    ],
  },
];

// Cache step options lookup for O(1) access instead of repeated .find() calls
const STEP_OPTIONS_MAP = new Map<CheckInStepKey, CheckInOption[]>(
  CHECK_IN_STEPS.map((step) => [step.key, step.options])
);

// Cache option value lookups with Maps for O(1) access
const OPTION_VALUE_MAPS = new Map<CheckInStepKey, Map<CheckInOptionValue, CheckInOption>>(
  CHECK_IN_STEPS.map((step) => [
    step.key,
    new Map(step.options.map((option) => [option.value, option])),
  ])
);

const stripUnilateralSuffix = (name: string) => name.replace(/\s*\(Unilateral\)$/i, "").trim();

const WORKOUT_SESSION_CACHE_KEY = "weightstone:workout-session-cache:v1";
const HOME_SUPPRESSED_STORAGE_KEY = "weightstone:suppressed-active-workouts";

const isWorkoutSuppressed = (workoutId: string): boolean => {
  if (typeof window === "undefined") return false;

  try {
    const stored = window.sessionStorage.getItem(HOME_SUPPRESSED_STORAGE_KEY);
    if (!stored) return false;

    const entries = JSON.parse(stored);
    if (!Array.isArray(entries)) return false;

    const now = Date.now();
    return entries.some(
      (entry: any) =>
        Array.isArray(entry) &&
        typeof entry[0] === "string" &&
        typeof entry[1] === "number" &&
        entry[0] === workoutId &&
        entry[1] > now
    );
  } catch (error) {
    if (import.meta.env.DEV) {
      console.warn("[StartWorkout] Failed to read suppressed workouts:", error);
    }
    return false;
  }
};

const getValidTemplateExercises = (template: TemplateWithExercises | null) => {
  if (!template) return [];
  return template.exercises
    .filter((item) => item.exercise && item.exerciseId)
    .map((item) => ({
      templateExerciseId: item.templateExerciseId,
      exerciseId: item.exerciseId,
      orderIndex: typeof item.orderIndex === "number" ? item.orderIndex : 0,
      isUnilateral: item.isUnilateral,
      exercise: item.exercise!,
    }));
};

const writeCachedWorkoutSession = (
  userId: string,
  workoutId: string,
  payload: {
    exercises: any[];
    currentUnit: string;
    workoutStartedAt: string;
    checkIn?: {
      responses: CheckInResponses;
      completedAt: string;
      templateId: string | null;
      templateName: string | null;
    };
  },
) => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(WORKOUT_SESSION_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const base = parsed && typeof parsed === "object" && parsed !== null ? parsed : {};
    const userCache = base[userId] && typeof base[userId] === "object" ? base[userId] : {};
    const nextUserCache = {
      ...userCache,
      [workoutId]: {
        exercises: payload.exercises,
        currentUnit: payload.currentUnit,
        workoutStartedAt: payload.workoutStartedAt,
        preSessionCheckIn: payload.checkIn ?? null,
        updatedAt: new Date().toISOString(),
      },
    };
    const next = { ...base, [userId]: nextUserCache };
    window.localStorage.setItem(WORKOUT_SESSION_CACHE_KEY, JSON.stringify(next));
  } catch (error) {
    console.warn("Failed to cache workout session", error);
  }
};

/**
 * Ensures a unilateral exercise variant exists for the given base exercise.
 * Creates one if it doesn't exist.
 */
const ensureUnilateralExercise = async (baseExercise: any, userId: string) => {
  const baseExerciseId = baseExercise.base_exercise_id ?? baseExercise.id;
  if (!baseExerciseId) throw new Error("Missing base exercise id");

  const baseName = stripUnilateralSuffix(baseExercise.name);
  const unilateralName = `${baseName} (Unilateral)`;

  // In offline mode, try to find unilateral variant in IndexedDB first
  const isOffline = shouldUseOfflineMode();
  if (isOffline) {
    try {
      const db = await getDB();
      const exercises = await db.getAll('exercises');
      const existingUnilateral = exercises.find(
        (ex: any) =>
          ex.data?.owner_user_id === userId &&
          ex.data?.base_exercise_id === baseExerciseId &&
          ex.data?.is_unilateral === true
      );

      if (existingUnilateral) {
        return existingUnilateral.data;
      }

      // If not found in IndexedDB, create a temporary unilateral variant
      // This will be synced to Supabase later when online
      const tempUnilateralId = `temp-unilateral-${baseExerciseId}-${Date.now()}`;
      const tempUnilateral = {
        id: tempUnilateralId,
        owner_user_id: userId,
        name: unilateralName,
        equipment: baseExercise.equipment ?? null,
        muscle_group: baseExercise.muscle_group ?? null,
        body_part: baseExercise.body_part ?? null,
        is_bodyweight: baseExercise.is_bodyweight ?? false,
        is_unilateral: true,
        base_exercise_id: baseExerciseId,
        image_url: baseExercise.image_url ?? null,
      };

      // Store in IndexedDB for future offline use
      await db.put('exercises', {
        id: tempUnilateralId,
        userId,
        data: tempUnilateral,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        synced: false,
        deleted: false,
      });

      // Queue the exercise creation for when we're back online
      await queueOperation({
        type: 'insert',
        table: 'exercises',
        data: {
          id: tempUnilateralId,
          owner_user_id: userId,
          name: unilateralName,
          equipment: baseExercise.equipment ?? null,
          muscle_group: baseExercise.muscle_group ?? null,
          body_part: baseExercise.body_part ?? null,
          is_bodyweight: baseExercise.is_bodyweight ?? false,
          is_unilateral: true,
          base_exercise_id: baseExerciseId,
          image_url: baseExercise.image_url ?? null,
        },
        timestamp: new Date().toISOString(),
        userId,
      });

      return tempUnilateral;
    } catch (error) {
      console.error('[ensureUnilateralExercise] Offline creation failed, falling back to bilateral:', error);
      // Fall back to using the base exercise (bilateral) instead of throwing
      // This allows the workout to start even if unilateral creation fails
      return baseExercise;
    }
  }

  // ONLINE MODE: Use Supabase
  // Check if unilateral variant already exists
  const { data: existing, error: fetchError } = await supabase
    .from("exercises")
    .select(
      "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
    )
    .eq("owner_user_id", userId)
    .eq("base_exercise_id", baseExerciseId)
    .eq("is_unilateral", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (fetchError && fetchError.code !== "PGRST116") {
    throw fetchError;
  }

  if (existing) {
    return existing;
  }

  // Create new unilateral variant
  const insertPayload = {
    owner_user_id: userId,
    name: unilateralName,
    equipment: baseExercise.equipment ?? null,
    muscle_group: baseExercise.muscle_group ?? null,
    body_part: baseExercise.body_part ?? null,
    is_bodyweight: baseExercise.is_bodyweight ?? false,
    is_unilateral: true,
    base_exercise_id: baseExerciseId,
    image_url: baseExercise.image_url ?? null,
  };

  const { data: inserted, error: insertError } = await supabase
    .from("exercises")
    .insert(insertPayload)
    .select(
      "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
    )
    .single();

  if (insertError) {
    // Handle race condition (another request created it simultaneously)
    if (insertError.code === "23505" || insertError.details?.includes("already exists")) {
      const { data: retry } = await supabase
        .from("exercises")
        .select(
          "id,name,equipment,muscle_group,body_part,is_bodyweight,owner_user_id,is_unilateral,base_exercise_id,image_url"
        )
        .eq("owner_user_id", userId)
        .eq("base_exercise_id", baseExerciseId)
        .eq("is_unilateral", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (retry) return retry;
    }
    throw insertError;
  }

  return inserted;
};

const buildCachedExercisesFromTemplate = async (template: TemplateWithExercises, workoutId: string, userId: string) => {
  vLog.info('buildCachedExercises', 'Building exercise list from template', {
    templateName: template.name,
    exerciseCount: template.exercises.length,
    workoutId
  });

  const exercises = getValidTemplateExercises(template);
  const sortedExercises = exercises.sort((a, b) => a.orderIndex - b.orderIndex);

  vLog.info('buildCachedExercises', `Processing ${sortedExercises.length} exercises...`, {});

  // Use Promise.all to handle async operations for unilateral exercises
  const result = await Promise.all(
    sortedExercises.map(async (item, index) => {
      const exercise = item.exercise;
      const baseExerciseId = exercise.base_exercise_id ?? exercise.id;
      // Check if exercise has the capability to be unilateral based on its name/equipment
      const exerciseSupportsUnilateral = nameSupportsUnilateralToggle(exercise.name);
      // Respect the template's saved bilateral/unilateral preference
      const isUnilateral = Boolean(item.isUnilateral);

      // Debug logging to verify template preference is being read correctly
      console.log('[buildCachedExercisesFromTemplate] Exercise:', {
        name: exercise.name,
        templateIsUnilateral: item.isUnilateral,
        coercedIsUnilateral: isUnilateral,
        supportsUnilateral: exerciseSupportsUnilateral,
      });

      // If template specifies unilateral, get/create the unilateral variant
      let actualExercise = exercise;
      if (isUnilateral) {
        try {
          const unilateralExercise = await ensureUnilateralExercise(exercise, userId);
          actualExercise = {
            ...exercise,
            id: unilateralExercise.id,
            name: unilateralExercise.name,
            is_unilateral: true,
          };
        } catch (error) {
          console.error("Failed to ensure unilateral exercise, falling back to bilateral:", error);
          // Fall back to bilateral if unilateral creation fails
        }
      }

      return {
        id: `${workoutId}-template-${index}`,
        exercise_id: actualExercise.id,
        order_index: item.orderIndex ?? index,
        exercise: {
          id: actualExercise.id,
          name: actualExercise.name,
          equipment: actualExercise.equipment,
          muscle_group: actualExercise.muscle_group,
          body_part: actualExercise.body_part,
          is_bodyweight: Boolean(actualExercise.is_bodyweight),
          origin: "remote" as const,
          seedId: undefined,
          is_unilateral: isUnilateral,
          base_exercise_id: actualExercise.base_exercise_id ?? baseExerciseId,
          owner_user_id: actualExercise.owner_user_id,
          supportsUnilateral: exerciseSupportsUnilateral,
          forceUnilateral: false, // Don't force unilateral, allow toggling
          image_url: actualExercise.image_url ?? null,
        },
        sets: [],
        lastSessionWeight: undefined,
        lastSessionSets: [],
        baseExerciseId,
        isUnilateral,
        baseExerciseInfo: {
          id: baseExerciseId,
          name: stripUnilateralSuffix(exercise.name),
          equipment: exercise.equipment,
          muscle_group: exercise.muscle_group,
          body_part: exercise.body_part,
          is_bodyweight: Boolean(exercise.is_bodyweight),
          supabaseId: baseExerciseId,
          origin: "remote" as const,
          is_unilateral: false,
          base_exercise_id: exercise.base_exercise_id,
          owner_user_id: exercise.owner_user_id,
          seedId: undefined,
          forceUnilateral: false, // Base exercise is bilateral
          supportsUnilateral: exerciseSupportsUnilateral,
          image_url: exercise.image_url ?? null,
        },
        togglePending: false,
      };
    })
  );

  vLog.success('buildCachedExercises', '✓ Exercise list built successfully', { count: result.length });
  return result;
};

const fetchTemplateWithExercises = async (summary: TemplateSummary): Promise<TemplateWithExercises> => {
  const useOffline = shouldUseOfflineMode();

  if (useOffline) {
    // OFFLINE: Load from IndexedDB
    console.log('[StartWorkout] Loading template offline from IndexedDB:', summary.id);
    const cachedTemplate = await getTemplateByIdOffline(summary.id);

    if (!cachedTemplate) {
      throw new Error('Template not available offline');
    }

    // Transform cached template to expected format
    const exercises = (cachedTemplate.template_exercises || []).map((te: any) => ({
      templateExerciseId: te.id,
      exerciseId: te.exercise_id,
      orderIndex: te.order_index ?? 0,
      isUnilateral: te.is_unilateral,
      exercise: te.exercise,
    }));

    return {
      ...summary,
      exercises,
    };
  }

  // ONLINE: Load from Supabase
  const { data, error } = await supabase
    .from("template_exercises")
    .select(
      `
        id,
        order_index,
        exercise_id,
        is_unilateral,
        exercises (
          id,
          name,
          equipment,
          muscle_group,
          body_part,
          is_bodyweight,
          base_exercise_id,
          owner_user_id,
          image_url
        )
      `,
    )
    .eq("template_id", summary.id)
    .order("order_index", { ascending: true });

  if (error) {
    throw error;
  }

  const rows = (data ?? []) as TemplateExerciseRow[];

  return {
    ...summary,
    exercises: rows.map((row) => ({
      templateExerciseId: row.id,
      exerciseId: row.exercise_id,
      orderIndex: row.order_index ?? 0,
      isUnilateral: row.is_unilateral,
      exercise: row.exercises,
    })),
  };
};

// Memoized summary card component to prevent unnecessary re-renders
const SummaryCard = React.memo<{ item: SummaryItem }>(({ item }) => {
  const Icon = item.icon;
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-[16px] border px-2.5 py-2 shadow-[0_16px_65px_-48px_rgba(15,23,42,0.75)] transition-colors duration-200",
        item.active
          ? "border-primary/40 bg-primary/[0.12] text-foreground dark:border-primary/40 dark:bg-primary/[0.18]"
          : "border-white/35 bg-white/80 text-foreground/70 dark:border-white/15 dark:bg-white/10 dark:text-white/75",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-foreground/60 dark:text-white/60">
        <Icon className="h-3 w-3" />
        <span>{item.label}</span>
      </div>
      <div
        className={cn(
          "text-base font-semibold sm:text-xl",
          item.active
            ? "text-foreground dark:text-white"
            : "text-foreground/60 dark:text-white/60",
        )}
      >
        {item.value}
      </div>
      {item.helper ? (
        <span className="text-[10px] text-foreground/55 dark:text-white/55">{item.helper}</span>
      ) : null}
    </div>
  );
});

SummaryCard.displayName = "SummaryCard";

const StartWorkout = () => {
  const navigate = useNavigate();
  const { toast } = useToast();

  // Subscription state
  const { isPremium, canCreateWorkout, workoutCountThisMonth } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallFeature, setPaywallFeature] = useState("");

  const [activeView, setActiveView] = useState<"landing" | "check-in">("landing");
  const [checkInStep, setCheckInStep] = useState(0);
  const [checkInResponses, setCheckInResponses] = useState<CheckInResponses>(INITIAL_CHECK_IN);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [templateSummary, setTemplateSummary] = useState<TemplateSummary | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateWithExercises | null>(null);
  const [isTemplateLoading, setIsTemplateLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sliderValue, setSliderValue] = useState<number>(3);
  const [isTransitioning, setIsTransitioning] = useState(false);

  const totalSteps = CHECK_IN_STEPS.length;
  const progress = useMemo(() => ((checkInStep + 1) / totalSteps) * 100, [checkInStep, totalSteps]);

  const startCheckInFlow = () => {
    setCheckInResponses(INITIAL_CHECK_IN);
    setCheckInStep(0);
    setActiveView("check-in");
  };

  const handleStartEmptyWorkout = () => {
    if (loading) return;
    setTemplateSummary(null);
    setSelectedTemplate(null);
    startCheckInFlow();
  };

  const handleTemplateSelect = async (template: TemplateSummary) => {
    setTemplateSummary(template);
    setSelectedTemplate(null);
    setShowTemplatePicker(false);
    startCheckInFlow();

    setIsTemplateLoading(true);
    try {
      const detailedTemplate = await fetchTemplateWithExercises(template);
      setSelectedTemplate(detailedTemplate);

      // Cache the user's templates in background if online
      const session = await getSupabaseSession();
      if (session?.user && !shouldUseOfflineMode()) {
        cacheTemplates(session.user.id).catch(err =>
          console.warn('[StartWorkout] Failed to cache templates:', err)
        );
      }
    } catch (error: any) {
      console.error("Failed to hydrate template", error);

      const isOfflineError =
        error.message === 'Template not available offline' ||
        error.message?.toLowerCase().includes('failed to fetch') ||
        error.message?.toLowerCase().includes('network');

      toast({
        title: "Template unavailable",
        description: isOfflineError
          ? "This template isn't cached for offline use yet."
          : "We'll start a fresh workout instead.",
        variant: "destructive",
      });
      setTemplateSummary(null);
      setSelectedTemplate(null);
    } finally {
      setIsTemplateLoading(false);
    }
  };

  const handleCreateTemplate = () => {
    navigate("/create-template");
  };

  const activeStep = useMemo(() => CHECK_IN_STEPS[checkInStep], [checkInStep]);
  const selectedValue = useMemo(() => checkInResponses[activeStep.key], [checkInResponses, activeStep.key]);
  const templateReady = useMemo(
    () => !templateSummary || (!isTemplateLoading && Boolean(selectedTemplate)),
    [templateSummary, isTemplateLoading, selectedTemplate]
  );

  const summaryItems = useMemo<SummaryItem[]>(() => {
    // Use cached Maps for O(1) lookups instead of repeated .find() calls
    const sleepValueMap = OPTION_VALUE_MAPS.get("sleepQuality");
    const energyValueMap = OPTION_VALUE_MAPS.get("energyLevel");
    const sorenessValueMap = OPTION_VALUE_MAPS.get("sorenessArea");

    const sleepOption =
      typeof checkInResponses.sleepQuality === "number" && sleepValueMap
        ? sleepValueMap.get(checkInResponses.sleepQuality)
        : undefined;
    const energyOption =
      typeof checkInResponses.energyLevel === "number" && energyValueMap
        ? energyValueMap.get(checkInResponses.energyLevel)
        : undefined;
    const sorenessOption =
      checkInResponses.sorenessArea && sorenessValueMap
        ? sorenessValueMap.get(checkInResponses.sorenessArea)
        : undefined;

    const sorenessValue =
      checkInResponses.sorenessArea === null
        ? "—"
        : checkInResponses.sorenessArea === "none"
        ? "All clear"
        : sorenessOption?.label ?? "—";

    return [
      {
        key: "sleep",
        label: "Sleep",
        value:
          typeof checkInResponses.sleepQuality === "number"
            ? `${checkInResponses.sleepQuality}/5`
            : "—",
        helper: sleepOption?.helper ?? null,
        icon: Moon,
        active: typeof checkInResponses.sleepQuality === "number",
      },
      {
        key: "energy",
        label: "Energy",
        value:
          typeof checkInResponses.energyLevel === "number"
            ? `${checkInResponses.energyLevel}/5`
            : "—",
        helper: energyOption?.helper ?? null,
        icon: Zap,
        active: typeof checkInResponses.energyLevel === "number",
      },
      {
        key: "preworkout",
        label: "Pre-workout",
        value:
          checkInResponses.preWorkoutTaken === null
            ? "—"
            : checkInResponses.preWorkoutTaken
            ? "Yes"
            : "No",
        helper: null,
        icon: FlaskConical,
        active: checkInResponses.preWorkoutTaken !== null,
      },
      {
        key: "soreness",
        label: "Feeling fresh",
        value: sorenessValue,
        helper:
          checkInResponses.sorenessArea === "none" && sorenessOption?.label
            ? sorenessOption.label
            : null,
        icon: Smile,
        active: Boolean(checkInResponses.sorenessArea),
      },
    ];
  }, [checkInResponses]);

  const hasSelection = useMemo(() => {
    if (activeStep.type === "scale") {
      return typeof sliderValue === "number" && sliderValue >= 1 && sliderValue <= 5;
    }
    return selectedValue !== null && selectedValue !== undefined;
  }, [activeStep.type, sliderValue, selectedValue]);

  // Initialize slider value when changing to a scale question
  useEffect(() => {
    if (activeStep.type === "scale") {
      const committedValue = (selectedValue as number | null) ?? 3;
      setSliderValue(committedValue);
    }
  }, [activeStep.key]); // Only run when step changes, not on every value change

  // Memoize slider descriptor to avoid repeated .find() calls during render
  const sliderDescriptor = useMemo(() => {
    if (activeStep.type !== "scale") return null;
    const optionValueMap = OPTION_VALUE_MAPS.get(activeStep.key);
    return optionValueMap?.get(sliderValue)?.helper ?? null;
  }, [activeStep.type, activeStep.key, sliderValue]);

  const handleSelectOption = (value: CheckInOptionValue, advanceOnSelect = true) => {
    if (loading) return checkInResponses;

    // Trigger haptic feedback
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    }

    const nextResponses: CheckInResponses = (() => {
      if (activeStep.key === "sleepQuality") {
        return { ...checkInResponses, sleepQuality: Number(value) };
      }
      if (activeStep.key === "energyLevel") {
        return { ...checkInResponses, energyLevel: Number(value) };
      }
      if (activeStep.key === "preWorkoutTaken") {
        return { ...checkInResponses, preWorkoutTaken: Boolean(value) };
      }
      if (activeStep.key === "sorenessArea") {
        return { ...checkInResponses, sorenessArea: value as SorenessArea };
      }
      return checkInResponses;
    })();

    setCheckInResponses(nextResponses);

    if (!advanceOnSelect) {
      return nextResponses;
    }

    if (checkInStep === totalSteps - 1) {
      if (!templateReady) {
        toast({
          title: "One sec…",
          description: "We’re still loading your template. Try again in a moment.",
        });
        return;
      }
      void beginWorkout(selectedTemplate, nextResponses);
      return nextResponses;
    }

    setIsTransitioning(true);
    setTimeout(() => {
      setCheckInStep((prev) => Math.min(prev + 1, totalSteps - 1));
      setIsTransitioning(false);
    }, 50);

    return nextResponses;
  };

  const handleContinue = () => {
    if (loading) return;

    let nextResponses = checkInResponses;

    if (activeStep.type === "scale") {
      nextResponses = handleSelectOption(sliderValue, false);
    }

    if (checkInStep === totalSteps - 1) {
      if (!templateReady) {
        toast({
          title: "One sec…",
          description: "We’re still loading your template. Try again in a moment.",
        });
        return;
      }

      void beginWorkout(selectedTemplate, nextResponses);
      return;
    }

    setIsTransitioning(true);
    setTimeout(() => {
      setCheckInStep((prev) => Math.min(prev + 1, totalSteps - 1));
      setIsTransitioning(false);
    }, 50);
  };

  const normalizeSorenessArea = (value: SorenessArea | null): SorenessArea | null => {
    if (!value) return null;
    const normalized = value.toLowerCase() as SorenessArea;
    return ["none", "upper", "lower", "full"].includes(normalized) ? normalized : null;
  };

  const savePreSessionMetrics = async (workoutId: string, responses: CheckInResponses) => {
    const { sleepQuality, energyLevel, preWorkoutTaken, sorenessArea } = responses;
    const normalizedSoreness = normalizeSorenessArea(sorenessArea);
    if (
      sleepQuality === null &&
      energyLevel === null &&
      preWorkoutTaken === null &&
      !normalizedSoreness
    ) {
      return;
    }

    try {
      const { data: existingMetrics, error: fetchError } = await supabase
        .from("session_metrics")
        .select("id")
        .eq("workout_id", workoutId)
        .maybeSingle();

      if (fetchError && fetchError.code !== "PGRST116") {
        throw fetchError;
      }

      const updateFields: Record<string, any> = {};
      if (sleepQuality !== null) {
        updateFields.sleep = sleepQuality;
      }
      if (energyLevel !== null) {
        updateFields.mood = energyLevel;
      }
      if (preWorkoutTaken !== null) {
        updateFields.preworkout = preWorkoutTaken;
      }
      if (normalizedSoreness !== null) {
        updateFields.soreness_area = normalizedSoreness;
      }

      if (Object.keys(updateFields).length === 0) {
        return;
      }

      if (existingMetrics?.id) {
        const { error: updateError } = await supabase
          .from("session_metrics")
          .update(updateFields)
          .eq("id", existingMetrics.id);

        if (updateError) {
          throw updateError;
        }
      } else {
        const insertPayload: Record<string, any> = {
          workout_id: workoutId,
          sleep: sleepQuality ?? null,
          mood: energyLevel ?? null,
          preworkout: preWorkoutTaken ?? false,
          soreness_area: normalizedSoreness ?? null,
        };

        const { error: insertError } = await supabase
          .from("session_metrics")
          .insert(insertPayload);

        if (insertError) {
          throw insertError;
        }
      }
    } catch (error) {
      console.error("Failed to save pre-session metrics", error);
      toast({
        title: "Metrics not saved",
        description: "We'll keep going without them.",
        variant: "destructive",
      });
    }
  };

  const getActiveWorkoutId = async (userId: string) => {
    const isOffline = shouldUseOfflineMode();

    // Offline mode: check IndexedDB for unsynced active workouts
    if (isOffline) {
      try {
        const db = await getDB();
        const allWorkouts = await db.getAllFromIndex('workouts', 'by-user', userId);

        // Find workout that hasn't ended and isn't deleted
        const activeWorkout = allWorkouts.find(
          (w) => !w.data.endedAt && !w.deleted
        );

        if (activeWorkout) {
          // Check if this workout has an associated post
          // A workout with a post should NEVER be considered "in progress"
          try {
            const allPosts = await db.getAllFromIndex('pendingPosts', 'by-user', userId);
            const hasPost = allPosts.some(post => post.workoutId === activeWorkout.id);

            if (hasPost) {
              console.log('[StartWorkout] Workout has associated post, not active:', activeWorkout.id);
              return null;
            }
          } catch (postError) {
            console.error('[StartWorkout] Failed to check posts, continuing:', postError);
            // Continue with normal flow if post check fails
          }

          if (isWorkoutSuppressed(activeWorkout.id)) {
            console.log('[StartWorkout] Active workout suppressed (offline cache):', activeWorkout.id);
            return null;
          }
          console.log('[StartWorkout] Found active workout in offline cache:', activeWorkout.id);
          return activeWorkout.id;
        }

        return null;
      } catch (error) {
        console.error('[StartWorkout] Failed to check offline workouts:', error);
        return null;
      }
    }

    // Online mode: check Supabase for active workouts
    // Exclude workouts that have posts (posted workouts should never be "in progress")
    const { data: allActiveWorkouts, error } = await supabase
      .from("workouts")
      .select("id")
      .eq("user_id", userId)
      .is("ended_at", null);

    if (error && error.code !== "PGRST116") {
      throw error;
    }

    if (allActiveWorkouts && allActiveWorkouts.length > 0) {
      // Filter out workouts that have associated posts
      for (const workout of allActiveWorkouts) {
        if (isWorkoutSuppressed(workout.id)) {
          console.log('[StartWorkout] Active workout suppressed (server):', workout.id);
          continue;
        }

        // Check if this workout has a post - with error handling
        try {
          const { data: postCheck, error: postError } = await supabase
            .from("posts")
            .select("id")
            .eq("workout_id", workout.id)
            .maybeSingle();

          if (postError) {
            console.error('[StartWorkout] Error checking for post:', postError);
            continue; // Skip this workout and check the next one
          }

          if (!postCheck) {
            // This workout has no post, it's a valid active workout
            return workout.id;
          }
        } catch (error) {
          console.error('[StartWorkout] Exception checking for post:', error);
          continue; // Skip and try next workout
        }
      }
    }

    return null;
  };

  type WeightUnit = "kg" | "lb";

  const applyTemplateToWorkout = async (workoutId: string, template: TemplateWithExercises | null) => {
    if (!template) return;

    const exercises = getValidTemplateExercises(template);
    if (exercises.length === 0) {
      window.dispatchEvent(new CustomEvent("workout:template-applied", { detail: { workoutId } }));
      return;
    }

    try {
      const payload = exercises.map((exercise) => ({
        workout_id: workoutId,
        exercise_id: exercise.exerciseId,
        order_index: exercise.orderIndex ?? 0,
      }));

      const { error } = await supabase.from("workout_exercises").insert(payload);
      if (error) {
        throw error;
      }

      window.dispatchEvent(new CustomEvent("workout:template-applied", { detail: { workoutId } }));
    } catch (error) {
      console.error("Failed to apply template", error);
      toast({
        title: "Template not applied",
        description: template.name ? `Could not load “${template.name}”.` : "Could not load template.",
        variant: "destructive",
      });
    }
  };

  const beginWorkout = async (template: TemplateWithExercises | null, responses: CheckInResponses) => {
    console.log("beginWorkout called");
    console.log("[StartWorkout] Checking workout limit - canCreateWorkout:", canCreateWorkout, "isPremium:", isPremium, "workoutCountThisMonth:", workoutCountThisMonth);

    // Check workout limit for free users
    if (!canCreateWorkout) {
      console.log("[StartWorkout] Workout limit reached! Showing paywall...");
      setPaywallFeature("Unlimited Workouts");
      setShowPaywall(true);
      return;
    }

    const detectOffline = () =>
      shouldUseOfflineMode() || (typeof navigator !== "undefined" && navigator.onLine === false);

    const offlineModeAtStart = detectOffline();
    vLog.info('StartWorkout', `Beginning workout (${offlineModeAtStart ? 'OFFLINE' : 'ONLINE'} mode)`, {
      hasTemplate: !!template,
      templateName: template?.name
    });
    setLoading(true);
    let effectiveUserId: string | null = null;
    let workoutId: string | null = null;
    let startedAt: string | null = null;
    let cachedExercises: any[] = [];
    let preferredUnit: WeightUnit = "kg";
    let offlineWorkoutCreated = false;
    let navigatedToSession = false;

    const ensureOfflineWorkout = async (
      message?: { title: string; description: string; variant?: "default" | "destructive" }
    ) => {
      vLog.info('ensureOfflineWorkout', 'Starting offline workout creation', {
        workoutId,
        userId: effectiveUserId?.substring(0, 8) + '...',
        hasTemplate: !!template,
        exercisesCount: cachedExercises.length
      });

      if (offlineWorkoutCreated) {
        vLog.info('ensureOfflineWorkout', 'Workout already created, skipping', { workoutId });
        if (message) {
          toast(message);
        }
        return;
      }

      if (!effectiveUserId || !workoutId || !startedAt) {
        vLog.error('ensureOfflineWorkout', 'Missing required data for offline workout', {
          hasUserId: !!effectiveUserId,
          hasWorkoutId: !!workoutId,
          hasStartedAt: !!startedAt
        });
        throw new Error("OFFLINE_FALLBACK_MISSING_PREREQS");
      }

      vLog.info('ensureOfflineWorkout', 'Getting IndexedDB connection...', {});
      const db = await getDB();
      vLog.success('ensureOfflineWorkout', '✓ Got IndexedDB connection', {});

      vLog.info('ensureOfflineWorkout', 'Saving workout to IndexedDB...', { workoutId });
      await db.put('workouts', {
        id: workoutId,
        userId: effectiveUserId,
        data: {
          exercises: cachedExercises,
          currentUnit: preferredUnit,
          workoutStartedAt: startedAt,
          startedAt: startedAt,
          sessionMetrics: {
            bodyweight: null,
            sleep: responses.sleepQuality,
            mood: responses.energyLevel,
            energy: responses.energyLevel,
            soreness: normalizeSorenessArea(responses.sorenessArea),
            notes: null,
          },
        },
        createdAt: startedAt,
        updatedAt: startedAt,
        synced: false,
        deleted: false,
      });
      vLog.success('ensureOfflineWorkout', '✓ Workout saved to IndexedDB', { workoutId });

      vLog.info('ensureOfflineWorkout', 'Queueing workout operation...', {});
      await queueOperation({
        workoutId,
        type: 'insert',
        table: 'workouts',
        data: {
          id: workoutId,
          user_id: effectiveUserId,
          started_at: startedAt,
          template_id: template?.id ?? null,
        },
        timestamp: startedAt,
        userId: effectiveUserId,
      });
      vLog.success('ensureOfflineWorkout', '✓ Workout operation queued', {});

      const { sleepQuality, preWorkoutTaken, sorenessArea, energyLevel } = responses;
      const normalizedSoreness = normalizeSorenessArea(sorenessArea);

      vLog.info('ensureOfflineWorkout', 'Queueing session metrics...', {});
      await queueOperation({
        workoutId,
        type: 'insert',
        table: 'session_metrics',
        data: {
          workout_id: workoutId,
          sleep: sleepQuality ?? null,
          mood: energyLevel ?? null,
          preworkout: preWorkoutTaken ?? false,
          soreness_area: normalizedSoreness ?? null,
        },
        timestamp: startedAt,
        userId: effectiveUserId,
      });
      vLog.success('ensureOfflineWorkout', '✓ Session metrics queued', {});

      if (template) {
        vLog.info('ensureOfflineWorkout', 'Queueing template exercises...', { count: template.exercises.length });
        for (let i = 0; i < template.exercises.length; i++) {
          const tmplEx = template.exercises[i];
          const tempWorkoutExerciseId = `${workoutId}-template-${i}`;

          await queueOperation({
            workoutId,
            type: 'insert',
            table: 'workout_exercises',
            data: {
              id: tempWorkoutExerciseId,
              workout_id: workoutId,
              exercise_id: tmplEx.exerciseId,
              order_index: tmplEx.orderIndex ?? i,
              group_id: null,
            },
            timestamp: startedAt,
            userId: effectiveUserId,
          });
        }
        vLog.success('ensureOfflineWorkout', '✓ Template exercises queued', { count: template.exercises.length });
      }

      offlineWorkoutCreated = true;
      vLog.success('ensureOfflineWorkout', '🎉 Offline workout creation COMPLETE', { workoutId });

      if (message) {
        toast(message);
      }
    };

    try {
      const session = await getSupabaseSession();
      const user = session?.user;

      const cachedUserId = await getCachedUserId();
      effectiveUserId = user?.id ?? cachedUserId;

      if (!effectiveUserId) {
        vLog.error('StartWorkout', 'No user ID available', { offlineMode: offlineModeAtStart });
        throw new Error("AUTH_REQUIRED");
      }

      vLog.success('StartWorkout', 'User ID resolved', {
        source: user?.id ? 'session' : 'cache',
        userId: effectiveUserId.substring(0, 8) + '...'
      });

      // Safely check for active workouts and preferred unit with offline error handling
      let activeWorkoutId: string | null = null;
      let preferredUnitResult: string | null = null;

      try {
        [activeWorkoutId, preferredUnitResult] = await Promise.all([
          getActiveWorkoutId(effectiveUserId),
          getUserPreferredUnit(effectiveUserId),
        ]);
      } catch (error) {
        console.error('[StartWorkout] Failed to check active workouts/preferences:', error);
        // In offline mode, IndexedDB errors are non-fatal - use defaults
        if (offlineModeAtStart) {
          console.log('[StartWorkout] Using defaults due to offline IndexedDB error');
          activeWorkoutId = null;
          preferredUnitResult = null;
        } else {
          // In online mode, this is a real error
          throw error;
        }
      }

      preferredUnit = preferredUnitResult ?? "kg";

      if (activeWorkoutId) {
        toast({
          title: "Workout already in progress",
          description: "Please finish your current workout first.",
          variant: "destructive",
        });
        navigate(`/workout/${activeWorkoutId}`);
        return;
      }

      workoutId = generateUUID();
      startedAt = new Date().toISOString();
      const checkInPayload = {
        responses,
        completedAt: new Date().toISOString(),
        templateId: template?.id ?? null,
        templateName: template?.name ?? null,
      };

      try {
        cachedExercises =
          template && getValidTemplateExercises(template).length > 0
            ? await buildCachedExercisesFromTemplate(template, workoutId, effectiveUserId)
            : [];
      } catch (error) {
        cachedExercises = [];
        console.error('[StartWorkout] Failed to build cached exercises, continuing with empty array:', error);
      }

      try {
        writeCachedWorkoutSession(effectiveUserId, workoutId, {
          exercises: cachedExercises,
          currentUnit: preferredUnit,
          workoutStartedAt: startedAt,
          checkIn: checkInPayload,
        });
      } catch (error) {
        console.error('[StartWorkout] Failed to write cached session, continuing anyway:', error);
      }

      const metadata = {
        id: workoutId,
        name: (template?.name ?? "").trim() || "Workout",
        exerciseCount: cachedExercises.length,
      };
      setLiveActivitiesWorkoutId(workoutId);
      setLiveActivitiesMetadata(metadata);
      void startLiveActivity(metadata, startedAt);

      window.dispatchEvent(
        new CustomEvent("workout:created", {
          detail: {
            workoutId,
            templateId: template?.id ?? null,
            templateName: template?.name ?? null,
            checkIn: responses,
          },
        }),
      );

      // IMPORTANT: Create offline workout in IndexedDB BEFORE navigating
      // This ensures the WorkoutSession component has data when it loads
      if (offlineModeAtStart) {
        vLog.info('StartWorkout', 'Creating offline workout in IndexedDB...', { workoutId });
        console.log('[StartWorkout] Creating offline workout before navigation');
        await ensureOfflineWorkout({
          title: 'Workout started offline',
          description: 'Your workout will sync when connection improves',
        });
        vLog.success('StartWorkout', 'Offline workout created successfully', { workoutId });
      }

      // Navigate to workout session AFTER offline workout is created
      vLog.success('StartWorkout', 'Navigating to workout session', { workoutId });
      navigate(`/workout/${workoutId}`, { replace: true });
      navigatedToSession = true;

      // If we're online, create the workout in Supabase
      if (!offlineModeAtStart) {
        try {
          const { error: createError } = await supabase.from("workouts").insert({
            id: workoutId,
            user_id: effectiveUserId,
            started_at: startedAt,
            template_id: template?.id ?? null,
          });

          if (createError) throw createError;

          const tasks: Promise<unknown>[] = [];
          tasks.push(savePreSessionMetrics(workoutId, responses));
          if (template) {
            tasks.push(applyTemplateToWorkout(workoutId, template));
          }

          await Promise.all(tasks);
        } catch (error) {
          console.error("Failed to create workout in database", error);
          await ensureOfflineWorkout({
            title: "Sync issue",
            description: "Workout saved offline, will sync later.",
          });
        }
      }

      void (async () => {
        try {
          const isNative = Capacitor.isNativePlatform();
          const platform = Capacitor.getPlatform();
          console.log("[LiveActivities] env", { isNative, platform });

          if (isNative && platform === "ios") {
            console.log("[LiveActivities] Attempting start", {
              workoutId,
              name: metadata.name,
              exerciseCount: metadata.exerciseCount,
              startedAt,
            });
            try {
              await LiveActivities.start({
                workoutId,
                workoutName: metadata.name,
                startDate: startedAt,
                exerciseCount: metadata.exerciseCount,
              });
              console.log("[LiveActivities] start resolved");
            } catch (pluginError) {
              if (import.meta.env.DEV) {
                console.warn("LiveActivities.start failed", pluginError);
              }
            }
          }
        } catch (error) {
          console.error("Failed to start live activities", error);
        }
      })();
    } catch (error: unknown) {
      const message = (error as Error)?.message ?? "";
      const offlineNow = detectOffline();

      console.error('[StartWorkout] Error in beginWorkout:', error);

      // If we're offline and haven't created the workout yet, try emergency fallback
      if (offlineNow && !offlineWorkoutCreated && workoutId && effectiveUserId && startedAt) {
        try {
          vLog.warning('StartWorkout', 'Attempting emergency offline workout creation', { workoutId });
          console.log('[StartWorkout] Attempting emergency offline workout creation');
          await ensureOfflineWorkout({
            title: 'Workout started offline',
            description: 'Your workout will sync when connection improves',
          });

          vLog.success('StartWorkout', 'Emergency offline workout created', { workoutId });

          // If we haven't navigated yet, do it now
          if (!navigatedToSession && workoutId) {
            vLog.success('StartWorkout', 'Navigating after emergency creation', { workoutId });
            console.log('[StartWorkout] Navigating to workout session after emergency creation');
            navigate(`/workout/${workoutId}`, { replace: true });
            navigatedToSession = true;
          }

          return;
        } catch (fallbackError) {
          vLog.error('StartWorkout', 'Emergency offline creation failed', fallbackError);
          console.error('[StartWorkout] Emergency offline creation failed:', fallbackError);
          // Continue to show appropriate error message below
        }
      }

      // Auth errors
      if (message === "AUTH_REQUIRED" || message.includes("No cached session available")) {
        toast({
          title: "Authentication required",
          description: offlineNow
            ? "Please sign in while online to enable offline workouts."
            : "Please sign in to start a workout.",
          variant: "destructive",
        });
        navigate("/auth");
      }
      // Offline mode errors
      else if (offlineNow) {
        console.error("Failed to start workout offline", error);
        toast({
          title: "Offline workout failed",
          description: "Unable to start workout offline. Please check your device storage and try again.",
          variant: "destructive",
        });
      }
      // Online network errors
      else {
        console.error("Failed to start workout", error);
        const normalizedMessage = message.toLowerCase();
        const isNetworkError =
          normalizedMessage.includes("failed to fetch") ||
          normalizedMessage.includes("network request failed") ||
          normalizedMessage.includes("failed to load") ||
          normalizedMessage.includes("load failed");

        toast({
          title: isNetworkError ? "Network error" : "Error",
          description: isNetworkError
            ? "Failed to start workout. Please check your connection and try again."
            : "Failed to start workout.",
          variant: "destructive",
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSkipCheckIn = () => {
    if (loading) return;
    if (!templateReady) {
      toast({
        title: "One sec…",
        description: "We’re still loading your template. Try again in a moment.",
      });
      return;
    }
    void beginWorkout(selectedTemplate, INITIAL_CHECK_IN);
  };

  const optionLayout = useMemo(() => {
    const stepType = activeStep.type;
    if (stepType === "binary") {
      return "grid grid-cols-2 gap-2.5";
    }
    if (stepType === "options") {
      return "grid grid-cols-2 gap-2.5 sm:grid-cols-4";
    }
    return "flex flex-col gap-3";
  }, [activeStep]);

  if (showTemplatePicker) {
    return (
      <TemplatePicker
        onSelect={handleTemplateSelect}
        onCancel={() => setShowTemplatePicker(false)}
      />
    );
  }

  return (
    <div className="relative flex min-h-screen w-full items-center justify-center bg-background">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background via-background/65 to-background" />
      <div className="pointer-events-none absolute inset-0 blur-3xl bg-[radial-gradient(circle_at_20%_20%,rgba(15,23,42,0.18),transparent),radial-gradient(circle_at_80%_30%,rgba(15,23,42,0.12),transparent),radial-gradient(circle_at_50%_80%,rgba(15,23,42,0.15),transparent)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(250,250,250,0.12),transparent),radial-gradient(circle_at_80%_30%,rgba(250,250,250,0.1),transparent),radial-gradient(circle_at_50%_80%,rgba(250,250,250,0.14),transparent)]" />

      <Button
        variant="ghost"
        size="icon"
        onClick={() => navigate("/")}
        className="absolute left-5 z-20 h-11 w-11 rounded-2xl border border-white/40 bg-white/60 text-foreground shadow-[0_18px_50px_-38px_rgba(15,23,42,0.65)] backdrop-blur-lg transition-transform duration-200 hover:-translate-y-0.5 dark:border-white/15 dark:bg-white/10 dark:text-white"
        style={{ top: "max(env(safe-area-inset-top, 0px) + 1rem, 2.75rem)" }}
        aria-label="Back to dashboard"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>

      <AnimatePresence mode="wait">
        {activeView === "landing" ? (
          <motion.div
            key="landing-view"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex w-full max-w-xl flex-col items-center px-6 py-16 text-center sm:px-12"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary shadow-[0_25px_50px_-20px_rgba(15,23,42,0.65)] text-primary-foreground sm:h-28 sm:w-28">
                <Dumbbell className="h-12 w-12 sm:h-14 sm:w-14" />
              </div>
              <div>
                <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
                  Start Your Workout
                </h1>
                <p className="mt-3 text-base text-foreground/70 sm:text-lg">
                  Minimal, focused, and ready whenever you are.
                </p>
              </div>
            </div>

            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              className="mt-12 flex w-full flex-col gap-4"
            >
              <Button
                type="button"
                onClick={handleStartEmptyWorkout}
                disabled={loading}
                className="group h-16 rounded-[28px] border border-white/40 bg-white/80 text-base font-semibold text-foreground shadow-[0_28px_80px_-48px_rgba(15,23,42,0.85)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white active:scale-[0.99] dark:border-white/15 dark:bg-white/10 dark:text-white"
              >
                <div className="flex items-center justify-center gap-3">
                  <Dumbbell className="h-5 w-5 transition-transform duration-200 group-hover:scale-[1.08]" />
                  <span>Start Empty Workout</span>
                </div>
              </Button>

              <Button
                type="button"
                onClick={() => setShowTemplatePicker(true)}
                disabled={loading}
                className="group h-16 rounded-[28px] border border-white/25 bg-gradient-to-r from-primary/90 to-primary text-base font-semibold text-primary-foreground shadow-[0_30px_90px_-36px_rgba(15,23,42,0.75)] transition-transform duration-200 hover:-translate-y-0.5 hover:shadow-[0_34px_95px_-32px_rgba(15,23,42,0.78)] active:scale-[0.99]"
              >
                <div className="flex items-center justify-center gap-3">
                  <Library className="h-5 w-5 transition-transform duration-200 group-hover:scale-[1.08]" />
                  <span>Start From Template</span>
                </div>
              </Button>

              <Button
                type="button"
                variant="outline"
                onClick={handleCreateTemplate}
                className="h-16 rounded-[28px] border border-white/30 bg-white/60 text-base font-semibold text-foreground shadow-[0_25px_70px_-52px_rgba(15,23,42,0.8)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-white/80 active:scale-[0.99] dark:border-white/15 dark:bg-white/5 dark:text-white dark:hover:bg-white/10"
              >
                <div className="flex items-center justify-center gap-3">
                  <PlusCircle className="h-5 w-5" />
                  <span>Create New Template</span>
                </div>
              </Button>
            </motion.div>
          </motion.div>
        ) : (
          <motion.div
            key="check-in-view"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -30 }}
            transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex w-full max-w-2xl flex-col px-5 py-6 sm:px-12 sm:py-16"
          >
            <div style={{ paddingTop: "max(env(safe-area-inset-top, 0px) + 0.75rem, 1rem)" }} />

            <motion.div
              className="mb-4 flex flex-col items-center gap-2 text-center"
              animate={isTransitioning ? { y: 0 } : { y: [0, -12, 0] }}
              transition={isTransitioning ? { duration: 0 } : { duration: 5.2, repeat: Infinity, ease: [0.4, 0, 0.2, 1] }}
              style={{ willChange: isTransitioning ? "auto" : "transform" }}
            >
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary shadow-[0_22px_60px_-30px_rgba(15,23,42,0.65)] text-primary-foreground sm:h-20 sm:w-20">
                <Dumbbell className="h-6 w-6 sm:h-11 sm:w-11" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground sm:text-3xl">Pre-Workout Check-In</h2>
                <p className="mt-1 text-xs text-foreground/70 sm:text-base">
                  Quick pulse check so we can shape today's session.
                </p>
              </div>
            </motion.div>

            <div className="relative overflow-hidden rounded-[32px] border border-white/20 bg-white/75 p-4 shadow-[0_35px_120px_-60px_rgba(15,23,42,0.75)] backdrop-blur-2xl dark:border-white/10 dark:bg-white/5 sm:p-6" style={{ willChange: "transform" }}>
              <div className="pointer-events-none absolute inset-x-6 top-0 h-24 rounded-[28px] bg-gradient-to-b from-white/60 via-white/5 to-transparent blur-2xl dark:from-white/20 dark:via-transparent" />
              <div className="relative flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div
                      className={cn(
                        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-sm backdrop-blur",
                        templateSummary
                          ? "border-primary/30 bg-primary/10 text-primary dark:border-primary/40 dark:bg-primary/20"
                          : "border-white/40 bg-white/80 text-foreground/80 dark:border-white/20 dark:bg-white/10 dark:text-white",
                      )}
                    >
                      {templateSummary ? (
                        <Library className="h-4 w-4" />
                      ) : (
                        <Dumbbell className="h-4 w-4" />
                      )}
                      <span>
                        {templateSummary ? `Template • ${templateSummary.name}` : "Empty workout"}
                      </span>
                    </div>
                    {templateSummary && isTemplateLoading && (
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        Loading template…
                      </div>
                    )}
                  </div>
                  <div className="h-[6px] rounded-full bg-foreground/10 dark:bg-white/10">
                    <div
                      className="h-full rounded-full bg-foreground/60 transition-all duration-300 ease-out dark:bg-white/50"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {summaryItems.map((item) => (
                    <SummaryCard key={item.key} item={item} />
                  ))}
                </div>

                <AnimatePresence mode="wait">
                  <motion.div
                    key={activeStep.key}
                    initial={{ opacity: 0, y: 24 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
                    className="flex flex-col gap-3"
                  >
                    <div className="text-left">
                      <h2 className="text-xl font-semibold text-foreground sm:text-3xl">
                        {activeStep.title}
                      </h2>
                      {activeStep.description && (
                        <p className="mt-1 text-xs text-foreground/70 sm:text-base">
                          {activeStep.description}
                        </p>
                      )}
                    </div>

                    {activeStep.type === "scale" ? (
                      <div className="flex flex-col gap-4">
                        <div className="rounded-2xl border border-white/30 bg-white/80 px-4 py-4 shadow-[0_22px_60px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl dark:border-white/10 dark:bg-white/10 sm:py-6" style={{ willChange: "transform" }}>
                          <div className="mb-2 text-center text-xs font-semibold text-foreground dark:text-white sm:text-sm">
                            {sliderValue}
                            {sliderDescriptor ? (
                              <span className="ml-2 text-[11px] font-medium text-foreground/60 dark:text-white/70">
                                {sliderDescriptor}
                              </span>
                            ) : null}
                          </div>
                          <Slider
                            value={[sliderValue]}
                            min={1}
                            max={5}
                            step={1}
                            disabled={loading || !templateReady}
                            onValueChange={(values) => setSliderValue(values[0])}
                            onValueCommit={(values) => handleSelectOption(values[0], false)}
                            aria-label="Check-in scale"
                            className="h-7"
                            trackClassName="h-2.5 rounded-full border border-white/30 bg-white/50 transition-all duration-200 ease-out dark:border-white/10 dark:bg-white/10"
                            rangeClassName="bg-gradient-to-r from-primary to-primary/80 shadow-[0_6px_16px_rgba(59,130,246,0.35)] transition-all duration-200 ease-out"
                            thumbClassName="h-7 w-7 rounded-full border-2 border-primary bg-white shadow-[0_6px_14px_rgba(15,23,42,0.25)] transition-transform duration-200 ease-out focus-visible:ring-primary/40"
                          />
                          <div className="mt-3 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wide text-foreground/50 dark:text-white/50">
                            {activeStep.options.map((option) => (
                              <span key={option.label}>{option.label}</span>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className={optionLayout}>
                        {activeStep.options.map((option) => {
                          const isSelected = selectedValue === option.value;
                              return (
                            <button
                              key={option.label}
                              type="button"
                              onClick={() => handleSelectOption(option.value)}
                              className={cn(
                                "flex flex-col items-center justify-center gap-0.5 rounded-[18px] border px-3 py-3 text-center text-sm font-semibold transition-all duration-200 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 active:scale-[0.98]",
                                "border-white/35 bg-white/80 text-foreground shadow-[0_18px_55px_-48px_rgba(15,23,42,0.85)] hover:border-primary/40 hover:bg-white dark:border-white/15 dark:bg-white/10 dark:text-white",
                                isSelected &&
                                  "border-primary/60 bg-gradient-to-r from-primary to-primary/85 text-primary-foreground shadow-[0_28px_80px_-38px_rgba(59,130,246,0.65)] dark:border-primary/50",
                              )}
                            >
                              <span className="text-sm font-semibold sm:text-base">{option.label}</span>
                              {option.helper && (
                                <span className="text-[11px] font-medium text-foreground/60 dark:text-white/70">
                                  {option.helper}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </motion.div>
                </AnimatePresence>

                <div className="flex flex-col gap-2 pt-1">
                  {activeStep.type === "scale" && (
                    <Button
                      type="button"
                      onClick={handleContinue}
                      disabled={!hasSelection || loading || !templateReady}
                      className="h-11 rounded-[22px] bg-foreground text-sm font-semibold text-background shadow-[0_24px_70px_-38px_rgba(15,23,42,0.8)] transition-transform duration-200 hover:-translate-y-0.5 hover:bg-foreground/90 active:scale-[0.99] dark:bg-white dark:text-black dark:hover:bg-white/90 sm:text-base sm:h-12"
                    >
                      {checkInStep === totalSteps - 1 ? (
                        <div className="flex items-center justify-center gap-2">
                          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                          <span>{loading ? "Launching..." : "Start Workout"}</span>
                        </div>
                      ) : (
                        "Continue"
                      )}
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleSkipCheckIn}
                    disabled={loading || !templateReady}
                    className="h-10 rounded-[20px] border border-transparent text-sm font-medium text-foreground/70 transition-colors hover:text-foreground dark:text-white/70 dark:hover:text-white sm:text-base"
                  >
                    Skip check-in
                  </Button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} feature={paywallFeature} />
    </div>
  );
};

export default StartWorkout;
