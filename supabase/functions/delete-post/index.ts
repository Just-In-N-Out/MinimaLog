import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";
import { getCorsHeaders, handleCorsPreflightRequest, createCorsResponse } from "../_shared/cors.ts";

serve(async (req) => {
  const origin = req.headers.get("origin");

  if (req.method === "OPTIONS") {
    return handleCorsPreflightRequest(origin);
  }

  if (req.method !== "POST") {
    return createCorsResponse(
      { error: "Method not allowed" },
      origin,
      405
    );
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Missing Supabase environment configuration");
    }

    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return createCorsResponse(
        { error: "Missing authorization header" },
        origin,
        401
      );
    }

    const token = authHeader.replace("Bearer ", "");

    const supabaseAuth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data: userData, error: authError } = await supabaseAuth.auth.getUser(token);

    if (authError || !userData?.user) {
      return createCorsResponse(
        { error: "Unauthorized" },
        origin,
        401
      );
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.postId !== "string") {
      return createCorsResponse(
        { error: "Invalid request body" },
        origin,
        400
      );
    }

    const { postId } = body;
    console.log("Invoking delete_post_and_recompute_prs", {
      userId: userData.user.id,
      postId,
    });

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const { data, error } = await supabaseAdmin.rpc("delete_post_and_recompute_prs", {
      p_user_id: userData.user.id,
      p_post_id: postId,
    });

    if (error) {
      console.error("delete_post_and_recompute_prs error:", error);
      const status = error.code === "P0201"
        ? 404
        : error.code === "42501"
        ? 403
        : 400;

      return createCorsResponse(
        { error: error.message || "Failed to delete post" },
        origin,
        status
      );
    }

    return createCorsResponse(
      {
        success: true,
        updatedPrs: data?.prs ?? [],
        summary: data?.summary ?? {},
      },
      origin,
      200
    );
  } catch (error) {
    console.error("Unexpected delete-post failure:", error);
    return createCorsResponse(
      { error: "Internal server error" },
      origin,
      500
    );
  }
});
