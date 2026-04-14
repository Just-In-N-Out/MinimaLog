import {
  getCachedAvatarEntry,
  saveAvatarToCache,
  shouldRefreshAvatarEntry,
} from "./avatarCache";
import { supabase } from "@/integrations/supabase/client";

const isBrowser = typeof window !== "undefined";

/**
 * Extracts the base avatar URL (without Supabase transform params)
 * for consistent cache key generation.
 * This ensures avatar.jpg?width=40 and avatar.jpg?width=200 share the same cache.
 */
export function getAvatarCacheKey(url: string | null | undefined): string | null {
  if (!url) return null;

  // For Supabase storage URLs, strip query params to normalize cache key
  if (url.includes("supabase.co/storage")) {
    return url.split("?")[0];
  }

  return url;
}

/**
 * Prefetch a single avatar into IndexedDB cache.
 * Skips if cache is fresh (less than 12h old).
 */
export async function prefetchAvatar(
  avatarUrl: string,
  cacheKey?: string
): Promise<boolean> {
  if (!isBrowser) return false;

  const effectiveKey = cacheKey || getAvatarCacheKey(avatarUrl);
  if (!effectiveKey) return false;

  try {
    const cached = await getCachedAvatarEntry(effectiveKey);

    // Skip if cache is fresh
    if (cached && !shouldRefreshAvatarEntry(cached)) {
      return true;
    }

    // Fetch the avatar (use base URL for best quality, smaller sizes derived via transforms)
    const baseUrl = avatarUrl.split("?")[0];
    const response = await fetch(baseUrl, { cache: "force-cache" });
    if (!response.ok) return false;

    const blob = await response.blob();
    await saveAvatarToCache(effectiveKey, avatarUrl, blob);
    return true;
  } catch (error) {
    console.warn("[AvatarPrefetch] Failed to prefetch:", error);
    return false;
  }
}

/**
 * Batch prefetch multiple avatars with concurrency limit.
 * Runs in the background without blocking UI.
 */
export async function prefetchAvatarBatch(
  avatarUrls: Array<{ url: string; cacheKey?: string }>,
  concurrency = 3
): Promise<void> {
  if (!isBrowser || avatarUrls.length === 0) return;

  const queue = [...avatarUrls];
  const active: Promise<void>[] = [];

  const runNext = async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;

      try {
        await prefetchAvatar(item.url, item.cacheKey);
      } catch {
        // Silently ignore individual failures
      }
    }
  };

  // Start concurrent workers
  const workers: Promise<void>[] = [];
  for (let i = 0; i < Math.min(concurrency, avatarUrls.length); i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);
}

/**
 * Prefetch user's own avatar on sign-in.
 * Fetches profile from Supabase and caches the avatar blob.
 */
export async function prefetchUserAvatar(userId: string): Promise<void> {
  if (!isBrowser || !userId) return;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("id", userId)
      .single();

    if (error || !data?.avatar_url) {
      return;
    }

    // Use userId as cache key for consistent caching across components
    await prefetchAvatar(data.avatar_url, userId);
    console.log("[AvatarPrefetch] User avatar cached");
  } catch (error) {
    console.warn("[AvatarPrefetch] Failed to prefetch user avatar:", error);
  }
}
