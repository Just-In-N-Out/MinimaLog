import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.74.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get('GOOGLE_GEMINI_API_KEY');
    const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get user from authorization header
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'No authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Fetching workout data for user:', user.id);

    // Get user's recent workouts (last 4 weeks)
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);

    const { data: workouts, error: workoutsError } = await supabase
      .from('workouts')
      .select('*')
      .eq('user_id', user.id)
      .gte('started_at', fourWeeksAgo.toISOString())
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false });

    if (workoutsError) throw workoutsError;

    if (!workouts || workouts.length === 0) {
      return new Response(JSON.stringify({
        error: 'insufficient_data',
        message: 'Need at least one completed workout to generate suggestions'
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get workout exercises and sets for these workouts
    const workoutIds = workouts.map(w => w.id);

    const { data: workoutExercises, error: weError } = await supabase
      .from('workout_exercises')
      .select('*, exercise:exercises(*)')
      .in('workout_id', workoutIds);

    if (weError) throw weError;

    const { data: sets, error: setsError } = await supabase
      .from('sets')
      .select('*')
      .in('workout_exercise_id', workoutExercises?.map(we => we.id) || [])
      .eq('is_warmup', false);

    if (setsError) throw setsError;

    // Get session metrics for wellness data
    const { data: metrics, error: metricsError } = await supabase
      .from('session_metrics')
      .select('*')
      .in('workout_id', workoutIds);

    if (metricsError) throw metricsError;

    // Get user preferences
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('unit_default')
      .eq('id', user.id)
      .single();

    if (profileError) throw profileError;

    // Prepare data for AI
    const workoutData = {
      workouts: workouts.map(w => ({
        id: w.id,
        date: w.started_at,
        duration: w.ended_at ? new Date(w.ended_at).getTime() - new Date(w.started_at).getTime() : 0
      })),
      exercises: workoutExercises?.map(we => ({
        workout_id: we.workout_id,
        exercise_name: we.exercise.name,
        muscle_group: we.exercise.muscle_group,
        equipment: we.exercise.equipment,
        sets: sets?.filter(s => s.workout_exercise_id === we.id).map(s => ({
          weight: s.weight,
          reps: s.reps,
          unit: s.unit,
          rpe: s.rpe,
          rir: s.rir
        }))
      })),
      metrics: metrics?.map(m => ({
        workout_id: m.workout_id,
        sleep: m.sleep,
        mood: m.mood,
        preworkout: m.preworkout
      })),
      unit_preference: profile?.unit_default || 'kg'
    };

    console.log('Sending data to Gemini AI for analysis');

    const prompt = `You are an expert strength coach analyzing workout data. Provide actionable suggestions for the next training session.

Rules:
1. Progression: If consistently hitting target reps at manageable effort (RPE <8 or RIR >2), suggest 2.5-5% increase. If effort very high (RPE 9-10 or RIR 0-1), suggest decrease. Otherwise hold.
2. Deload: If effort trending up across 2+ weeks while top weight stalls, suggest deload (10-15% load reduction, fewer sets).
3. Balance: If push work exceeds pull by >30% over 2 weeks (or vice versa), recommend corrective sets.
4. Safety: Cap increases to 2.5-5% per week. If sleep <6hrs or mood ≤5/10, suggest lighter day.
5. Data: If <3 recent sets for an exercise, say "Need more history".

Analyze this workout data and provide suggestions:

${JSON.stringify(workoutData, null, 2)}

Output JSON with this structure:
{
  "session_focus": "string or null (e.g. 'Deload week' or 'Balance focus: Pull')",
  "suggestions": [
    {
      "exercise_name": "string",
      "target_weight": number,
      "target_reps": number,
      "unit": "kg or lb",
      "indicator": "↑ or → or ↓",
      "reasoning": "string (2-3 sentences max)"
    }
  ],
  "balance_notes": "string or null (e.g. 'Consider adding 2 sets of rows this week')"
}`;

    // Call Google Gemini API directly
    const aiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
            maxOutputTokens: 1500,
          },
        }),
      }
    );

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('Gemini API error:', aiResponse.status, errorText);

      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({
          error: 'rate_limit',
          message: 'Rate limit exceeded. Please try again in a moment.'
        }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      throw new Error(`Gemini API error: ${errorText}`);
    }

    const aiData = await aiResponse.json();
    console.log('Gemini AI response received');

    const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      throw new Error('No response from Gemini API');
    }

    // Parse JSON from AI response (handle potential markdown code blocks)
    let suggestions;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      const jsonStr = jsonMatch ? jsonMatch[0] : aiText;
      suggestions = JSON.parse(jsonStr);
    } catch (parseError) {
      console.error('Failed to parse AI response:', aiText);
      throw new Error('Invalid AI response format');
    }

    // Store suggestions in database
    const { error: insertError } = await supabase
      .from('ai_suggestions')
      .insert({
        user_id: user.id,
        session_focus: suggestions.session_focus || null,
        suggestions: suggestions.suggestions,
        balance_notes: suggestions.balance_notes || null
      });

    if (insertError) {
      console.error('Error storing suggestions:', insertError);
    }

    return new Response(JSON.stringify(suggestions), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-workout-suggestions:', error);
    return new Response(JSON.stringify({
      error: 'internal_error',
      message: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
