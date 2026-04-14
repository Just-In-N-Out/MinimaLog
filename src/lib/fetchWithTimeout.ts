export interface FetchWithTimeoutInit extends RequestInit {
  timeoutMs?: number;
}

export const fetchWithTimeout = async (
  input: RequestInfo | URL,
  init: FetchWithTimeoutInit = {}
): Promise<Response> => {
  const { timeoutMs = 12000, signal: externalSignal, ...rest } = init;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const handleExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener("abort", handleExternalAbort, { once: true });
    }
  }

  try {
    return await fetch(input, {
      ...rest,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
    if (externalSignal) {
      externalSignal.removeEventListener("abort", handleExternalAbort);
    }
  }
};

