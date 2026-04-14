import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { SignInWithApple } from "@capacitor-community/apple-sign-in";
import { Apple } from "lucide-react";
import { getAuthRedirectUrl } from "@/lib/auth-config";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { syncProfileFirstName } from "@/util/profile";
import { extractFirstName } from "@/util/names";
import { vLog } from "@/components/VisualDebugLogger";

const APPLE_CLIENT_ID = "com.minimalog.app.auth";
const APPLE_REDIRECT_URI = "https://minimalog.fit";

const generateRandomString = (length = 32) => {
  const globalCrypto = globalThis.crypto;
  if (!globalCrypto?.getRandomValues) {
    throw new Error("Secure random number generation is not supported in this environment.");
  }

  const charset = "0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._";
  const randomValues = globalCrypto.getRandomValues(new Uint8Array(length));
  let result = "";
  randomValues.forEach((value) => {
    result += charset[value % charset.length];
  });
  return result;
};

export const AppleSignInButton = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const platform = useMemo(() => Capacitor.getPlatform(), []);
  const isNativeIOS = platform === "ios";

  const hashNonce = async (nonce: string) => {
    const encoder = new TextEncoder();
    const data = encoder.encode(nonce);
    const webCrypto = typeof globalThis !== "undefined" ? (globalThis.crypto as Crypto | undefined) : undefined;

    if (webCrypto?.subtle?.digest) {
      const hashBuffer = await webCrypto.subtle.digest("SHA-256", data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
    }

    return bytesToHex(sha256(data));
  };

  const handleNativeApple = async () => {
    vLog.info("Auth", "Apple native sign-in started", {
      platform,
      path: window.location.pathname,
    });
    const nonce = generateRandomString();
    const state = generateRandomString(16);
    const hashedNonce = await hashNonce(nonce);
    if (import.meta.env.DEV) console.log("Prepared Apple Sign-In request");

    const { response } = await SignInWithApple.authorize({
      clientId: APPLE_CLIENT_ID,
      redirectURI: APPLE_REDIRECT_URI,
      scopes: "email name",
      nonce: hashedNonce,
      state,
    });

    if (import.meta.env.DEV) console.log("Received Apple Sign-In response");
    vLog.info("Auth", "Apple native SignInWithApple response received", {
      hasIdentityToken: Boolean(response?.identityToken),
    });

    if (!response?.identityToken) {
      vLog.error("Auth", "Apple did not return identity token", {});
      throw new Error("Apple did not return an identity token.");
    }

    const { data: signInData, error } = await supabase.auth.signInWithIdToken({
      provider: "apple",
      token: response.identityToken,
      nonce,
    });
    if (import.meta.env.DEV) console.log("Completed Supabase Apple sign-in");

    if (error) {
      vLog.error("Auth", "Supabase signInWithIdToken (Apple) error", error);
      throw error;
    }
    vLog.info("Auth", "Supabase signInWithIdToken (Apple) succeeded", {
      hasSession: Boolean(signInData?.session),
    });

    const givenName = response?.fullName?.givenName || response?.fullName?.nickname || response?.fullName?.namePrefix;
    const derivedFirstName = extractFirstName(givenName);
    if (import.meta.env.DEV) console.log("Derived first name from Apple payload");

    if (derivedFirstName) {
      try {
        const updateResult = await supabase.auth.updateUser({
          data: {
            first_name: derivedFirstName,
            full_name: derivedFirstName,
            name: derivedFirstName,
          },
        });
        if (import.meta.env.DEV) console.log("Updated Supabase auth metadata with first name");

        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (import.meta.env.DEV) console.log("Synced user profile metadata after Apple sign-in");

        if (user?.id) {
          const syncResult = await syncProfileFirstName(user.id, derivedFirstName);
          if (!syncResult.success) {
            if (import.meta.env.DEV)
              console.warn("Apple first-name sync could not persist to profile");
          } else {
            window.dispatchEvent(
              new CustomEvent("profile:updated", {
                detail: { id: user.id, name: derivedFirstName, full_name: derivedFirstName },
              }),
            );
          }
        }
      } catch (syncError) {
        if (import.meta.env.DEV) console.warn("Unable to sync Apple first name");
        vLog.warning("Auth", "Unable to sync Apple first name", syncError);
      }
    } else {
      if (import.meta.env.DEV) console.log("Apple Sign-In: unable to derive first name.");
      vLog.info("Auth", "Apple Sign-In: unable to derive first name", {});
    }

    // Set "just signed in" flag IMMEDIATELY after sign-in
    // This tells MainRoutes to be patient waiting for session to stabilize
    // Use localStorage instead of sessionStorage for better iOS WebView compatibility
    localStorage.setItem('auth:just-signed-in', String(Date.now()));
    console.log("[AppleSignIn] Set just-signed-in flag");

    // VERIFY session with retries - session may not be in localStorage immediately
    let sessionVerified = false;
    let verifiedUserId = "";
    for (let i = 0; i < 5; i++) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session) {
        sessionVerified = true;
        verifiedUserId = sessionData.session.user.id;
        break;
      }
      console.log(`[AppleSignIn] Session check attempt ${i + 1}/5 - not ready yet`);
      await new Promise(r => setTimeout(r, 200));
    }

    if (!sessionVerified) {
      vLog.error("Auth", "No session after Apple sign-in", {});
      localStorage.removeItem('auth:just-signed-in');
      throw new Error("Session not established after Apple sign-in");
    }

    // Force a full page reload to "/"
    // React Router navigate() and Supabase queries don't work reliably
    // after signInWithIdToken due to event handler interference
    console.log("[AppleSignIn] ====== SESSION VERIFIED - FORCING RELOAD ======");
    vLog.success("Auth", "Apple session verified, reloading /", {
      userId: verifiedUserId,
    });
    window.location.href = "/";
  };

  const handleWebApple = async () => {
    const redirectTo = getAuthRedirectUrl();
    const { error, data } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo,
        scopes: "email name",
      },
    });

    if (error) {
      vLog.error("Auth", "Apple web signInWithOAuth error", error);
      throw error;
    }

    if (data?.url) {
      vLog.info("Auth", "Apple web sign-in redirecting to URL", { url: data.url });
      window.location.href = data.url;
    }
  };

  const handlePress = async () => {
    try {
      setLoading(true);

      if (isNativeIOS) {
        await handleNativeApple();
        // Navigation is handled inside handleNativeApple after sign-in completes
      } else {
        await handleWebApple();
      }
    } catch (error: unknown) {
      vLog.error("Auth", "Apple sign-in top-level error", error);
      const message =
        error instanceof Error
          ? error.message
          : "Unable to sign in with Apple. Please try again.";
      toast({
        title: "Apple Sign-In Failed",
        description: message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      onClick={handlePress}
      disabled={loading}
      className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-black/10 bg-black text-base font-semibold text-white shadow-[0_24px_60px_-30px_rgba(0,0,0,0.65)] transition-transform duration-200 hover:translate-y-[-2px] hover:bg-black/90 active:scale-[0.97] disabled:translate-y-0 disabled:opacity-60 dark:border-white/10"
      aria-label="Sign in with Apple"
    >
      <Apple className="h-5 w-5" />
      {loading ? "Signing in..." : "Sign in with Apple"}
    </Button>
  );
};
