import { useState, useEffect } from "react";
import {
  getCachedExerciseImageUrl,
  downloadAndCacheExerciseImageToFilesystem,
} from "@/lib/cache/exerciseImageFilesystemCache";
import { useNetworkStore } from "@/lib/network";

const fallbackUrlCache = new Map<string, string>();
const PLACEHOLDER_IMAGE_URL = "/placeholder.svg";

interface UseExerciseImageResult {
  /** The image src (file:// URL or network URL) */
  src: string | null;
  /** Whether the image is currently loading from network */
  isLoading: boolean;
  /** Whether the image is cached locally */
  isCached: boolean;
}

/**
 * Hook to get exercise image with automatic filesystem caching
 *
 * - First checks filesystem cache for the image
 * - If cached, returns file:// URL for instant offline loading
 * - If not cached and online, returns network URL and downloads in background
 * - No cleanup needed (file:// URLs don't need revocation)
 *
 * @param exerciseId - The exercise ID
 * @param imageUrl - The network URL of the exercise image
 * @param disableAutoCache - If true, skip automatic background caching (default: false)
 * @returns Object with src, isLoading, and isCached
 */
export const useExerciseImage = (
  exerciseId: string | null | undefined,
  imageUrl: string | null | undefined,
  disableAutoCache: boolean = false,
  exerciseName?: string
): UseExerciseImageResult => {
  const [src, setSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isCached, setIsCached] = useState(false);

  const fetchFallbackImageUrl = async (): Promise<string | null> => {
    if (!exerciseName) return null;

    const cacheKey = exerciseName.trim().toLowerCase();
    const cached = fallbackUrlCache.get(cacheKey);
    if (cached) return cached;

    try {
      const normalize = (value: string) =>
        value
          .trim()
          .toLowerCase()
          // Remove common suffixes/prefixes and punctuation for better matching
          .replace(/\(unilateral\)/gi, "")
          .replace(/[^a-z0-9\s]/gi, " ")
          .replace(/\s+/g, " ")
          .trim();

      const tokenize = (value: string) => normalize(value).split(" ").filter(Boolean);

      const scoreNameMatch = (candidate: string, target: string) => {
        const candTokens = new Set(tokenize(candidate));
        const targetTokens = new Set(tokenize(target));

        if (targetTokens.size === 0 || candTokens.size === 0) return 0;

        let overlap = 0;
        targetTokens.forEach((token) => {
          if (candTokens.has(token)) overlap += 1;
        });

        // Jaccard-like score to penalize partial matches that share only one word
        const unionSize = candTokens.size + targetTokens.size - overlap;
        const tokenScore = unionSize > 0 ? overlap / unionSize : 0;

        // Small bonus for prefix match
        const prefixBonus = normalize(candidate).startsWith(normalize(target)) ? 0.15 : 0;

        // Exact normalized match is a perfect score
        if (normalize(candidate) === normalize(target)) {
          return 1;
        }

        return Math.min(1, tokenScore + prefixBonus);
      };

      const query = encodeURIComponent(exerciseName);
      // The ExerciseDB API expects the query in the `search` parameter
      // Use a small page size so we can pick the best match rather than the first partial match
      const response = await fetch(`https://v1.exercisedb.dev/api/v1/exercises?limit=5&search=${query}`);

      if (!response.ok) {
        debugLog("🔎 Fallback search failed", { status: response.status });
        return null;
      }

      const data = await response.json();
      const results: Array<{ name?: string; imageUrl?: string }> = Array.isArray(data?.data) ? data.data : [];
      debugLog("🔎 Fallback search results", { count: results.length });

      // Pick the best match using a stricter scoring function so unrelated images are not reused
      const normalizedSearch = normalize(exerciseName);

      let bestMatch: { name?: string; imageUrl?: string } | null = null;
      let bestScore = 0;

      for (const item of results) {
        if (!item?.name || !item?.imageUrl) continue;
        const score = scoreNameMatch(item.name, normalizedSearch);
        if (score > bestScore) {
          bestScore = score;
          bestMatch = item;
        }
      }

      // Require minimum 0.5 score to avoid wrong matches
      if (bestMatch && bestScore >= 0.5) {
        const normalizedUrl = bestMatch.imageUrl!.trim();
        if (normalizedUrl) {
          fallbackUrlCache.set(cacheKey, normalizedUrl);
          debugLog("🔎 Using fallback image", { normalizedUrl, bestScore, matchedName: bestMatch.name });
          return normalizedUrl;
        }
      }

      debugLog("🔎 No suitable fallback match", { bestScore, bestMatchName: bestMatch?.name });
      return null;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn("[useExerciseImage] Failed to fetch fallback image URL", error);
      }
      return null;
    }
  };

const isLegacyExerciseDbUrl = (url: string) => {
  try {
    const host = new URL(url).hostname;
    return host.includes("static.exercisedb.dev");
  } catch {
    return false;
  }
};

const isDebugEnabled = (): boolean => {
  if (typeof window === "undefined") {
    return import.meta.env.DEV;
  }
  return (
    import.meta.env.DEV ||
    window.localStorage.getItem("weightstone:debug-exercise-images") === "true"
  );
};

const debugLog = (...args: any[]) => {
  if (isDebugEnabled()) {
    console.log("[useExerciseImage]", ...args);
  }
};

const legacyUrlReachable = async (url: string | null | undefined): Promise<boolean> => {
  if (!url) return false;
  try {
    const res = await fetch(url, { method: "HEAD" });
    debugLog("🧪 Legacy URL check", { url, status: res.status });
    return res.ok;
  } catch (error) {
    debugLog("🧪 Legacy URL check failed", { url, error });
    return false;
  }
};

useEffect(() => {
  // Reset state
  setSrc(null);
  setIsLoading(false);
  setIsCached(false);

  let resolvedImageUrl: string | null | undefined = imageUrl;

  // If the database explicitly set placeholder, respect it (don't try fallback search)
  const isIntentionalPlaceholder = imageUrl === PLACEHOLDER_IMAGE_URL || imageUrl === "/placeholder.svg";

  // Only try fallback for legacy URLs that are now dead, NOT for intentional placeholders
  const needsFallback = !isIntentionalPlaceholder && (!resolvedImageUrl || isLegacyExerciseDbUrl(resolvedImageUrl)) && exerciseName;

  // If no exerciseId, can't cache, but can still display network URL
  let mounted = true;

  const loadImage = async () => {
    try {
      debugLog("⏳ Start", {
        exerciseId,
        imageUrl,
        needsFallback,
        exerciseName,
      });

      if (needsFallback) {
        const fallbackUrl = await fetchFallbackImageUrl();
        if (!mounted) return;
        if (fallbackUrl) {
          resolvedImageUrl = fallbackUrl;
          debugLog("✅ Fallback found", { fallbackUrl });
        } else if (!resolvedImageUrl || isLegacyExerciseDbUrl(resolvedImageUrl)) {
          // Keep legacy URL only if it actually resolves (avoid showing endless black images)
          const allowLegacy =
            typeof window !== "undefined" &&
            window.localStorage.getItem("weightstone:allow-legacy-exercisedb") === "true";

          const reachable = await legacyUrlReachable(resolvedImageUrl);
          if (reachable || allowLegacy) {
            debugLog("⚠️ Fallback not found, keeping legacy URL", {
              reachable,
              allowLegacy,
              url: resolvedImageUrl,
            });
          } else {
            resolvedImageUrl = null;
            debugLog("⚠️ Fallback not found, legacy URL suppressed (unreachable)");
          }
        }
      }

      const hasValidUrl = Boolean(
        resolvedImageUrl &&
        typeof resolvedImageUrl === "string" &&
        resolvedImageUrl.trim() !== ""
      );
      if (!hasValidUrl) {
        debugLog("🚫 No valid image URL after fallback, showing placeholder");
        setSrc(PLACEHOLDER_IMAGE_URL);
        return;
      }

      if (!exerciseId) {
        setSrc(resolvedImageUrl!);
        debugLog("ℹ️ Using network URL (no caching, missing exerciseId)");
        return;
      }

      // Check filesystem cache first
      const cachedUrl = await getCachedExerciseImageUrl(exerciseId);

      if (!mounted) return;

      if (cachedUrl) {
        // Image is cached - use file:// URL (works offline!)
        setSrc(cachedUrl);
        setIsCached(true);
        setIsLoading(false);
        debugLog("📂 Using cached image", { cachedUrl });
        return;
      }

      // Not cached - adaptive behavior based on connection quality
      const connectionQuality = useNetworkStore.getState().connectionQuality;
      debugLog("🌐 No cache, connection quality", { connectionQuality, resolvedImageUrl });

      // On low quality connections (3G/2G), don't show network URLs or auto-download
      // Show placeholder instead
      if (connectionQuality === 'low' || connectionQuality === 'offline') {
        console.log(`[useExerciseImage] Skipping network load on ${connectionQuality} connection`);
        setSrc(PLACEHOLDER_IMAGE_URL);
        setIsCached(false);
        setIsLoading(false);
        debugLog("⏭️ Skipped network load due to connection quality");
        return;
      }

      // Medium/High quality - use network URL
      setSrc(resolvedImageUrl!);
      setIsCached(false);
      debugLog("🖼️ Showing network URL", { url: resolvedImageUrl });

      // Skip background caching if disabled (e.g., when browsing exercise list)
      if (disableAutoCache) {
        setIsLoading(false);
        debugLog("🚫 Auto-cache disabled");
        return;
      }

      // Download and cache to filesystem in background
      // (Only on medium/high quality connections)
      setIsLoading(true);
      const fileUrl = await downloadAndCacheExerciseImageToFilesystem(exerciseId, resolvedImageUrl!);

      if (!mounted) return;

      if (fileUrl) {
        // Successfully cached - switch to file:// URL
        setSrc(fileUrl);
        setIsCached(true);
        debugLog("✅ Cached to filesystem", { fileUrl });
      }

      setIsLoading(false);
    } catch (error) {
      if (!mounted) return;

      // On error, check connection quality before falling back to network URL
      const connectionQuality = useNetworkStore.getState().connectionQuality;
      debugLog("💥 Error loading image", {
        error,
        resolvedImageUrl,
        connectionQuality,
      });

      if (connectionQuality === 'low' || connectionQuality === 'offline') {
        // Don't show network URL on slow connections
        setSrc(PLACEHOLDER_IMAGE_URL);
      } else {
          // Fallback to network URL on good connections
          if (resolvedImageUrl) {
            setSrc(resolvedImageUrl);
          } else {
            setSrc(PLACEHOLDER_IMAGE_URL);
          }
        }

        setIsCached(false);
        setIsLoading(false);
      }
    };

    loadImage();

    // Cleanup
    return () => {
      mounted = false;
    };
  }, [exerciseId, imageUrl, disableAutoCache, exerciseName]);

  return { src, isLoading, isCached };
};
