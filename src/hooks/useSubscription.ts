import { useEffect, useState, useRef } from 'react';
import { useSubscriptionStore } from '@/lib/subscriptionStore';
import { getCustomerInfo } from '@/lib/revenuecat';
import {
  getWorkoutCountThisMonth,
  getTemplateCount,
  syncSubscriptionStatus
} from '@/lib/subscriptionHelpers';
import { getSupabaseSession } from '@/lib/session';
import { Capacitor } from '@capacitor/core';
import { supabase } from '@/integrations/supabase/client';
import { App } from '@capacitor/app';

/**
 * Hook to access subscription state and limits
 *
 * Usage:
 * const { isPremium, canCreateWorkout, workoutCountThisMonth } = useSubscription();
 *
 * This hook:
 * - Loads RevenueCat customer info (on native platforms)
 * - Loads usage counts from Supabase
 * - Syncs subscription status to Supabase
 * - Returns subscription state and computed limits
 */
export function useSubscription() {
  const {
    isPremium,
    isLoading,
    customerInfo,
    workoutCountThisMonth,
    templateCount,
    trialEndsAt,
    isInTrial,
    _hasHydrated,
    setCustomerInfo,
    setWorkoutCount,
    setTemplateCount,
    setLoading,
    setIsPremium,
  } = useSubscriptionStore();

  // CRITICAL FIX: Track current user ID to detect account switches
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  // Track app foreground to refresh subscription on resume
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // Listen for app state changes to refresh subscription when returning from background
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    console.log('[useSubscription] 📱 Setting up app state listener');
    const listener = App.addListener('appStateChange', ({ isActive }) => {
      console.log('[useSubscription] 📱 App state changed:', { isActive });
      if (isActive) {
        // App returned to foreground - immediately set loading to prevent flash
        // This ensures effectiveIsPremium stays true while we refresh
        setLoading(true);
        console.log('[useSubscription] 📱 App became active, triggering refresh');
        setRefreshTrigger(prev => prev + 1);
      }
    });

    return () => {
      listener.then(l => l.remove());
    };
  }, [setLoading]);

  // Listen for auth state changes to detect when users log in/out
  useEffect(() => {
    const checkAuth = async () => {
      const session = await getSupabaseSession();
      const userId = session?.user?.id || null;
      console.log('[useSubscription] Auth check - userId:', userId);
      setCurrentUserId(userId);
    };

    // Initial check
    checkAuth();

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user?.id || null;
      console.log('[useSubscription] Auth state changed:', event, 'userId:', userId);
      setCurrentUserId(userId);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function loadSubscriptionData() {
      const currentStoreState = useSubscriptionStore.getState();
      console.log('[useSubscription] 🚀 loadSubscriptionData START - current store state:', {
        isPremium: currentStoreState.isPremium,
        isLoading: currentStoreState.isLoading,
      });

      setLoading(true);
      console.log('[useSubscription] 📍 setLoading(true) called');

      try {
        // Get current user session
        const session = await getSupabaseSession();
        const userId = session?.user?.id;
        console.log('[useSubscription] 📍 Got session, userId:', userId);

        if (!userId) {
          console.log('[useSubscription] ❌ No user session found');
          setLoading(false);
          return;
        }

        // 1. Get subscription status from RevenueCat (native platforms only)
        let customerInfo = null;
        if (Capacitor.isNativePlatform()) {
          console.log('[useSubscription] 📍 Native platform detected, checking RevenueCat...');

          // Wait for RevenueCat to initialize (check with retry)
          const { isInitialized } = await import('@/lib/revenuecat');
          let retries = 0;
          const isAlreadyInit = isInitialized();
          console.log('[useSubscription] 📍 RevenueCat isInitialized:', isAlreadyInit);

          while (!isInitialized() && retries < 10) {
            console.log('[useSubscription] ⏳ Waiting for RevenueCat initialization...', retries);
            await new Promise(resolve => setTimeout(resolve, 500));
            retries++;
          }

          if (isInitialized()) {
            console.log('[useSubscription] ✅ RevenueCat initialized, getting customerInfo...');
            customerInfo = await getCustomerInfo();
            console.log('[useSubscription] 📍 Got customerInfo:', {
              hasCustomerInfo: !!customerInfo,
              originalAppUserId: customerInfo?.originalAppUserId,
              activeEntitlements: customerInfo ? Object.keys(customerInfo.entitlements?.active || {}) : [],
            });
            if (isMounted) {
              setCustomerInfo(customerInfo);
            }
          } else {
            console.error('[useSubscription] ❌ RevenueCat failed to initialize after 5 seconds');
            // Don't change isPremium if RevenueCat isn't ready - keep previous value
            // This prevents flashing "need premium" on app resume
            console.log('[useSubscription] 📍 Keeping previous isPremium value, setting loading false');
            setLoading(false);
            return;
          }

          // Only update subscription status if we have valid customerInfo
          if (customerInfo) {
            // Sync RevenueCat status to Supabase
            // SECURITY: Use isPremiumUser helper which validates the original purchaser
            const { isPremiumUser } = await import('@/lib/revenuecat');
            const isUserPremium = isPremiumUser(customerInfo, userId);
            const expiresAt = customerInfo?.entitlements.active['premium_features']?.expirationDate
              ? new Date(customerInfo.entitlements.active['premium_features'].expirationDate)
              : null;

            console.log('[useSubscription] 📍 Premium check:', {
              isUserPremium,
              userId,
              originalAppUserId: customerInfo.originalAppUserId,
              expiresAt,
            });

            if (isMounted) {
              // SECURITY: Double-check that customerInfo belongs to current user
              // This prevents race condition where we load previous user's premium status
              const isCorrectUser = customerInfo.originalAppUserId === userId;
              console.log('[useSubscription] 📍 User check:', { isCorrectUser, isUserPremium });

              if (isUserPremium && isCorrectUser) {
                console.log('[useSubscription] ✅ Setting isPremium = TRUE');
                setIsPremium(true);
              } else if (isCorrectUser) {
                // Only set to false if we confirmed the user is NOT premium
                console.log('[useSubscription] ⚠️ Setting isPremium = FALSE (confirmed not premium)');
                setIsPremium(false);
              } else {
                console.warn('[useSubscription] ⚠️ Prevented setting premium from wrong user data:', {
                  currentUser: userId,
                  customerInfoUser: customerInfo.originalAppUserId
                });
                // Don't change isPremium - keep previous value
              }
            }

            await syncSubscriptionStatus(userId, isUserPremium, expiresAt);
          } else {
            console.warn('[useSubscription] ⚠️ No customerInfo available, keeping previous premium status');
          }
        } else {
          // On web, get from Supabase only (no RevenueCat)
          const tier = await getSubscriptionTier(userId);
          if (isMounted) {
            setCustomerInfo(null);
            // Update isPremium based on Supabase tier for web platform
            setIsPremium(tier === 'premium');
          }
        }

        // 2. Get usage counts from Supabase
        const [workouts, templates] = await Promise.all([
          getWorkoutCountThisMonth(userId),
          getTemplateCount(userId),
        ]);

        if (isMounted) {
          setWorkoutCount(workouts);
          setTemplateCount(templates);
        }

        console.log('[useSubscription] Loaded subscription data:', {
          isPremium: Capacitor.isNativePlatform() && customerInfo && userId
            ? (await import('@/lib/revenuecat')).isPremiumUser(customerInfo, userId)
            : false,
          workouts,
          templates,
        });
      } catch (error) {
        console.error('[useSubscription] ❌ Failed to load subscription data:', error);
      } finally {
        if (isMounted) {
          const finalState = useSubscriptionStore.getState();
          console.log('[useSubscription] 🏁 loadSubscriptionData END - final store state:', {
            isPremium: finalState.isPremium,
            isLoading: finalState.isLoading,
          });
          setLoading(false);
          console.log('[useSubscription] 📍 setLoading(false) called');
        }
      }
    }

    console.log('[useSubscription] 🔄 useEffect triggered, currentUserId:', currentUserId);
    loadSubscriptionData();

    // Cleanup function to prevent state updates after unmount
    return () => {
      isMounted = false;
    };
  }, [currentUserId, refreshTrigger]); // Re-run when user changes OR app returns to foreground

  // Computed values for easy access
  const canCreateWorkout = true; // Unlimited workouts for all users
  const canCreateTemplate = isPremium || templateCount < 1;
  const remainingWorkouts = Infinity; // Unlimited workouts for all users
  const remainingTemplates = isPremium ? Infinity : Math.max(0, 1 - templateCount);

  return {
    // Subscription status
    isPremium,
    isLoading,
    hasHydrated: _hasHydrated,
    customerInfo,
    isInTrial,
    trialEndsAt,

    // Usage counts
    workoutCountThisMonth,
    templateCount,

    // Computed limits
    canCreateWorkout,
    canCreateTemplate,
    remainingWorkouts,
    remainingTemplates,

    // Helper for checking exercise access
    canAccessExercise: (index: number) => isPremium || index === 0,
  };
}

/**
 * Helper to get subscription tier from Supabase
 * Used for web platform where RevenueCat is not available
 */
async function getSubscriptionTier(userId: string): Promise<'free' | 'premium'> {
  const { getSubscriptionTier } = await import('@/lib/subscriptionHelpers');
  return getSubscriptionTier(userId);
}
