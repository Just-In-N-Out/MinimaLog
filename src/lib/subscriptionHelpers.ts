import { supabase } from '@/integrations/supabase/client';

/**
 * Get the number of workouts created this month for a user
 * @param userId - User ID to check
 * @returns Number of workouts created this month
 */
export async function getWorkoutCountThisMonth(userId: string): Promise<number> {
  const currentMonth = new Date().toISOString().slice(0, 7); // 'YYYY-MM' format

  const { data, error } = await supabase
    .from('monthly_usage')
    .select('workout_count')
    .eq('user_id', userId)
    .eq('month_year', currentMonth)
    .single();

  if (error || !data) return 0;
  return data.workout_count;
}

/**
 * Get the number of templates created by a user
 * @param userId - User ID to check
 * @returns Number of templates created
 */
export async function getTemplateCount(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from('workout_templates')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) {
    console.error('[SubscriptionHelpers] Failed to get template count:', error);
    return 0;
  }

  return count || 0;
}

/**
 * Check if user can create a workout based on their subscription tier
 * Free users: 3 workouts/month limit
 * Premium users: Unlimited
 *
 * @param userId - User ID to check
 * @param isPremium - Whether user has premium subscription
 * @returns true if user can create a workout, false otherwise
 */
export async function canCreateWorkout(userId: string, isPremium: boolean): Promise<boolean> {
  if (isPremium) return true;

  const count = await getWorkoutCountThisMonth(userId);
  return count < 3;
}

/**
 * Check if user can create a template based on their subscription tier
 * Free users: 1 template limit
 * Premium users: Unlimited
 *
 * @param userId - User ID to check
 * @param isPremium - Whether user has premium subscription
 * @returns true if user can create a template, false otherwise
 */
export async function canCreateTemplate(userId: string, isPremium: boolean): Promise<boolean> {
  if (isPremium) return true;

  const count = await getTemplateCount(userId);
  return count < 1;
}

/**
 * Check if user can access exercise analytics
 * Free users: Only first exercise
 * Premium users: All exercises
 *
 * @param exerciseIndex - Index of exercise in list (0-based)
 * @param isPremium - Whether user has premium subscription
 * @returns true if user can access this exercise's analytics
 */
export function canAccessExerciseAnalytics(exerciseIndex: number, isPremium: boolean): boolean {
  if (isPremium) return true;
  return exerciseIndex === 0; // Free users can only access first exercise
}

/**
 * Get remaining workouts for free tier user this month
 * @param userId - User ID to check
 * @returns Number of workouts remaining (0-3)
 */
export async function getRemainingWorkouts(userId: string): Promise<number> {
  const count = await getWorkoutCountThisMonth(userId);
  return Math.max(0, 3 - count);
}

/**
 * Get user's subscription tier from Supabase profiles table
 * Falls back to checking RevenueCat if not set
 *
 * @param userId - User ID to check
 * @returns 'free' or 'premium'
 */
export async function getSubscriptionTier(userId: string): Promise<'free' | 'premium'> {
  const { data, error } = await supabase
    .from('profiles')
    .select('subscription_tier, subscription_expires_at')
    .eq('id', userId)
    .single();

  if (error || !data) {
    console.error('[SubscriptionHelpers] Failed to get subscription tier:', error);
    return 'free';
  }

  // Check if subscription is still valid
  if (data.subscription_tier === 'premium') {
    if (!data.subscription_expires_at) {
      return 'premium'; // Lifetime or no expiration
    }

    const expiresAt = new Date(data.subscription_expires_at);
    if (expiresAt > new Date()) {
      return 'premium'; // Still active
    }

    // Expired, should update to free
    return 'free';
  }

  return 'free';
}

/**
 * Sync RevenueCat subscription status to Supabase
 * Called by webhook handler and periodically by client
 *
 * @param userId - User ID
 * @param isPremium - Whether user has active premium subscription
 * @param expiresAt - When subscription expires (null for lifetime)
 */
export async function syncSubscriptionStatus(
  userId: string,
  isPremium: boolean,
  expiresAt: Date | null
): Promise<void> {
  const { error } = await supabase
    .from('profiles')
    .update({
      subscription_tier: isPremium ? 'premium' : 'free',
      subscription_expires_at: expiresAt?.toISOString() || null,
      last_subscription_check: new Date().toISOString(),
    })
    .eq('id', userId);

  if (error) {
    console.error('[SubscriptionHelpers] Failed to sync subscription status:', error);
    throw error;
  }

  console.log('[SubscriptionHelpers] Subscription status synced for user:', userId);
}
