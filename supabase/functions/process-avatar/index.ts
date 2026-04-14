import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.74.0";

serve(async (req) => {
  try {
    // Log request details for debugging
    console.log("Request method:", req.method);
    console.log("Content-Type:", req.headers.get("content-type"));

    // Only accept POST requests
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get auth header
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Missing authorization" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Create Supabase client
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );

    // Get user
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser();

    if (userError || !user) {
      console.error("Auth error:", userError);
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("User authenticated:", user.id);

    // Parse the request body
    let formData: FormData;
    let file: File | null = null;

    try {
      // Try to parse as FormData regardless of Content-Type header
      // Some mobile apps don't set the header correctly
      formData = await req.formData();
      console.log("FormData parsed successfully");

      file = formData.get("file") as File;
      console.log("File from form data:", file ? file.name : "null");

      if (!file) {
        // Check all form data keys for debugging
        const keys = Array.from(formData.keys());
        console.log("FormData keys:", keys);
      }
    } catch (e: any) {
      console.error("FormData parsing error:", e);
      const contentType = req.headers.get("content-type") || "not set";

      // Try to get more details about the error
      const errorDetails = {
        message: e.message || "Unknown error",
        name: e.name || "Error",
        stack: e.stack || "No stack trace"
      };

      console.error("Error details:", errorDetails);

      return new Response(
        JSON.stringify({
          error: "Failed to parse request",
          message: `Could not parse form data. Content-Type: ${contentType}. Error: ${e.message || "Unknown error"}`
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!file) {
      console.error("No file in form data");
      return new Response(
        JSON.stringify({ error: "No file provided in form data" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    console.log("File details:", {
      name: file.name,
      type: file.type,
      size: file.size
    });

    // Validate file type (be lenient if type is not provided)
    const validTypes = ["image/jpeg", "image/jpg", "image/png", "image/webp", ""];
    const fileType = file.type.toLowerCase();

    // Check file extension as fallback
    const fileExt = file.name.split(".").pop()?.toLowerCase() || "";
    const validExtensions = ["jpg", "jpeg", "png", "webp"];

    if (!validTypes.includes(fileType) && !validExtensions.includes(fileExt)) {
      return new Response(
        JSON.stringify({ error: `Invalid file type. Only JPEG, PNG, and WebP are allowed. Received: ${file.type || "unknown"}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate file size (5MB max)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      return new Response(
        JSON.stringify({ error: "File too large. Maximum size is 5MB" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Generate filename: userId/timestamp.ext
    const timestamp = Date.now();
    const fileName = `${user.id}/${timestamp}.${fileExt}`;

    console.log("Uploading file:", fileName);

    // Determine content type for storage
    const storageContentType = file.type || `image/${fileExt === "jpg" ? "jpeg" : fileExt}`;

    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabaseClient
      .storage
      .from("avatars")
      .upload(fileName, file, {
        contentType: storageContentType,
        upsert: false,
      });

    console.log("Upload result:", { data: uploadData, error: uploadError });

    if (uploadError) {
      console.error("Upload error:", uploadError);
      return new Response(
        JSON.stringify({ error: "Failed to upload file", message: uploadError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get public URL
    const { data: { publicUrl } } = supabaseClient
      .storage
      .from("avatars")
      .getPublicUrl(fileName);

    // Update user's profile with the new avatar URL
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { error: updateError } = await supabaseAdmin
      .from("profiles")
      .update({ avatar_url: publicUrl })
      .eq("id", user.id);

    if (updateError) {
      console.error("Profile update error:", updateError);
      // Try to delete the uploaded file if profile update fails
      await supabaseClient.storage.from("avatars").remove([fileName]);

      return new Response(
        JSON.stringify({ error: "Failed to update profile", message: updateError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Return success
    return new Response(
      JSON.stringify({
        success: true,
        avatar_url: publicUrl,
        message: "Profile picture updated successfully",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: "Internal error",
        message: error.message
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
