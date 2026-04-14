const getUrl = (value: string): URL | null => {
  try {
    if (value.includes("://")) {
      return new URL(value);
    }

    if (typeof window !== "undefined" && window.location?.origin) {
      return new URL(value, window.location.origin);
    }

    return new URL(value, "https://localhost");
  } catch {
    return null;
  }
};

/**
 * Extracts the OAuth `code` parameter from a callback URL that might use a custom scheme.
 * Returns null when no code is present.
 */
export const extractOAuthCode = (input: string | URL | null | undefined): string | null => {
  if (!input) return null;

  const url = typeof input === "string" ? getUrl(input) : input;

  try {
    if (url) {
      const searchCode = url.searchParams.get("code");
      if (searchCode) return searchCode;

      if (url.hash) {
        const hashParams = new URLSearchParams(url.hash.replace("#", ""));
        const hashCode = hashParams.get("code");
        if (hashCode) return hashCode;
      }
    }
  } catch {
    // Ignore and fall back to manual parsing
  }

  if (typeof input === "string") {
    const match = input.match(/[?&]code=([^&#]+)/);
    if (match?.[1]) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
  }

  return null;
};
