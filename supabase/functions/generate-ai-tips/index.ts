import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { getCorsHeaders, handleCorsPreflightRequest } from "../_shared/cors.ts";
import { handleLegacyRequest } from "./legacyHandler.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY") ?? "";
const GEMINI_MODEL = Deno.env.get("GOOGLE_GEMINI_MODEL") ?? "gemini-2.0-flash";

const DAILY_LIMIT = Number(Deno.env.get("AI_TIPS_DAILY_LIMIT") ?? "5");
const NO_REPEAT_DAYS = Number(Deno.env.get("AI_TIPS_NO_REPEAT_DAYS") ?? "14");
const EXERCISE_COOLDOWN_DAYS = Number(Deno.env.get("AI_TIPS_EXERCISE_COOLDOWN_DAYS") ?? "4");
const REQUIRED_PERSONALIZED_TIPS = 2;
const TIP_CATEGORIES = ["progression", "technique_tempo", "rest_volume", "recovery", "balance"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  progression: "Progression",
  technique_tempo: "Technique / Tempo",
  rest_volume: "Rest & Volume",
  recovery: "Recovery",
  balance: "Balance",
  general: "General Principle",
};

const FEATURE_FLAG_ENABLED = (Deno.env.get("AI_TIPS_VARIETY_V1") ?? "true") === "true";

const FALLBACK_GENERAL_TIP = {
  tip: "Consistency wins—treat every lift like practice and own the tempo before adding load.",
  category: "general",
};

const FALLBACK_PERSONALIZED_TIPS = [
  {
    exercise: "Goblet Squat",
    category: "progression",
    tip: "Add one controlled set at your current weight to reinforce bracing before bumping load.",
  },
  {
    exercise: "Bent-Over Row",
    category: "balance",
    tip: "Match every press day with rows to keep shoulders happy—aim for 3 quality sets this week.",
  },
] as const;

serve(async (req) => {
  const origin = req.headers.get("origin");

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(origin);
  }

  if (!FEATURE_FLAG_ENABLED) {
    return handleLegacyRequest(req, origin);
  }

  return handleVarietyTips(req, origin);
});

async function handleVarietyTips(req: Request, origin: string | null): Promise<Response> {
  try {
    if (!GEMINI_API_KEY) {
      console.error("GOOGLE_GEMINI_API_KEY not set");
      return jsonResponse({ error: "API configuration error" }, origin, 500);
    }

    const authContext = await getAuthContext(req, origin);
    if ("errorResponse" in authContext) {
      return authContext.errorResponse;
    }

    const { supabaseAdmin, user } = authContext;
    const today = new Date().toISOString().split("T")[0];

    const currentCount = await getUsageCount(supabaseAdmin, user.id, today);
    if (currentCount === null) {
      return jsonResponse({ error: "Database error", message: "Unable to check usage" }, origin, 500);
    }

    if (currentCount >= DAILY_LIMIT) {
      return jsonResponse(
        {
          error: "Daily limit reached",
          message: `You've used all ${DAILY_LIMIT} daily suggestions. Come back tomorrow!`,
          remaining: 0,
          daily_limit: DAILY_LIMIT,
        },
        origin,
        200
      );
    }

    const profile = await fetchProfile(supabaseAdmin, user.id);
    const userUnit = profile?.unit_default || "kg";
    const userGoal = profile?.goal ?? null;
    const userVibe = profile?.vibe ?? null;

    // Check AI tips consent
    if (profile?.ai_tips_consent !== true) {
      return jsonResponse(
        {
          error: "Consent required",
          message: "You must consent to share workout data with Google AI to use this feature.",
          consent_status: profile?.ai_tips_consent,
        },
        origin,
        403
      );
    }

    const { workouts, workoutExercises, sets } = await fetchWorkoutData(supabaseAdmin, user.id);

    if (!workouts || workouts.length === 0 || !workoutExercises || workoutExercises.length === 0) {
      return await respondWithFallbackTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        sessionFocus: "Get Started",
        reason: "insufficient_workout_history",
        origin,
      });
    }

    const exerciseProgressions = buildExerciseProgressions(workouts, workoutExercises, sets);
    if (exerciseProgressions.length === 0) {
      return await respondWithFallbackTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        sessionFocus: "Log More Detail",
        reason: "no_sets_recorded",
        origin,
      });
    }

    const selectedExercises = selectExercisesForPrompt(exerciseProgressions, 5);
    const workoutIds = workouts.map((w) => w.id);
    const sessionMetrics = await fetchSessionMetrics(supabaseAdmin, workoutIds);

    const history = await fetchRecentHistory(supabaseAdmin, user.id);
    const historyWindowSummary = history.tipSamples.slice(0, 8);
    const cooldownExercises = Array.from(history.exerciseCooldown.entries())
      .filter(([, date]) => dateWithinDays(date, EXERCISE_COOLDOWN_DAYS))
      .map(([name]) => name);

    const prompt = buildPrompt({
      workoutSummary: {
        total_workouts: workouts.length,
        period: "last 2 weeks",
        unit_preference: userUnit,
        exercises: selectedExercises.map((ex) => ({
          name: ex.name,
          muscle_group: ex.muscle_group,
          sets_summary: summarizeExerciseSets(ex),
        })),
      },
      historyTips: historyWindowSummary,
      cooldownExercises,
      goal: userGoal,
      vibe: userVibe,
      wellness: summarizeWellness(sessionMetrics),
    });

    const aiPayload = await callGemini(prompt);
    const parsed = parseAiPayload(aiPayload);

    if (!parsed) {
      return await respondWithFallbackTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        sessionFocus: "General Coaching",
        reason: "invalid_ai_payload",
      });
    }

    const generalTip = ensureGeneralTip(parsed.general_tip, history.normalizedTips);
    const candidateTips = parsed.personalized_tips;

    if (candidateTips.length === 0) {
      return await respondWithFallbackTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        sessionFocus: parsed.session_focus ?? "General Coaching",
        reason: "no_candidate_tips",
      });
    }

    const filterResult = applyNoveltyFilters({
      candidates: candidateTips,
      historyNormalizedTips: history.normalizedTips,
      cooldownMap: history.exerciseCooldown,
    });

    if (filterResult.selected.length === 0) {
      return await respondWithFallbackTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        sessionFocus: parsed.session_focus ?? "General Coaching",
        reason: "filters_exhausted",
        extraMetadata: filterResult.metrics,
      });
    }

    const personalizedTips = filterResult.selected.slice(0, REQUIRED_PERSONALIZED_TIPS);
    const formatted = formatTips(generalTip, personalizedTips);

    const tipMetadata = {
      categories: formatted.categories,
      novelty: filterResult.metrics,
      history_sample_size: history.normalizedTips.length,
      cooldown_exercises_checked: cooldownExercises.length,
      generated_at: new Date().toISOString(),
      feature_flag: "AI_TIPS_VARIETY_V1",
    };

    console.log("AI_COACH_VARIETY", JSON.stringify(tipMetadata));

    return await storeTipsAndRespond({
      supabaseAdmin,
      userId: user.id,
      currentCount,
      today,
      formattedTips: formatted.tips,
      tipCategories: formatted.categories,
      sessionFocus: parsed.session_focus ?? "Personalized Training Tips",
      suggestionsPayload: {
        general: generalTip,
        personalized: personalizedTips,
        balance_notes: parsed.balance_notes ?? null,
      },
      tipMetadata,
      origin,
    });
  } catch (error) {
    console.error("AI tips error:", error);
    return jsonResponse(
      {
        error: "Internal error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      origin,
      500
    );
  }
}

function jsonResponse(body: Record<string, unknown>, origin: string | null, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...getCorsHeaders(origin),
      "Content-Type": "application/json",
    },
  });
}

async function getAuthContext(req: Request, origin: string | null) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return {
      errorResponse: jsonResponse({ error: "Missing authorization" }, origin, 401),
    };
  }

  const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  const {
    data: { user },
    error: userError,
  } = await supabaseClient.auth.getUser();

  if (userError || !user) {
    return {
      errorResponse: jsonResponse({ error: "Unauthorized" }, origin, 401),
    };
  }

  const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  return { supabaseAdmin, user };
}

async function getUsageCount(supabaseAdmin: ReturnType<typeof createClient>, userId: string, today: string) {
  const { data, error } = await supabaseAdmin
    .from("ai_usage_tracking")
    .select("request_count")
    .eq("user_id", userId)
    .eq("date", today)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    console.error("Error checking usage:", error);
    return null;
  }

  return data?.request_count ?? 0;
}

async function fetchProfile(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("unit_default, goal, vibe, ai_tips_consent")
    .eq("id", userId)
    .maybeSingle();
  return data;
}

async function fetchWorkoutData(supabaseAdmin: ReturnType<typeof createClient>, userId: string) {
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  const { data: workouts } = await supabaseAdmin
    .from("workouts")
    .select("id, started_at, ended_at")
    .eq("user_id", userId)
    .gte("started_at", twoWeeksAgo.toISOString())
    .not("ended_at", "is", null)
    .order("started_at", { ascending: false });

  if (!workouts || workouts.length === 0) {
    return { workouts: null, workoutExercises: null, sets: null };
  }

  const workoutIds = workouts.map((w) => w.id);

  const { data: workoutExercises, error: weError } = await supabaseAdmin
    .from("workout_exercises")
    .select(
      `
      id,
      workout_id,
      exercise:exercises!workout_exercises_exercise_id_fkey (
        name,
        muscle_group,
        equipment
      )
    `,
    )
    .in("workout_id", workoutIds);

  if (weError) {
    throw new Error(`Database error: ${weError.message}`);
  }

  const workoutExerciseIds = workoutExercises?.map((we) => we.id) || [];
  if (workoutExerciseIds.length === 0) {
    return { workouts, workoutExercises: [], sets: [] };
  }

  const { data: sets, error: setsError } = await supabaseAdmin
    .from("sets")
    .select("workout_exercise_id, weight, reps, unit, is_warmup, created_at")
    .in("workout_exercise_id", workoutExerciseIds)
    .eq("is_warmup", false)
    .order("created_at", { ascending: true });

  if (setsError) {
    throw new Error(`Database error: ${setsError.message}`);
  }

  return { workouts, workoutExercises, sets: sets ?? [] };
}

function buildExerciseProgressions(
  workouts: Array<{ id: string; started_at: string | null }>,
  workoutExercises: Array<{
    id: string;
    workout_id: string;
    exercise?: { name?: string | null; muscle_group?: string | null; equipment?: string | null };
  }> | null,
  sets: Array<{ workout_exercise_id: string; weight: number; reps: number; unit: string; created_at: string }>,
) {
  const map = new Map<
    string,
    {
      name: string;
      muscle_group?: string | null;
      equipment?: string | null;
      sets: Array<{ weight: number; reps: number; unit: string; date?: string | null }>;
      lastDate?: string | null;
    }
  >();

  workoutExercises?.forEach((we) => {
    const name = we.exercise?.name;
    if (!name) return;

    const exerciseSets = sets.filter((s) => s.workout_exercise_id === we.id);
    if (exerciseSets.length === 0) return;

    if (!map.has(name)) {
      map.set(name, {
        name,
        muscle_group: we.exercise?.muscle_group,
        equipment: we.exercise?.equipment,
        sets: [],
      });
    }

    const workout = workouts.find((w) => w.id === we.workout_id);
    exerciseSets.forEach((set) => {
      map.get(name)?.sets.push({
        weight: set.weight,
        reps: set.reps,
        unit: set.unit,
        date: workout?.started_at ?? set.created_at,
      });
      if (!map.get(name)?.lastDate || (workout?.started_at && workout.started_at > (map.get(name)?.lastDate ?? ""))) {
        map.get(name)!.lastDate = workout?.started_at ?? set.created_at;
      }
    });
  });

  return Array.from(map.values()).filter((ex) => ex.sets.length >= 3);
}

function selectExercisesForPrompt(
  exercises: Array<{ lastDate?: string | null; sets: Array<unknown>; [key: string]: unknown }>,
  limit: number,
) {
  if (exercises.length <= limit) return exercises;

  const now = Date.now();
  const maxSets = Math.max(...exercises.map((ex) => ex.sets.length));

  return exercises
    .map((ex) => {
      const lastDate = ex.lastDate ? new Date(ex.lastDate).getTime() : now;
      const daysSince = Math.max(1, (now - lastDate) / (1000 * 60 * 60 * 24));
      const recencyScore = 1 / daysSince;
      const volumeScore = ex.sets.length / Math.max(1, maxSets);
      return { ex, score: recencyScore * 0.6 + volumeScore * 0.4 };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => item.ex);
}

function summarizeExerciseSets(exercise: { sets: Array<{ weight: number; reps: number; unit: string }> }) {
  const first = exercise.sets.slice(0, 2);
  const last = exercise.sets.slice(-2);
  return first.concat(last).map((s) => ({ weight: s.weight, reps: s.reps, unit: s.unit }));
}

async function fetchSessionMetrics(supabaseAdmin: ReturnType<typeof createClient>, workoutIds: string[]) {
  const { data } = await supabaseAdmin
    .from("session_metrics")
    .select("workout_id, sleep, mood, preworkout, soreness_area, created_at")
    .in("workout_id", workoutIds);
  return data ?? [];
}

function summarizeWellness(metrics: Array<{ sleep: number | null; mood: number | null; created_at: string }>) {
  if (!metrics || metrics.length === 0) {
    return { note: "No wellness data logged" };
  }

  const sorted = metrics
    .slice()
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 7);

  const sleepValues = sorted.map((m) => m.sleep).filter((value): value is number => typeof value === "number");
  const moodValues = sorted.map((m) => m.mood).filter((value): value is number => typeof value === "number");

  const avg = (values: number[]) => (values.length ? Number((values.reduce((sum, val) => sum + val, 0) / values.length).toFixed(2)) : null);

  return {
    avgSleep: avg(sleepValues),
    avgMood: avg(moodValues),
    lastEntry: sorted[0] ?? null,
    note: sorted.length ? null : "No wellness data logged",
  };
}

type PromptContext = {
  workoutSummary: Record<string, unknown>;
  historyTips: string[];
  cooldownExercises: string[];
  goal: string | null;
  vibe: string | null;
  wellness: Record<string, unknown>;
};

function buildPrompt(context: PromptContext) {
  const categoryLegend = TIP_CATEGORIES.map((category) => {
    const label = CATEGORY_LABELS[category] ?? category;
    return `${category}: ${label}`;
  }).join(", ");

  return `You are a strength coach AI. Generate motivating, specific advice.

User goal: ${context.goal ?? "unspecified"}
User vibe: ${context.vibe ?? "unspecified"}
Wellness snapshot: ${JSON.stringify(context.wellness)}

Recent tips to avoid repeating (14 days): ${JSON.stringify(context.historyTips)}
Exercises to deprioritize for 4-day cooldown: ${JSON.stringify(context.cooldownExercises)}

Workout sample (${context.workoutSummary.unit_preference}): ${JSON.stringify(context.workoutSummary)}

Rules:
1. Output EXACTLY 3 tips: 1 general principle + 2 personalized exercise tips.
2. Categories available: ${categoryLegend}. Each personalized tip must pick one.
3. Tips must be ≤40 words, motivating, and use emojis where natural.
4. Avoid paraphrasing recent tips. Give fresh angles (tempo, setup cues, recovery, balance, volume).
5. If data is thin for an exercise, say "Need more history" inside the tip.
6. Highlight progression when the goal is strength; mention recovery if sleep/mood is low (<6hr sleep or mood ≤5).

Return JSON in this shape:
{
  "session_focus": "string",
  "general_tip": { "tip": "string", "category": "recovery|balance|general" },
  "personalized_tips": [
    { "exercise": "string", "category": "one of allowed categories", "tip": "string <=40 words", "reason": "optional context" }
  ],
  "balance_notes": "string or null"
}`;
}

async function callGemini(prompt: string) {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.85,
          maxOutputTokens: 900,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API error:", errorText);
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const payload = await response.json();
  const aiText = payload.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!aiText) {
    throw new Error("Gemini response missing text payload");
  }

  return aiText;
}

type ParsedAiPayload = {
  session_focus?: string | null;
  general_tip: { tip: string; category: string };
  personalized_tips: Array<{ exercise: string; category: string; tip: string; reason?: string }>;
  balance_notes?: string | null;
};

function parseAiPayload(rawText: string): ParsedAiPayload | null {
  try {
    const data = JSON.parse(rawText);
    const general = typeof data.general_tip === "string"
      ? { tip: data.general_tip, category: "general" }
      : {
        tip: data.general_tip?.tip ?? "",
        category: data.general_tip?.category ?? "general",
      };

    const personalized = Array.isArray(data.personalized_tips)
      ? data.personalized_tips
          .map((tip: Record<string, string>) => ({
            exercise: tip.exercise ?? "",
            category: tip.category ?? "",
            tip: tip.tip ?? "",
            reason: tip.reason ?? undefined,
          }))
          .filter((tip) => tip.tip)
      : [];

    return {
      session_focus: data.session_focus ?? null,
      general_tip: general,
      personalized_tips: personalized,
      balance_notes: data.balance_notes ?? null,
    };
  } catch (error) {
    console.error("Failed to parse AI payload:", rawText, error);
    return null;
  }
}

function ensureGeneralTip(general: { tip: string; category: string }, normalizedHistory: string[]) {
  const normalized = normalizeTip(general.tip);
  if (!normalized || isSimilarToHistory(normalized, normalizedHistory)) {
    return { ...FALLBACK_GENERAL_TIP };
  }

  return {
    tip: `💡 ${general.tip.trim()}`,
    category: normalizeCategory(general.category) ?? "general",
  };
}

function normalizeCategory(input: string | null | undefined) {
  if (!input) return null;
  const value = input.toLowerCase();
  if (value.includes("progress")) return "progression";
  if (value.includes("tech") || value.includes("tempo") || value.includes("form")) return "technique_tempo";
  if (value.includes("rest") || value.includes("volume") || value.includes("set")) return "rest_volume";
  if (value.includes("recover") || value.includes("sleep") || value.includes("wellness")) return "recovery";
  if (value.includes("balance")) return "balance";
  return null;
}

type HistorySnapshot = {
  normalizedTips: string[];
  tipSamples: string[];
  exerciseCooldown: Map<string, Date>;
};

async function fetchRecentHistory(supabaseAdmin: ReturnType<typeof createClient>, userId: string): Promise<HistorySnapshot> {
  const historyStart = new Date();
  historyStart.setDate(historyStart.getDate() - NO_REPEAT_DAYS);

  const { data } = await supabaseAdmin
    .from("ai_suggestions")
    .select("tips, created_at, suggestions")
    .eq("user_id", userId)
    .gte("created_at", historyStart.toISOString())
    .order("created_at", { ascending: false })
    .limit(30);

  const normalizedTips: string[] = [];
  const tipSamples: string[] = [];
  const cooldown = new Map<string, Date>();

  data?.forEach((row) => {
    (row.tips ?? []).forEach((tip) => {
      if (typeof tip === "string") {
        const normalized = normalizeTip(tip);
        if (normalized) {
          normalizedTips.push(normalized);
        }
        tipSamples.push(tip);
      }
    });

    const personalized = Array.isArray((row as any).suggestions?.personalized)
      ? (row as any).suggestions.personalized
      : [];

    personalized.forEach((tip: any) => {
      const exercise = (tip.exercise ?? "").toString().toLowerCase().trim();
      if (!exercise) return;
      const existing = cooldown.get(exercise);
      const createdAt = new Date(row.created_at);
      if (!existing || existing < createdAt) {
        cooldown.set(exercise, createdAt);
      }
    });
  });

  return {
    normalizedTips,
    tipSamples,
    exerciseCooldown: cooldown,
  };
}

type NoveltyFilterInput = {
  candidates: Array<{ exercise: string; category: string; tip: string; reason?: string }>;
  historyNormalizedTips: string[];
  cooldownMap: Map<string, Date>;
};

function applyNoveltyFilters(input: NoveltyFilterInput) {
  const now = new Date();
  const selected: typeof input.candidates = [];
  const duplicateBlocked: typeof input.candidates = [];
  const cooldownBlocked: typeof input.candidates = [];
  const normalizedSelected = new Set<string>();

  for (const tip of input.candidates) {
    if (!tip.tip) continue;
    const normalizedTip = normalizeTip(tip.tip);
    if (!normalizedTip) continue;

    const cooldownHit = isExerciseOnCooldown(tip.exercise, input.cooldownMap, now);
    const duplicate = isSimilarToHistory(normalizedTip, input.historyNormalizedTips) || normalizedSelected.has(normalizedTip);

    if (!cooldownHit && !duplicate && selected.length < REQUIRED_PERSONALIZED_TIPS) {
      selected.push({
        ...tip,
        category: normalizeCategory(tip.category) ?? "progression",
      });
      normalizedSelected.add(normalizedTip);
      continue;
    }

    if (cooldownHit) {
      cooldownBlocked.push({ ...tip, category: normalizeCategory(tip.category) ?? "progression" });
    } else if (duplicate) {
      duplicateBlocked.push({ ...tip, category: normalizeCategory(tip.category) ?? "progression" });
    }
  }

  let relaxedFillCount = 0;
  const relaxationOrder = [cooldownBlocked, duplicateBlocked];
  for (const bucket of relaxationOrder) {
    for (const tip of bucket) {
      if (selected.length >= REQUIRED_PERSONALIZED_TIPS) break;
      selected.push(tip);
      relaxedFillCount += 1;
    }
  }

  return {
    selected,
    metrics: {
      duplicatesFiltered: duplicateBlocked.length,
      cooldownFiltered: cooldownBlocked.length,
      relaxedFillCount,
    },
  };
}

function normalizeTip(text: string) {
  return text
    .toLowerCase()
    .replace(/[\u{1F300}-\u{1F6FF}]/gu, " ")
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isSimilarToHistory(normalized: string, history: string[]) {
  return history.some((entry) => tipSimilarity(entry, normalized) >= 0.7);
}

function tipSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  const tokensA = new Set(a.split(" ").filter(Boolean));
  const tokensB = new Set(b.split(" ").filter(Boolean));
  if (!tokensA.size || !tokensB.size) return 0;

  let intersection = 0;
  tokensA.forEach((token) => {
    if (tokensB.has(token)) {
      intersection += 1;
    }
  });
  const union = tokensA.size + tokensB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function isExerciseOnCooldown(exercise: string, cooldown: Map<string, Date>, now: Date) {
  if (!exercise) return false;
  const normalized = exercise.toLowerCase().trim();
  const lastDate = cooldown.get(normalized);
  if (!lastDate) return false;
  const diff = now.getTime() - lastDate.getTime();
  const diffDays = diff / (1000 * 60 * 60 * 24);
  return diffDays < EXERCISE_COOLDOWN_DAYS;
}

function dateWithinDays(date: Date, days: number) {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  return diff / (1000 * 60 * 60 * 24) <= days;
}

function formatTips(
  general: { tip: string; category: string },
  personalized: Array<{ exercise: string; category: string; tip: string }>,
) {
  const tips = [
    general.tip.startsWith("💡") ? general.tip : `💡 ${general.tip}`,
    ...personalized.map((tip) => {
      const label = CATEGORY_LABELS[tip.category] ?? "Focus";
      const exerciseLabel = tip.exercise ? `${tip.exercise}: ` : "";
      return `💪 [${label}] ${exerciseLabel}${tip.tip}`;
    }),
  ];

  const categories = ["general", ...personalized.map((tip) => tip.category)];

  return { tips, categories };
}

async function storeTipsAndRespond(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  userId: string;
  currentCount: number;
  today: string;
  formattedTips: string[];
  tipCategories: string[];
  sessionFocus: string;
  suggestionsPayload: Record<string, unknown>;
  tipMetadata: Record<string, unknown>;
  origin: string | null;
}) {
  const {
    supabaseAdmin,
    userId,
    currentCount,
    today,
    formattedTips,
    tipCategories,
    sessionFocus,
    suggestionsPayload,
    tipMetadata,
    origin,
  } = params;

  const insertResult = await supabaseAdmin.from("ai_suggestions").insert({
    user_id: userId,
    tips: formattedTips,
    session_focus: sessionFocus,
    suggestions: suggestionsPayload,
    tip_categories: tipCategories,
    tip_metadata: tipMetadata,
  });

  if (insertResult.error) {
    console.error("Database insert error:", insertResult.error);
    return jsonResponse(
      {
        error: "Database error",
        message: insertResult.error.message,
      },
      origin,
      500
    );
  }

  const newCount = currentCount + 1;
  const { error: trackingError } = await supabaseAdmin
    .from("ai_usage_tracking")
    .upsert(
      {
        user_id: userId,
        date: today,
        request_count: newCount,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );

  if (trackingError) {
    console.error("Error updating usage tracking:", trackingError);
  }

  const remaining = Math.max(0, DAILY_LIMIT - newCount);
  return jsonResponse({
    tips: formattedTips,
    remaining,
    daily_limit: DAILY_LIMIT,
    message: `${remaining} of ${DAILY_LIMIT} suggestion${remaining === 1 ? "" : "s"} remaining today`,
  }, origin);
}

async function respondWithFallbackTips(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  userId: string;
  currentCount: number;
  today: string;
  sessionFocus: string;
  reason: string;
  origin: string | null;
  extraMetadata?: Record<string, unknown>;
}) {
  const fallbackTips = formatTips(
    { tip: FALLBACK_GENERAL_TIP.tip, category: "general" },
    FALLBACK_PERSONALIZED_TIPS.map((tip) => ({ ...tip })),
  );

  return storeTipsAndRespond({
    supabaseAdmin: params.supabaseAdmin,
    userId: params.userId,
    currentCount: params.currentCount,
    today: params.today,
    formattedTips: fallbackTips.tips,
    tipCategories: fallbackTips.categories,
    sessionFocus: params.sessionFocus,
    suggestionsPayload: {
      general: FALLBACK_GENERAL_TIP,
      personalized: FALLBACK_PERSONALIZED_TIPS,
      fallback_reason: params.reason,
    },
    tipMetadata: {
      fallback_reason: params.reason,
      feature_flag: "AI_TIPS_VARIETY_V1",
      ...(params.extraMetadata ?? {}),
    },
    origin: params.origin,
  });
}
