import { supabase } from "@/integrations/supabase/client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface SyncOptions {
  attempts?: number;
  delayMs?: number;
}

interface SupabaseErrorInfo {
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  code?: string | null;
}

export interface SyncProfileFirstNameResult {
  success: boolean;
  storedName?: string;
  attempts: number;
  errorMessage?: string;
  supabaseError?: SupabaseErrorInfo;
  lastResponse?: unknown;
}

const formatSupabaseError = (error: unknown): SupabaseErrorInfo => {
  if (!error || typeof error !== "object") {
    return { message: typeof error === "string" ? error : JSON.stringify(error) };
  }

  const typed = error as Record<string, unknown>;
  return {
    message: typeof typed.message === "string" ? typed.message : undefined,
    details: typeof typed.details === "string" ? typed.details : null,
    hint: typeof typed.hint === "string" ? typed.hint : null,
    code: typeof typed.code === "string" ? typed.code : null,
  };
};

const normalizeNameValue = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "user") return "";
  return trimmed;
};

export const syncProfileFirstName = async (
  userId: string,
  rawFirstName: string,
  options: SyncOptions = {}
): Promise<SyncProfileFirstNameResult> => {
  const firstName = rawFirstName.trim();
  if (import.meta.env.DEV) console.log("syncProfileFirstName invoked:", {
    userId,
    rawFirstName,
    normalizedFirstName: firstName,
  });

  if (!userId) {
    const errorMessage = "syncProfileFirstName aborted: missing userId";
    if (import.meta.env.DEV) console.warn(errorMessage);
    return { success: false, attempts: 0, errorMessage };
  }

  if (!firstName) {
    const errorMessage = "syncProfileFirstName aborted: empty firstName";
    if (import.meta.env.DEV) console.warn(errorMessage);
    return { success: false, attempts: 0, errorMessage };
  }

  const attempts = options.attempts ?? 40;
  const delayMs = options.delayMs ?? 200;

  const {
    data: sessionData,
    error: sessionError,
  } = await supabase.auth.getSession();

  if (import.meta.env.DEV) console.log("syncProfileFirstName session fetch result:", {
    sessionError,
    sessionUserId: sessionData?.session?.user?.id,
    sessionAccessTokenPresent: Boolean(sessionData?.session?.access_token),
  });

  if (sessionError) {
    if (import.meta.env.DEV)
      console.warn("syncProfileFirstName: error retrieving Supabase session");
  }

  let lastErrorMessage = "";
  let lastSupabaseError: SupabaseErrorInfo | undefined;
  let lastResponse: unknown;
  const COLUMN_CANDIDATES = ["full_name", "name"] as const;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      if (import.meta.env.DEV)
        console.log("syncProfileFirstName attempt:", { attempt, attempts });

      for (const column of COLUMN_CANDIDATES) {
        const updatePayload: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };
        updatePayload[column] = firstName;

        const selectClause = `id, ${column}`;
        const attemptStart = Date.now();
        const { data, error } = await supabase
          .from("profiles")
          .update(updatePayload)
          .eq("id", userId)
          .select(selectClause)
          .maybeSingle();
        const durationMs = Date.now() - attemptStart;

        lastResponse = { column, data, error, durationMs };

        if (import.meta.env.DEV)
          console.log("syncProfileFirstName update response:", {
            attempt,
            column,
            durationMs,
          });

        if (error) {
          const formattedError = formatSupabaseError(error);
          const columnMissing =
            formattedError.code === "42703" ||
            (formattedError.message || "").toLowerCase().includes("column") ||
            (formattedError.message || "").toLowerCase().includes(`${column}`);

          if (import.meta.env.DEV)
            console.warn("syncProfileFirstName: update failed", {
              attempt,
              column,
              columnMissing,
            });

          if (columnMissing) {
            lastSupabaseError = formattedError;
            continue;
          }

          return {
            success: false,
            attempts: attempt,
            errorMessage: formattedError.message ?? "Unknown Supabase error during update.",
            supabaseError: formattedError,
            lastResponse,
          };
        }

        const storedValue =
          data && typeof data[column] === "string" ? normalizeNameValue(data[column]) : "";
        const success = storedValue === firstName;

        if (import.meta.env.DEV)
          console.log("syncProfileFirstName: stored name verification:", {
            attempt,
            column,
            success,
          });

        if (success) {
          if (import.meta.env.DEV)
            console.log("syncProfileFirstName: update succeeded via column:", column);
          return {
            success: true,
            attempts: attempt,
            storedName: storedValue,
            lastResponse,
          };
        }

        lastErrorMessage = `Stored value '${storedValue}' in column '${column}' did not match expected '${firstName}'. Retrying.`;
        if (import.meta.env.DEV) console.warn("syncProfileFirstName:", lastErrorMessage);
      }
    } catch (error) {
      const formattedError = formatSupabaseError(error);
      if (import.meta.env.DEV)
        console.warn("syncProfileFirstName: unexpected error during update attempt:", {
          attempt,
          supabaseError: formattedError,
        });
      return {
        success: false,
        attempts: attempt,
        errorMessage: formattedError.message ?? "Unexpected error during profile update.",
        supabaseError: formattedError,
        lastResponse,
      };
    }

    if (attempt < attempts) {
      await sleep(delayMs);
    }
  }

  if (import.meta.env.DEV)
    console.warn(
      "syncProfileFirstName: exhausted attempts without success. Fetching final profile state."
    );
  try {
    for (const column of COLUMN_CANDIDATES) {
      const { data: finalProfile, error: finalError } = await supabase
        .from("profiles")
        .select(`id, ${column}`)
        .eq("id", userId)
        .maybeSingle();

      lastResponse = { column, finalProfile, finalError };
      if (import.meta.env.DEV)
        console.log("syncProfileFirstName final profile check:", {
          column,
          hasError: Boolean(finalError),
        });

      if (finalError) {
        const formattedError = formatSupabaseError(finalError);
        lastSupabaseError = formattedError;
        continue;
      }

      if (finalProfile && typeof finalProfile[column] === "string") {
        const stored = normalizeNameValue(finalProfile[column]);
        if (stored === firstName) {
          if (import.meta.env.DEV)
            console.log(
              "syncProfileFirstName: final profile check shows desired name despite earlier failures."
            );
          return {
            success: true,
            attempts,
            storedName: stored,
            lastResponse,
          };
        }
      }
    }
  } catch (finalCheckError) {
    const formattedError = formatSupabaseError(finalCheckError);
    lastSupabaseError = formattedError;
    if (import.meta.env.DEV)
      console.warn("syncProfileFirstName: error during final profile check:", {
        supabaseError: formattedError,
      });
  }

  return {
    success: false,
    attempts,
    errorMessage:
      lastErrorMessage ||
      "Unable to persist first name to profile. Check RLS policies and Supabase logs for more details.",
    supabaseError: lastSupabaseError,
    lastResponse,
  };
};
