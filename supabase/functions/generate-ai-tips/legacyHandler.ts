import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const LEGACY_DAILY_LIMIT = Number(Deno.env.get("AI_TIPS_DAILY_LIMIT_LEGACY") ?? "3");

export async function handleLegacyRequest(req: Request, origin: string | null): Promise<Response> {
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        {
          status: 401,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        {
          status: 401,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const today = new Date().toISOString().split("T")[0];
    const { data: usageData, error: usageError } = await supabaseAdmin
      .from("ai_usage_tracking")
      .select("request_count")
      .eq("user_id", user.id)
      .eq("date", today)
      .maybeSingle();

    if (usageError && usageError.code !== "PGRST116") {
      console.error("Error checking usage:", usageError);
      return new Response(
        JSON.stringify({ error: "Database error", message: usageError.message }),
        {
          status: 500,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const currentCount = usageData?.request_count ?? 0;

    if (currentCount >= LEGACY_DAILY_LIMIT) {
      return new Response(
        JSON.stringify({
          error: "Daily limit reached",
          message: `You've used all ${LEGACY_DAILY_LIMIT} daily suggestions. Come back tomorrow!`,
          remaining: 0,
        }),
        {
          status: 200,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("unit_default")
      .eq("id", user.id)
      .single();

    const userUnit = profile?.unit_default || "kg";

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const { data: workouts } = await supabaseAdmin
      .from("workouts")
      .select("id, started_at, ended_at")
      .eq("user_id", user.id)
      .gte("started_at", twoWeeksAgo.toISOString())
      .not("ended_at", "is", null)
      .order("started_at", { ascending: false });

    if (!workouts || workouts.length === 0) {
      return await storeAndReturnGeneralTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        tips: [
          "Start tracking your workouts consistently to get personalized AI insights based on your progress.",
          "Focus on compound movements like squats, deadlifts, and bench press to build a strong foundation.",
          "Progressive overload is key - aim to gradually increase weight, reps, or sets over time.",
        ],
        origin,
      });
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
      console.error("Error fetching workout exercises:", weError);
      throw new Error(`Database error: ${weError.message}`);
    }

    const workoutExerciseIds = workoutExercises?.map((we) => we.id) || [];

    if (workoutExerciseIds.length === 0) {
      return await storeAndReturnGeneralTips({
        supabaseAdmin,
        userId: user.id,
        currentCount,
        today,
        tips: [
          "Start adding exercises to your workouts to get personalized insights.",
          "Focus on compound movements like squats, deadlifts, and bench press.",
          "Track your sets, reps, and weights consistently for better AI analysis.",
        ],
        origin,
      });
    }

    const { data: sets, error: setsError } = await supabaseAdmin
      .from("sets")
      .select("workout_exercise_id, weight, reps, unit, is_warmup, created_at")
      .in("workout_exercise_id", workoutExerciseIds)
      .eq("is_warmup", false)
      .order("created_at", { ascending: true });

    if (setsError) {
      console.error("Error fetching sets:", setsError);
      throw new Error(`Database error: ${setsError.message}`);
    }

    const exerciseProgressionMap = new Map<string, any>();

    workoutExercises?.forEach((we) => {
      const exerciseName = we.exercise?.name;
      if (!exerciseName) return;

      const exerciseSets = sets?.filter((s) => s.workout_exercise_id === we.id) || [];
      if (exerciseSets.length === 0) return;

      if (!exerciseProgressionMap.has(exerciseName)) {
        exerciseProgressionMap.set(exerciseName, {
          name: exerciseName,
          muscle_group: we.exercise?.muscle_group,
          equipment: we.exercise?.equipment,
          sets: [],
        });
      }

      const workout = workouts.find((w) => w.id === we.workout_id);
      exerciseSets.forEach((set) => {
        exerciseProgressionMap.get(exerciseName).sets.push({
          weight: set.weight,
          reps: set.reps,
          unit: set.unit,
          date: workout?.started_at,
        });
      });
    });

    const exerciseProgressions = Array.from(exerciseProgressionMap.values())
      .filter((ex) => ex.sets.length >= 3)
      .sort((a, b) => b.sets.length - a.sets.length)
      .slice(0, 5);

    const workoutSummary = {
      total_workouts: workouts.length,
      period: "last 2 weeks",
      unit_preference: userUnit,
      exercises: exerciseProgressions.map((ex) => {
        const firstSets = ex.sets.slice(0, 2);
        const lastSets = ex.sets.slice(-2);
        const displaySets = firstSets.concat(lastSets);

        return {
          name: ex.name,
          muscle_group: ex.muscle_group,
          sets_summary: displaySets.map((s) => ({
            weight: s.weight,
            reps: s.reps,
            unit: s.unit,
          })),
        };
      }),
    };

    const GEMINI_API_KEY = Deno.env.get("GOOGLE_GEMINI_API_KEY");

    if (!GEMINI_API_KEY) {
      console.error("GOOGLE_GEMINI_API_KEY not set");
      return new Response(
        JSON.stringify({ error: "API configuration error" }),
        {
          status: 500,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const prompt = `Analyze workout data:

${JSON.stringify(workoutSummary)}

Provide JSON with:
1. general_tip: One general training principle (max 30 words)
2. personalized_tips: Array of 2 exercise tips with "exercise" and "tip" (max 40 words each)

Format:
{"general_tip":"...","personalized_tips":[{"exercise":"...","tip":"..."},{"exercise":"...","tip":"..."}]}

Keep tips concise, specific, with actual weights/reps.`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: prompt,
                },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 800,
            responseMimeType: "application/json",
          },
        }),
      },
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error("Gemini API error:", errorText);
      throw new Error(`Gemini API error: ${geminiResponse.status}`);
    }

    const geminiData = await geminiResponse.json();
    const aiText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      console.error("Gemini response missing text:", geminiData);
      throw new Error("No response from Gemini API");
    }

    let aiTips;
    try {
      aiTips = JSON.parse(aiText);
    } catch (parseError) {
      console.error("Failed to parse AI response:", aiText);
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        aiTips = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("Invalid AI response format");
      }
    }

    if (
      !aiTips.general_tip ||
      !Array.isArray(aiTips.personalized_tips) ||
      aiTips.personalized_tips.length < 2
    ) {
      console.error("Invalid AI tips structure:", aiTips);
      throw new Error("AI returned incomplete tips");
    }

    const formattedTips = [
      `💡 ${aiTips.general_tip}`,
      `💪 ${aiTips.personalized_tips[0].exercise}: ${aiTips.personalized_tips[0].tip}`,
      `💪 ${aiTips.personalized_tips[1].exercise}: ${aiTips.personalized_tips[1].tip}`,
    ];

    const { error: insertError } = await supabaseAdmin
      .from("ai_suggestions")
      .insert({
        user_id: user.id,
        tips: formattedTips,
        session_focus: "Personalized Training Tips",
        suggestions: {
          general: aiTips.general_tip,
          personalized: aiTips.personalized_tips,
        },
      });

    if (insertError) {
      console.error("Database insert error:", insertError);
      return new Response(
        JSON.stringify({
          error: "Database error",
          message: insertError.message,
          code: insertError.code,
        }),
        {
          status: 500,
          headers: {
            ...getCorsHeaders(origin),
            "Content-Type": "application/json"
          }
        }
      );
    }

    const newCount = currentCount + 1;
    const { error: trackingError } = await supabaseAdmin
      .from("ai_usage_tracking")
      .upsert(
        {
          user_id: user.id,
          date: today,
          request_count: newCount,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,date",
        },
      );

    if (trackingError) {
      console.error("Error updating usage tracking:", trackingError);
    }

    const remaining = Math.max(0, LEGACY_DAILY_LIMIT - newCount);

    return new Response(
      JSON.stringify({
        tips: formattedTips,
        remaining,
        message: `${remaining} suggestion${remaining === 1 ? "" : "s"} remaining today`,
      }),
      {
        status: 200,
        headers: {
          ...getCorsHeaders(origin),
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("Legacy AI tips error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          ...getCorsHeaders(origin),
          "Content-Type": "application/json"
        }
      }
    );
  }
}

async function storeAndReturnGeneralTips(params: {
  supabaseAdmin: ReturnType<typeof createClient>;
  userId: string;
  currentCount: number;
  today: string;
  tips: string[];
  origin: string | null;
}) {
  const { supabaseAdmin, userId, currentCount, today, tips, origin } = params;

  const insertResult = await supabaseAdmin.from("ai_suggestions").insert({
    user_id: userId,
    tips,
    session_focus: "Get Started",
    suggestions: {},
  });

  if (insertResult.error) {
    console.error("Database insert error:", insertResult.error);
  }

  await supabaseAdmin
    .from("ai_usage_tracking")
    .upsert(
      {
        user_id: userId,
        date: today,
        request_count: currentCount + 1,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );

  const remaining = Math.max(0, LEGACY_DAILY_LIMIT - (currentCount + 1));

  return new Response(
    JSON.stringify({
      tips,
      remaining,
      message: `${remaining} suggestion${remaining === 1 ? "" : "s"} remaining today`,
    }),
    {
      status: 200,
      headers: {
        ...getCorsHeaders(origin),
        "Content-Type": "application/json"
      }
    }
  );
}
