import { useEffect, useCallback, useRef } from 'react';
import { Capacitor } from '@capacitor/core';
import { Purchases } from '@revenuecat/purchases-capacitor';
import { RevenueCatUI, PAYWALL_RESULT } from '@revenuecat/purchases-capacitor-ui';
import { useSubscriptionStore } from '@/lib/subscriptionStore';
import { toast } from '@/hooks/use-toast';
import { isInitialized } from '@/lib/revenuecat';

interface PaywallProps {
  open: boolean;
  onClose: () => void;
  feature?: string; // Optional: what feature triggered the paywall
}

export function Paywall({ open, onClose, feature }: PaywallProps) {
  const { setCustomerInfo, setIsPremium } = useSubscriptionStore();
  const isPresentingRef = useRef(false);

  console.log('[Paywall] Component rendered - open:', open, 'feature:', feature);

  const presentPaywall = useCallback(async () => {
    // Prevent double-triggering
    if (isPresentingRef.current) {
      console.log('[Paywall] Already presenting, ignoring duplicate call');
      return;
    }

    try {
      isPresentingRef.current = true;

      // Check if RevenueCat is initialized
      if (!isInitialized()) {
        console.warn('[Paywall] RevenueCat not initialized yet, waiting...');
        toast({
          title: 'Loading...',
          description: 'Please wait while we load payment options',
        });
        // Try again after a short delay
        setTimeout(() => {
          if (isInitialized()) {
            presentPaywall();
          } else {
            console.error('[Paywall] RevenueCat still not initialized after delay');
            onClose();
          }
        }, 1000);
        return;
      }

      console.log('[Paywall] Attempting to present paywall...');
      console.log('[Paywall] Platform:', Capacitor.getPlatform());
      console.log('[Paywall] Is native?:', Capacitor.isNativePlatform());

      // DEBUG: Check offerings before presenting paywall
      try {
        const offerings = await Purchases.getOfferings();
        console.log('[Paywall] DEBUG - Offerings:', offerings);
        console.log('[Paywall] DEBUG - Current offering:', offerings.current);
        console.log('[Paywall] DEBUG - Available packages:', offerings.current?.availablePackages);

        if (!offerings.current) {
          console.error('[Paywall] ❌ No current offering found! Check RevenueCat dashboard configuration.');
          toast({
            title: 'Configuration Error',
            description: 'No subscription offerings found. Please contact support.',
            variant: 'destructive',
          });
          isPresentingRef.current = false;
          onClose();
          return;
        }
      } catch (offeringsError) {
        console.error('[Paywall] Failed to fetch offerings:', offeringsError);
      }

      // Present RevenueCat's native paywall using RevenueCatUI
      const result = await RevenueCatUI.presentPaywall();

      console.log('[Paywall] Presentation result:', result);
      console.log('[Paywall] Result type:', typeof result);

      // Check the result - robust check for object or direct value
      // Cast to any to avoid TypeScript overlap errors if types are mismatched
      const resultValue = (result as any)?.result || result;

      if (resultValue === PAYWALL_RESULT.PURCHASED || resultValue === 'PURCHASED') {
        console.log('[Paywall] Purchase successful, updating customer info...');
        const customerInfo = await Purchases.getCustomerInfo();
        setCustomerInfo(customerInfo.customerInfo);
        setIsPremium(true);

        toast({
          title: 'Welcome to Premium! 🎉',
          description: feature ? `You can now access ${feature}` : 'Enjoy all premium features',
        });

        isPresentingRef.current = false;
        onClose();
      } else {
        // User closed paywall without purchasing (CANCELLED, RESTORED, or ERROR)
        console.log('[Paywall] Paywall closed without purchase');
        isPresentingRef.current = false;
        onClose();
      }
    } catch (error: any) {
      console.error('[Paywall] Error presenting paywall:', error);
      console.error('[Paywall] Error code:', error?.code);
      console.error('[Paywall] Error message:', error?.message);
      console.error('[Paywall] Error stack:', error?.stack);
      console.error('[Paywall] Full error object:', JSON.stringify(error, null, 2));

      // Check if user just closed the paywall (not an actual error)
      if (error?.message?.includes('cancelled') || error?.message?.includes('closed')) {
        console.log('[Paywall] User cancelled/closed paywall');
        isPresentingRef.current = false;
        onClose();
        return;
      }

      // Show specific error message for Error 23
      let errorDescription = 'Failed to load payment options. Please try again.';
      if (error?.code === 23) {
        errorDescription = 'Configuration error: No offerings found. Please check RevenueCat dashboard setup.';
      } else if (error?.code) {
        errorDescription = `Error ${error.code}: ${error.message || 'Please try again.'}`;
      }

      toast({
        title: 'Subscription Error',
        description: errorDescription,
        variant: 'destructive',
        duration: 10000,
      });
      isPresentingRef.current = false;
      onClose();
    }
  }, [setCustomerInfo, onClose, feature]);

  useEffect(() => {
    if (open && Capacitor.isNativePlatform()) {
      presentPaywall();
    } else if (!open) {
      // Reset the flag when paywall is closed
      isPresentingRef.current = false;
    }
  }, [open, presentPaywall]);

  // On web platform, show a message
  if (!Capacitor.isNativePlatform() && open) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-sm w-full">
          <h2 className="text-xl font-bold mb-2">Premium Feature</h2>
          <p className="text-gray-600 dark:text-gray-300 mb-4">
            {feature ? `${feature} requires` : 'This feature requires'} a premium subscription.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Subscriptions are only available on the iOS app.
          </p>
          <button
            onClick={onClose}
            className="w-full bg-primary text-white rounded-lg py-2 px-4 font-medium"
          >
            Got it
          </button>
        </div>
      </div>
    );
  }

  // Native platform - paywall is presented as native modal, so no JSX needed
  return null;
}
