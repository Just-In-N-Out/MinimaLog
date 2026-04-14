import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { CustomerInfo } from '@revenuecat/purchases-capacitor';

interface SubscriptionState {
  // Subscription status
  isPremium: boolean;
  isLoading: boolean;
  customerInfo: CustomerInfo | null;

  // Usage limits
  workoutCountThisMonth: number;
  templateCount: number;

  // Trial info
  trialEndsAt: Date | null;
  isInTrial: boolean;

  // Hydration status - true once localStorage is loaded
  _hasHydrated: boolean;

  // Actions
  setCustomerInfo: (info: CustomerInfo | null) => void;
  setIsPremium: (isPremium: boolean) => void;
  setWorkoutCount: (count: number) => void;
  setTemplateCount: (count: number) => void;
  setLoading: (loading: boolean) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
  reset: () => void;
}

/**
 * Zustand store for managing subscription state
 *
 * Uses persist middleware to save isPremium to localStorage
 * This prevents the "need premium" flash on app resume
 *
 * Usage:
 * const { isPremium, workoutCountThisMonth } = useSubscriptionStore();
 */
export const useSubscriptionStore = create<SubscriptionState>()(
  persist(
    (set) => ({
      // Initial state - default to true to prevent flash for premium users
      // Will be set to false only when confirmed not premium
      isPremium: true,
      isLoading: true,
      customerInfo: null,
      workoutCountThisMonth: 0,
      templateCount: 0,
      trialEndsAt: null,
      isInTrial: false,
      _hasHydrated: false,

      // Update customer info and derive subscription status
      setCustomerInfo: (info) => {

        const premiumEntitlement = info?.entitlements.active['premium_features'];

        const isInTrial = premiumEntitlement?.periodType === 'TRIAL';
        const trialEndsAt = isInTrial && premiumEntitlement?.expirationDate
          ? new Date(premiumEntitlement.expirationDate)
          : null;

        set({
          customerInfo: info,
          isInTrial,
          trialEndsAt
        });
      },

      setIsPremium: (isPremium) => set({ isPremium }),
      setWorkoutCount: (count) => set({ workoutCountThisMonth: count }),
      setTemplateCount: (count) => set({ templateCount: count }),
      setLoading: (loading) => set({ isLoading: loading }),
      setHasHydrated: (hasHydrated) => set({ _hasHydrated: hasHydrated }),

      // Reset store to initial state (useful on logout)
      reset: () => set({
        isPremium: false,
        isLoading: false,
        customerInfo: null,
        workoutCountThisMonth: 0,
        templateCount: 0,
        trialEndsAt: null,
        isInTrial: false,
      }),
    }),
    {
      name: 'subscription-storage',
      // Only persist isPremium to avoid storing complex objects
      partialize: (state) => ({ isPremium: state.isPremium }),
      onRehydrateStorage: () => (state) => {
        // Called when hydration is complete
        state?.setHasHydrated(true);
      },
    }
  )
);
