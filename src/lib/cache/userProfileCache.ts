import { getDB } from '../db/indexedDB';
import { shouldUseOfflineMode } from '../network';
import { supabase } from '@/integrations/supabase/client';

export type WeightUnit = 'kg' | 'lb';

interface UserProfile {
  userId: string;
  unit_default: WeightUnit;
  cachedAt: string;
}

/**
 * Cache user profile to IndexedDB
 */
export const cacheUserProfile = async (
  userId: string,
  unit_default: WeightUnit
): Promise<void> => {
  try {
    const db = await getDB();
    const profile: UserProfile = {
      userId,
      unit_default,
      cachedAt: new Date().toISOString(),
    };

    await db.put('user_profile', profile);
    console.log('[UserProfileCache] Cached profile for user:', userId);
  } catch (error) {
    console.error('[UserProfileCache] Failed to cache profile:', error);
  }
};

/**
 * Get user profile from IndexedDB cache
 */
export const getCachedUserProfile = async (
  userId: string
): Promise<UserProfile | null> => {
  try {
    const db = await getDB();
    const profile = await db.get('user_profile', userId);
    return profile || null;
  } catch (error) {
    console.error('[UserProfileCache] Failed to retrieve cached profile:', error);
    return null;
  }
};

/**
 * Get user's preferred weight unit with offline support
 * Returns cached value when offline, fetches from Supabase when online
 */
export const getUserPreferredUnit = async (
  userId: string
): Promise<WeightUnit> => {
  const isOffline = shouldUseOfflineMode();

  // Offline mode: use cached value
  if (isOffline) {
    const cachedProfile = await getCachedUserProfile(userId);
    if (cachedProfile) {
      console.log('[UserProfileCache] Using cached unit (offline):', cachedProfile.unit_default);
      return cachedProfile.unit_default;
    } else {
      console.warn('[UserProfileCache] No cached profile, defaulting to kg');
      return 'kg'; // Default fallback
    }
  }

  // Online mode: fetch from Supabase and cache
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('unit_default')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('[UserProfileCache] Supabase fetch error:', error);
      // Try cache as fallback
      const cachedProfile = await getCachedUserProfile(userId);
      return cachedProfile?.unit_default || 'kg';
    }

    const unit = (data?.unit_default as WeightUnit) || 'kg';

    // Cache the fetched value
    await cacheUserProfile(userId, unit);

    return unit;
  } catch (error) {
    console.error('[UserProfileCache] Failed to fetch profile:', error);
    // Try cache as fallback
    const cachedProfile = await getCachedUserProfile(userId);
    return cachedProfile?.unit_default || 'kg';
  }
};
