import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { shouldUseOfflineMode } from "./network";
import { getOrCreateSessionKey, encryptObject, decryptObject, clearSessionKey } from "./crypto";
import { vLog } from "@/components/VisualDebugLogger";

interface GetSessionOptions {
  timeoutMs?: number;
  throwOnError?: boolean;
}

type SessionOutcome =
  | { status: "fulfilled"; value: Awaited<ReturnType<typeof supabase.auth.getSession>> }
  | { status: "rejected"; reason: unknown }
  | { status: "timeout" };

const SESSION_CACHE_KEY = "weightstone_cached_session";
const USER_ID_CACHE_KEY = "weightstone_user_id";
const SESSION_CACHE_EXPIRY_DAYS = 7;

interface CachedSession {
  session: Session;
  cachedAt: number;
}

/**
 * Cache session to localStorage for offline access
 * SECURITY: Session data is encrypted before storage to protect access tokens
 */
const cacheSession = async (session: Session | null): Promise<void> => {
  if (!session) {
    localStorage.removeItem(SESSION_CACHE_KEY);
    localStorage.removeItem(USER_ID_CACHE_KEY);
    localStorage.removeItem('emergency_user_id'); // Clear emergency fallback
    clearSessionKey(); // Clear encryption key on logout
    return;
  }

  const cached: CachedSession = {
    session,
    cachedAt: Date.now(),
  };

  try {
    // EMERGENCY FALLBACK: Always store plain userId as last resort for offline mode
    // This ensures userId is always available even if encryption fails
    localStorage.setItem('emergency_user_id', session.user.id);
    vLog.info('Session', 'Emergency userId backup stored', {});

    // Get or create encryption key for this session
    const encryptionKey = await getOrCreateSessionKey();

    // If WebCrypto is not available (e.g., iOS WebView), fall back to unencrypted storage
    if (!encryptionKey) {
      console.warn("[Session] WebCrypto unavailable, storing session unencrypted");
      vLog.warning('Session', 'WebCrypto unavailable, using unencrypted storage', {});
      localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify(cached));
      localStorage.setItem(USER_ID_CACHE_KEY, session.user.id);
      return;
    }

    // Encrypt session data before storing
    const encryptedSession = await encryptObject(cached, encryptionKey);
    const encryptedUserId = await encryptObject({ userId: session.user.id }, encryptionKey);

    localStorage.setItem(SESSION_CACHE_KEY, encryptedSession);
    localStorage.setItem(USER_ID_CACHE_KEY, encryptedUserId);
    vLog.success('Session', '✓ Session cached with encryption', {});
  } catch (error) {
    vLog.error('Session', 'Failed to cache encrypted session', error);
    console.error("Failed to cache session:", error);
    // Emergency backup was already saved above, so offline mode can still work
  }
};

/**
 * Retrieve cached session from localStorage
 * Returns null if cache is expired or invalid
 * SECURITY: Decrypts session data before returning
 */
const getCachedSession = async (): Promise<Session | null> => {
  try {
    const encryptedSession = localStorage.getItem(SESSION_CACHE_KEY);
    if (!encryptedSession) {
      return null;
    }

    // Try to parse as JSON first (unencrypted format for when WebCrypto is unavailable)
    let cached: CachedSession;

    try {
      cached = JSON.parse(encryptedSession);
      // If it parses as valid JSON with session property, it's unencrypted data
      if (cached && cached.session) {
        console.log('[Session] Using unencrypted session (WebCrypto not available)');
      }
    } catch {
      // Not valid JSON, must be encrypted - proceed with decryption
      const encryptionKey = await getOrCreateSessionKey();

      if (!encryptionKey) {
        console.error('[Session] Cannot decrypt session - WebCrypto not available');
        localStorage.removeItem(SESSION_CACHE_KEY);
        localStorage.removeItem(USER_ID_CACHE_KEY);
        return null;
      }

      // Decrypt session data
      cached = await decryptObject(encryptedSession, encryptionKey);
    }

    const expiryMs = SESSION_CACHE_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const isExpired = Date.now() - cached.cachedAt > expiryMs;

    if (isExpired) {
      localStorage.removeItem(SESSION_CACHE_KEY);
      localStorage.removeItem(USER_ID_CACHE_KEY);
      clearSessionKey();
      return null;
    }

    return cached.session;
  } catch (error) {
    console.error("Failed to retrieve cached session:", error);
    // If decryption fails, clear the corrupted cache
    localStorage.removeItem(SESSION_CACHE_KEY);
    localStorage.removeItem(USER_ID_CACHE_KEY);
    return null;
  }
};

export const getSupabaseSession = async (
  options: GetSessionOptions = {}
): Promise<Session | null> => {
  const { timeoutMs = 12000, throwOnError = false } = options;

  // Check if we're in post-OAuth flow - session might need time to stabilize
  const justSignedIn = typeof window !== 'undefined' ? localStorage.getItem('auth:just-signed-in') : null;
  const isPostOAuthFlow = justSignedIn && (Date.now() - parseInt(justSignedIn, 10)) < 300000; // 5 minutes

  if (isPostOAuthFlow) {
    console.log("[Session] Post-OAuth flow detected, waiting for SDK to stabilize...");
    // Give Supabase SDK time to load session from localStorage after page reload
    // Increased from 300ms to 500ms for iOS reliability
    await new Promise(r => setTimeout(r, 500));
  }

  // Check if we're in offline mode
  const isOffline = shouldUseOfflineMode();

  // If offline, return cached session immediately
  if (isOffline) {
    const cachedSession = await getCachedSession();
    if (cachedSession) {
      console.log("[Session] Using cached session (offline mode)");
      return cachedSession;
    } else {
      console.warn("[Session] No cached session available in offline mode");
      if (throwOnError) {
        throw new Error("No cached session available for offline mode");
      }
      return null;
    }
  }

  // Online mode: fetch from Supabase with retry for post-OAuth flow
  const fetchSession = async (): Promise<SessionOutcome> => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const sessionPromise: Promise<SessionOutcome> = supabase.auth
      .getSession()
      .then((value) => ({ status: "fulfilled" as const, value }))
      .catch((reason) => ({ status: "rejected" as const, reason }));

    const timeoutPromise: Promise<SessionOutcome> = new Promise((resolve) => {
      timeoutId = setTimeout(() => resolve({ status: "timeout" }), timeoutMs);
    });

    const outcome = await Promise.race([sessionPromise, timeoutPromise]);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return outcome;
  };

  let outcome = await fetchSession();

  // In post-OAuth flow, retry if no session found (SDK might not be ready yet)
  if (isPostOAuthFlow && (outcome.status !== "fulfilled" || !outcome.value?.data?.session)) {
    console.log("[Session] No session in post-OAuth flow, retrying...");
    for (let i = 0; i < 3; i++) {
      await new Promise(r => setTimeout(r, 500));
      outcome = await fetchSession();
      if (outcome.status === "fulfilled" && outcome.value?.data?.session) {
        console.log(`[Session] Session found on retry ${i + 1}`);
        break;
      }
      console.log(`[Session] Retry ${i + 1}/3 - session not ready yet`);
    }
  }

  if (outcome.status === "timeout") {
    const timeoutError = new Error("Supabase session request timed out");
    timeoutError.name = "TimeoutError";
    if (throwOnError) {
      throw timeoutError;
    }
    console.error("Failed to retrieve Supabase session:", timeoutError);
    return null;
  }

  if (outcome.status === "rejected") {
    if (throwOnError) {
      throw outcome.reason;
    }
    console.error("Failed to retrieve Supabase session:", outcome.reason);
    return null;
  }

  const { data, error } = outcome.value;

  if (error) {
    if (throwOnError) {
      throw error;
    }
    console.error("Failed to retrieve Supabase session:", error);
    return null;
  }

  const session = data.session ?? null;

  // Cache the session for offline use (encrypted)
  await cacheSession(session);

  // Clear the just-signed-in flag on successful session retrieval
  if (session && isPostOAuthFlow) {
    console.log("[Session] Clearing just-signed-in flag after successful session");
    localStorage.removeItem('auth:just-signed-in');
  }

  return session;
};

/**
 * Get cached user ID from localStorage with robust fallbacks
 * SECURITY: Decrypts user ID before returning, but falls back to unencrypted if needed
 * Used for offline mode when session cache has expired
 *
 * FALLBACK CHAIN:
 * 1. Try JSON parse (unencrypted { userId: "..." } format)
 * 2. Try decryption (encrypted format)
 * 3. Use raw string (direct userId storage - legacy/fallback)
 */
export const getCachedUserId = async (): Promise<string | null> => {
  try {
    const useEmergencyFallback = (context: string) => {
      if (typeof window === 'undefined') return null;
      const fallback = localStorage.getItem('emergency_user_id');
      if (fallback && fallback.length > 0) {
        vLog.warning('Session', context, { userId: fallback.substring(0, 8) + '...' });
        console.log(`[Session] ${context}: using emergency fallback user ID`);
        return fallback;
      }
      return null;
    };

    const storedValue = localStorage.getItem(USER_ID_CACHE_KEY);
    if (!storedValue) {
      vLog.info('Session', 'No cached user ID found');
      console.log('[Session] No cached user ID found in localStorage');
      const emergencyFallback = useEmergencyFallback('No cached user ID found');
      return emergencyFallback;
    }

    vLog.info('Session', 'Found cached user ID, attempting retrieval...', {
      length: storedValue.length,
      format: storedValue.startsWith('{') ? 'JSON' : storedValue.startsWith('[') ? 'Array' : 'String'
    });

    console.log('[Session] Found cached user ID, attempting to retrieve...', {
      length: storedValue.length,
      startsWithBrace: storedValue.startsWith('{'),
      startsWithBracket: storedValue.startsWith('['),
    });

    // PATH 1: Try JSON parse first (unencrypted { userId: "..." } format)
    // This handles the case where WebCrypto was unavailable during storage
    try {
      const data: { userId: string } = JSON.parse(storedValue);
      if (data && data.userId && typeof data.userId === 'string' && data.userId.length > 0) {
        vLog.success('Session', '✓ Retrieved user ID from JSON format', { userId: data.userId.substring(0, 8) + '...' });
        console.log('[Session] ✓ Retrieved user ID from unencrypted JSON format');
        return data.userId;
      }
    } catch {
      // Not valid JSON, continue to next attempt
      vLog.info('Session', 'Not JSON format, trying decryption...');
      console.log('[Session] Not JSON format, trying decryption...');
    }

    // PATH 2: Try decryption (encrypted format)
    // This is the primary secure path when WebCrypto is available
    try {
      const encryptionKey = await getOrCreateSessionKey();
      if (encryptionKey) {
        const data: { userId: string } = await decryptObject(storedValue, encryptionKey);
        if (data && data.userId && typeof data.userId === 'string' && data.userId.length > 0) {
          vLog.success('Session', '✓ Retrieved user ID from encrypted storage', { userId: data.userId.substring(0, 8) + '...' });
          console.log('[Session] ✓ Retrieved user ID from encrypted storage');
          return data.userId;
        }
      } else {
        vLog.warning('Session', 'Encryption key not available, skipping decryption');
        console.log('[Session] Encryption key not available, skipping decryption');
      }
    } catch (error) {
      vLog.warning('Session', 'Decryption failed, trying raw string fallback', error);
      console.warn('[Session] Decryption failed, trying raw string fallback:', error);
    }

    // PATH 3: Treat as raw userId string (legacy/fallback format)
    // This handles direct userId storage or corrupted encrypted data
    // UUIDs are typically 36 chars, so check for reasonable length
    if (storedValue.length > 20 && storedValue.length < 100 && !storedValue.includes(' ')) {
      vLog.success('Session', '✓ Using raw user ID (fallback mode)', { userId: storedValue.substring(0, 8) + '...' });
      console.log('[Session] ✓ Using value as raw user ID (fallback mode)');
      return storedValue;
    }

    vLog.error('Session', '✗ Could not parse user ID from any format', {
      length: storedValue.length,
      preview: storedValue.substring(0, 20)
    });
    console.error('[Session] ✗ Could not parse cached user ID from any format', {
      valueLength: storedValue.length,
      preview: storedValue.substring(0, 50),
    });
    const emergencyFallback = useEmergencyFallback('Parse failure, using emergency fallback');
    return emergencyFallback;
  } catch (error) {
    vLog.error('Session', 'Fatal error retrieving cached user ID', error);
    console.error('[Session] Fatal error retrieving cached user ID:', error);
    const emergencyFallback = typeof window !== 'undefined'
      ? localStorage.getItem('emergency_user_id')
      : null;
    if (emergencyFallback) {
      vLog.warning('Session', 'Recovered user ID via emergency fallback after fatal error', { userId: emergencyFallback.substring(0, 8) + '...' });
      console.log('[Session] Using emergency user ID fallback after fatal error');
      return emergencyFallback;
    }
    return null;
  }
};

/**
 * Clear all cached session data (call on logout)
 * SECURITY: Clears both encrypted data and encryption keys
 */
export const clearCachedSession = (): void => {
  localStorage.removeItem(SESSION_CACHE_KEY);
  localStorage.removeItem(USER_ID_CACHE_KEY);
  localStorage.removeItem('emergency_user_id'); // Clear emergency fallback
  clearSessionKey();
};
