import { Purchases, LOG_LEVEL, CustomerInfo } from '@revenuecat/purchases-capacitor';
import type { LogInResult } from '@revenuecat/purchases-capacitor';
import { Capacitor } from '@capacitor/core';

const REVENUECAT_IOS_API_KEY = import.meta.env.VITE_REVENUECAT_IOS_API_KEY;

// Track initialization state
let isRevenueCatInitialized = false;
let currentAppUserId: string | null = null;

/**
 * Check if RevenueCat has been initialized
 * @returns true if RevenueCat is ready to use
 */
export function isInitialized(): boolean {
  return isRevenueCatInitialized;
}

/**
 * Initialize RevenueCat SDK
 * Should be called once on app start with user ID
 */
export async function initializeRevenueCat(userId: string) {
  console.log('[RevenueCat] Attempting initialization...');
  console.log('[RevenueCat] Platform:', Capacitor.getPlatform());
  console.log('[RevenueCat] Is native:', Capacitor.isNativePlatform());
  console.log('[RevenueCat] API key exists:', !!REVENUECAT_IOS_API_KEY);
  console.log('[RevenueCat] User ID:', userId);

  if (!Capacitor.isNativePlatform()) {
    console.log('[RevenueCat] Skipping initialization on web platform');
    return;
  }

  if (!REVENUECAT_IOS_API_KEY) {
    console.error('[RevenueCat] API key not found in environment variables');
    console.error('[RevenueCat] VITE_REVENUECAT_IOS_API_KEY =', import.meta.env.VITE_REVENUECAT_IOS_API_KEY);
    return;
  }

  try {
    if (!isRevenueCatInitialized) {
      console.log('[RevenueCat] Calling Purchases.configure...');
      await Purchases.configure({
        apiKey: REVENUECAT_IOS_API_KEY,
        appUserID: userId,
      });

      if (import.meta.env.DEV) {
        console.log('[RevenueCat] Setting log level to DEBUG...');
        await Purchases.setLogLevel({ level: LOG_LEVEL.DEBUG });
      }

      isRevenueCatInitialized = true;
      currentAppUserId = userId;
      console.log('[RevenueCat] ✅ Initialized successfully for user:', userId);
      return;
    }

    if (currentAppUserId === userId) {
      console.log('[RevenueCat] Already configured for user:', userId);
      return;
    }

    console.log('[RevenueCat] Switching RevenueCat user via logIn...');
    const logInResult: LogInResult = await Purchases.logIn({ appUserID: userId });
    currentAppUserId = userId;
    console.log('[RevenueCat] logIn result:', {
      created: logInResult.created,
      originalAppUserId: logInResult.customerInfo.originalAppUserId,
    });

    // CRITICAL FIX: Force fresh fetch from server to bypass stale local cache
    // This prevents subscription data from previous user persisting after account switch
    console.log('[RevenueCat] Forcing fresh customer info fetch to bypass cache...');
    const { customerInfo: freshCustomerInfo } = await Purchases.getCustomerInfo();
    console.log('[RevenueCat] Fresh customer info fetched:', {
      originalAppUserId: freshCustomerInfo.originalAppUserId,
      hasActiveEntitlement: freshCustomerInfo.entitlements.active['premium_features'] !== undefined,
      matchesCurrentUser: freshCustomerInfo.originalAppUserId === userId,
    });
  } catch (error) {
    console.error('[RevenueCat] ❌ Initialization failed:', error);
    isRevenueCatInitialized = false;
    throw error;
  }
}

/**
 * Get current customer info including subscription status
 */
export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  try {
    const { customerInfo } = await Purchases.getCustomerInfo();
    return customerInfo;
  } catch (error) {
    console.error('[RevenueCat] Failed to get customer info:', error);
    return null;
  }
}

/**
 * Get available subscription offerings/packages
 */
export async function getOfferings() {
  if (!Capacitor.isNativePlatform()) {
    return null;
  }

  try {
    const offerings = await Purchases.getOfferings();
    return offerings;
  } catch (error) {
    console.error('[RevenueCat] Failed to get offerings:', error);
    return null;
  }
}

/**
 * Purchase a subscription package
 * @param packageToPurchase - The package to purchase (weekly, monthly, yearly)
 * @returns CustomerInfo if successful, null if cancelled
 */
export async function purchasePackage(packageToPurchase: any) {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Purchases only available on native platforms');
  }

  try {
    const { customerInfo } = await Purchases.purchasePackage({ aPackage: packageToPurchase });
    return customerInfo;
  } catch (error: any) {
    if (error.userCancelled) {
      console.log('[RevenueCat] User cancelled purchase');
      return null;
    }
    console.error('[RevenueCat] Purchase failed:', error);
    throw error;
  }
}

/**
 * Restore previous purchases
 * Useful when user reinstalls app or signs in on new device
 */
export async function restorePurchases() {
  if (!Capacitor.isNativePlatform()) {
    throw new Error('Restore only available on native platforms');
  }

  try {
    const { customerInfo } = await Purchases.restorePurchases();
    return customerInfo;
  } catch (error) {
    console.error('[RevenueCat] Restore failed:', error);
    throw error;
  }
}

/**
 * Check if user has active premium entitlement
 * SECURITY: Also verifies that the subscription belongs to the current user
 * to prevent subscription sharing between accounts on the same device
 *
 * @param customerInfo - Customer info from RevenueCat
 * @param currentUserId - The current logged-in user's ID
 * @returns true if user has active premium subscription AND is the original purchaser
 */
export function isPremiumUser(customerInfo: CustomerInfo | null, currentUserId: string): boolean {
  if (!customerInfo) return false;

  // Check if user has active premium entitlement
  const hasActiveEntitlement = customerInfo.entitlements.active['premium_features'] !== undefined;
  if (!hasActiveEntitlement) return false;

  // SECURITY CHECK: Verify this user is the original purchaser
  // This prevents subscription sharing when switching accounts on the same device
  const isOriginalPurchaser = customerInfo.originalAppUserId === currentUserId;

  if (!isOriginalPurchaser) {
    console.error('[RevenueCat] 🚨 SECURITY: Subscription belongs to a different user');
    console.error('[RevenueCat] Current user:', currentUserId);
    console.error('[RevenueCat] Original purchaser:', customerInfo.originalAppUserId);
    console.error('[RevenueCat] BLOCKING cross-account premium access - subscription not transferable');
    console.warn('[RevenueCat] ⚠️ Subscription belongs to a different user:', {
      currentUser: currentUserId,
      originalPurchaser: customerInfo.originalAppUserId,
      message: 'Access denied - subscription not transferable between accounts'
    });
  }

  return isOriginalPurchaser;
}

/**
 * Get trial end date if user is in trial period
 * @param customerInfo - Customer info from RevenueCat
 * @returns Date when trial ends, or null if not in trial
 */
export function getTrialEndDate(customerInfo: CustomerInfo | null): Date | null {
  if (!customerInfo) return null;

  const premiumEntitlement = customerInfo.entitlements.active['premium_features'];
  if (!premiumEntitlement) return null;

  // Check if this is a trial period
  if (premiumEntitlement.periodType === 'TRIAL' && premiumEntitlement.expirationDate) {
    return new Date(premiumEntitlement.expirationDate);
  }

  return null;
}

/**
 * Clear local RevenueCat user association when signing out.
 */
export async function logoutRevenueCatUser() {
  if (!Capacitor.isNativePlatform()) {
    return;
  }

  if (!isRevenueCatInitialized) {
    currentAppUserId = null;
    return;
  }

  try {
    await Purchases.logOut();
    currentAppUserId = null;
    // CRITICAL: Force reinitialization on next login to prevent stale cached data
    isRevenueCatInitialized = false;
    console.log('[RevenueCat] User logged out from Purchases client');
  } catch (error) {
    console.error('[RevenueCat] Failed to log out user:', error);
  }
}
