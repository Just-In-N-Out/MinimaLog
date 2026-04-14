type SupportsAbort<T> = Promise<T> & {
  abortSignal?: (signal: AbortSignal) => unknown;
};

export const runWithSupabaseTimeout = async <T>(
  request: SupportsAbort<T>,
  timeoutMs = 12000
): Promise<T> => {
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      const timeoutError = new Error("Supabase request timed out");
      timeoutError.name = "TimeoutError";
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    if (typeof request.abortSignal === "function") {
      request.abortSignal(controller.signal);
    }
    return await Promise.race([request, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
};
