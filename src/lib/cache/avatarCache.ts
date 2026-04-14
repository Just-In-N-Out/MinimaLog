import type { IDBPDatabase } from "idb";
import { getDB, type OfflineDB } from "@/lib/db/indexedDB";

const isBrowser = typeof window !== "undefined";

const AVATAR_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 14; // 14 days
const AVATAR_CACHE_REFRESH_MS = 1000 * 60 * 60 * 12; // Refresh in background every 12h
const AVATAR_CACHE_MAX_ENTRIES = 120;

export interface AvatarCacheEntry {
  cacheKey: string;
  sourceUrl: string;
  blob: Blob;
  updatedAt: string;
}

const normalizeKey = (key: string) => key.trim();

export const getCachedAvatarEntry = async (cacheKey: string): Promise<AvatarCacheEntry | null> => {
  if (!isBrowser || !cacheKey) return null;

  try {
    const db = await getDB();
    
    // SAFETY: Check if avatar_cache store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("avatar_cache")) {
        return null;
      }
    } catch (error) {
      console.warn("[AvatarCache] Error checking objectStoreNames:", error);
      return null;
    }

    const normalizedKey = normalizeKey(cacheKey);
    const entry = await db.get("avatar_cache", normalizedKey);
    if (!entry) return null;

    const age = Date.now() - new Date(entry.updatedAt).getTime();
    if (age > AVATAR_CACHE_TTL_MS) {
      await db.delete("avatar_cache", normalizedKey);
      return null;
    }

    return entry;
  } catch (error) {
    console.warn("[AvatarCache] Failed to read entry:", error);
    return null;
  }
};

export const saveAvatarToCache = async (cacheKey: string, sourceUrl: string, blob: Blob) => {
  if (!isBrowser || !cacheKey) return;

  try {
    const db = await getDB();
    
    // SAFETY: Check if avatar_cache store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("avatar_cache")) {
        return;
      }
    } catch (error) {
      console.warn("[AvatarCache] Error checking objectStoreNames:", error);
      return;
    }

    const normalizedKey = normalizeKey(cacheKey);
    const payload: AvatarCacheEntry = {
      cacheKey: normalizedKey,
      sourceUrl,
      blob,
      updatedAt: new Date().toISOString(),
    };

    await db.put("avatar_cache", payload);
    await pruneAvatarCache(db);
  } catch (error) {
    console.warn("[AvatarCache] Failed to persist entry:", error);
  }
};

export const shouldRefreshAvatarEntry = (entry: AvatarCacheEntry): boolean => {
  const age = Date.now() - new Date(entry.updatedAt).getTime();
  return age > AVATAR_CACHE_REFRESH_MS;
};

const pruneAvatarCache = async (database?: IDBPDatabase<OfflineDB>) => {
  if (!isBrowser) return;

  try {
    const db = database ?? (await getDB());
    
    // SAFETY: Check if avatar_cache store exists (prevents errors during DB initialization)
    try {
      if (!db.objectStoreNames.contains("avatar_cache")) {
        return;
      }
    } catch (error) {
      console.warn("[AvatarCache] Error checking objectStoreNames:", error);
      return;
    }

    const total = await db.count("avatar_cache");
    if (total <= AVATAR_CACHE_MAX_ENTRIES) return;

    const excess = total - AVATAR_CACHE_MAX_ENTRIES;
    const tx = db.transaction("avatar_cache", "readwrite");
    const index = tx.store.index("by-updated");

    let cursor = await index.openCursor();
    let removed = 0;
    while (cursor && removed < excess) {
      await cursor.delete();
      removed += 1;
      cursor = await cursor.continue();
    }

    await tx.done;
  } catch (error) {
    console.warn("[AvatarCache] Failed to prune cache:", error);
  }
};

export const clearAvatarCache = async () => {
  if (!isBrowser) return;

  try {
    const db = await getDB();
    
    // SAFETY: Check if avatar_cache store exists (prevents errors during DB initialization)
    try {
      if (db.objectStoreNames.contains("avatar_cache")) {
        await db.clear("avatar_cache");
      }
    } catch (error) {
      console.warn("[AvatarCache] Error checking objectStoreNames:", error);
    }
  } catch (error) {
    console.warn("[AvatarCache] Failed to clear entries:", error);
  }
};

export const __avatarCacheInternals = {
  AVATAR_CACHE_TTL_MS,
  AVATAR_CACHE_REFRESH_MS,
  AVATAR_CACHE_MAX_ENTRIES,
};
