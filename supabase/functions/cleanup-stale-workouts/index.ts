import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Create Supabase client with service role key for elevated permissions
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    console.log("Starting stale workout cleanup...");

    // Call the database function to cleanup stale workouts
    const { data, error } = await supabase.rpc("cleanup_stale_workouts");

    if (error) {
      console.error("Error cleaning up stale workouts:", error);
      throw error;
    }

    const deletedCount = data?.length || 0;
    const deletedWorkouts = data || [];

    console.log(`Successfully deleted ${deletedCount} stale workouts`);

    if (deletedCount > 0) {
      console.log("Deleted workout IDs:", deletedWorkouts.map((w: any) => ({
        id: w.deleted_workout_id,
        startedAt: w.started_at
      })));
    }

    return new Response(
      JSON.stringify({
        success: true,
        deletedCount,
        deletedWorkouts,
        message: `Cleaned up ${deletedCount} stale workout(s) that were active for more than 48 hours`,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    console.error("Function error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
