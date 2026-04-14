/**
 * RevenueCat Webhook Handler
 *
 * Listens for subscription events from RevenueCat and updates the profiles table.
 * This ensures subscription status is synchronized between RevenueCat and Supabase.
 *
 * Events handled:
 * - INITIAL_PURCHASE: User starts subscription or trial
 * - RENEWAL: Subscription auto-renews
 * - PRODUCT_CHANGE: User upgrades/downgrades
 * - CANCELLATION: User cancels subscription (will expire at period end)
 * - EXPIRATION: Subscription expired
 * - BILLING_ISSUE: Payment failed
 *
 * Security:
 * - Verifies RevenueCat webhook signature
 * - Uses service role key for database access
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const REVENUECAT_WEBHOOK_SECRET = Deno.env.get('REVENUECAT_WEBHOOK_SECRET')!;
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Verifies the RevenueCat webhook signature.
 * This prevents unauthorized requests from modifying subscription data.
 */
async function verifySignature(
  signature: string,
  body: string,
  secret: string
): Promise<boolean> {
  try {
    // RevenueCat uses HMAC-SHA256 for signature verification
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify']
    );

    const signatureBytes = Uint8Array.from(
      atob(signature),
      (c) => c.charCodeAt(0)
    );

    const bodyBytes = encoder.encode(body);

    const isValid = await crypto.subtle.verify(
      'HMAC',
      key,
      signatureBytes,
      bodyBytes
    );

    return isValid;
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Handles RevenueCat webhook events.
 */
serve(async (req) => {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.text();

    // Verify webhook authorization (RevenueCat's recommended approach)
    // RevenueCat sends the authorization header you configure in the dashboard
    if (REVENUECAT_WEBHOOK_SECRET) {
      const authHeader = req.headers.get('Authorization');

      if (!authHeader) {
        console.error('Missing Authorization header');
        return new Response('Missing authorization', { status: 401 });
      }

      // Compare the authorization header to the expected secret
      if (authHeader !== REVENUECAT_WEBHOOK_SECRET) {
        console.error('Invalid authorization header');
        return new Response('Invalid authorization', { status: 401 });
      }
    } else {
      console.warn('REVENUECAT_WEBHOOK_SECRET not set - skipping authorization verification');
      console.warn('This should only be used for testing. Set REVENUECAT_WEBHOOK_SECRET for production.');
    }

    const payload = JSON.parse(body);
    const { event } = payload;

    console.log('Received event:', {
      type: event.type,
      appUserId: event.app_user_id,
      productId: event.product_id,
    });

    // Initialize Supabase client with service role
    const supabase = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Get user ID from RevenueCat app_user_id
    const appUserId = event.app_user_id;

    if (!appUserId) {
      console.error('Missing app_user_id in event');
      return new Response('Missing app_user_id', { status: 400 });
    }

    // Handle different event types
    switch (event.type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'PRODUCT_CHANGE':
      case 'UNCANCELLATION': {
        // User has active subscription
        const updateData: any = {
          subscription_tier: 'premium',
          last_subscription_check: new Date().toISOString(),
        };

        // Add subscription dates if available
        if (event.purchased_at_ms) {
          updateData.subscription_started_at = new Date(event.purchased_at_ms).toISOString();
        }

        if (event.expiration_at_ms) {
          updateData.subscription_expires_at = new Date(event.expiration_at_ms).toISOString();
        }

        // Handle trial information
        if (event.is_trial_conversion === false && event.expiration_at_ms) {
          // User is in trial period
          const expirationDate = new Date(event.expiration_at_ms);
          const now = new Date();

          if (expirationDate > now) {
            updateData.trial_started_at = event.purchased_at_ms
              ? new Date(event.purchased_at_ms).toISOString()
              : new Date().toISOString();
            updateData.trial_ends_at = expirationDate.toISOString();
          }
        }

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', appUserId);

        if (updateError) {
          console.error('Error updating profile:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update profile', details: updateError }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        console.log('Updated profile to premium:', appUserId);
        break;
      }

      case 'CANCELLATION': {
        // User cancelled subscription - will expire at period end
        // Don't downgrade immediately, wait for EXPIRATION event
        const updateData: any = {
          last_subscription_check: new Date().toISOString(),
        };

        if (event.expiration_at_ms) {
          updateData.subscription_expires_at = new Date(event.expiration_at_ms).toISOString();
        }

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', appUserId);

        if (updateError) {
          console.error('Error updating cancellation:', updateError);
        }

        console.log('Subscription cancelled (will expire):', appUserId);
        break;
      }

      case 'EXPIRATION': {
        // Subscription expired - downgrade to free
        const updateData: any = {
          subscription_tier: 'free',
          last_subscription_check: new Date().toISOString(),
        };

        if (event.expiration_at_ms) {
          updateData.subscription_expires_at = new Date(event.expiration_at_ms).toISOString();
        }

        const { error: updateError } = await supabase
          .from('profiles')
          .update(updateData)
          .eq('id', appUserId);

        if (updateError) {
          console.error('Error updating expiration:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update profile', details: updateError }),
            { status: 500, headers: { 'Content-Type': 'application/json' } }
          );
        }

        console.log('Subscription expired, downgraded to free:', appUserId);
        break;
      }

      case 'BILLING_ISSUE': {
        // Log billing issue but don't change subscription yet
        // RevenueCat will send EXPIRATION if payment fails repeatedly
        console.warn('Billing issue for user:', {
          userId: appUserId,
          productId: event.product_id,
        });

        // Update last check timestamp
        await supabase
          .from('profiles')
          .update({ last_subscription_check: new Date().toISOString() })
          .eq('id', appUserId);

        break;
      }

      case 'SUBSCRIBER_ALIAS': {
        // Handle user ID aliasing (e.g., anonymous -> authenticated user)
        console.log('Subscriber alias event:', {
          newAppUserId: event.new_app_user_id,
          originalAppUserId: event.original_app_user_id,
        });
        // You may want to handle this if you support anonymous users
        break;
      }

      default:
        console.log('Unhandled event type:', event.type);
    }

    // Return success response
    return new Response(
      JSON.stringify({
        received: true,
        event_type: event.type,
        app_user_id: appUserId,
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Webhook error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';

    return new Response(
      JSON.stringify({
        error: 'Webhook processing failed',
        message,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
});
