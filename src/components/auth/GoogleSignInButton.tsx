import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getAuthRedirectUrl } from "@/lib/auth-config";
import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { extractOAuthCode } from "@/lib/oauth";
import { vLog } from "@/components/VisualDebugLogger";

const GoogleLogo = () => (
  <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
    <path fill="#EA4335" d="M11.99 13.56v-3.18h5.95c.08.42.12.85.12 1.31 0 1.45-.39 2.58-1.05 3.43l-.01.02 2.41 1.87.17.02c1.51-1.39 2.39-3.44 2.39-5.83 0-.54-.05-1.07-.15-1.58H12v3.11h-.01z" />
    <path fill="#34A853" d="M12 21c2.16 0 3.98-.71 5.31-1.93l-2.53-1.95c-.69.47-1.58.75-2.78.75-2.14 0-3.95-1.44-4.6-3.38l-.01.01-2.61 2.03-.03.01C6.09 18.99 8.83 21 12 21z" />
    <path fill="#FBBC05" d="M6.4 14.49A5.98 5.98 0 0 1 6 12c0-.85.15-1.67.38-2.45l-.01.01-2.63-2.06-.09.05A9 9 0 0 0 3 12c0 1.47.35 2.86.96 4.09l2.44-1.6z" />
    <path fill="#4285F4" d="M12 5.49c1.49 0 2.48.64 3.05 1.17l2.23-2.2C15.99 2.97 14.16 2.2 12 2.2c-3.17 0-6 2.01-7.11 4.82l2.5 1.94C7.98 6.93 9.79 5.49 12 5.49z" />
  </svg>
);

export const GoogleSignInButton = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const platform = useMemo(() => Capacitor.getPlatform(), []);
  const isNative = platform === "ios" || platform === "android";

  const handlePress = async () => {
    try {
      setLoading(true);
      vLog.info("Auth", "Google sign-in button pressed", {
        platform,
        isNative,
        path: window.location.pathname,
      });

      const redirectTo = getAuthRedirectUrl();
      const { error, data } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo,
          queryParams: {
            access_type: "offline",
            prompt: "select_account",
          },
          skipBrowserRedirect: isNative,
        },
      });

      if (error) {
        vLog.error("Auth", "Google signInWithOAuth error", error);
        throw error;
      }

      if (!data?.url) {
        console.warn("[GoogleSignIn] No OAuth URL returned from Supabase");
        vLog.error("Auth", "Google signInWithOAuth returned no URL", {});
        return;
      }

      vLog.info("Auth", "Google signInWithOAuth succeeded", {
        isNative,
        hasUrl: Boolean(data.url),
      });

      if (isNative) {
        console.log("[GoogleSignIn] ====== SETTING UP NATIVE FLOW ======");
        const { App } = await import("@capacitor/app");
        const appUrlHandler = await App.addListener("appUrlOpen", async ({ url }) => {
          console.log("[GoogleSignIn] ====== APP URL OPEN EVENT ======");
          console.log("[GoogleSignIn] Received URL:", url);
          vLog.info("Auth", "Google appUrlOpen received", { url });

          try {
            await Browser.close();
            console.log("[GoogleSignIn] Browser closed");
          } catch (closeErr) {
            console.warn("[GoogleSignIn] Failed to close in-app browser", closeErr);
          }

          await appUrlHandler.remove();
          console.log("[GoogleSignIn] Handler removed");

          if (!url) {
            console.log("[GoogleSignIn] No URL received, returning");
            vLog.warning("Auth", "Google appUrlOpen without URL", {});
            return;
          }

          console.log("[GoogleSignIn] Checking if URL includes auth/callback...");
          if (url.includes("auth/callback")) {
            console.log("[GoogleSignIn] ====== AUTH CALLBACK DETECTED ======");
            try {
              const code = extractOAuthCode(url);
              console.log("[GoogleSignIn] Extracted code:", code ? "YES (hidden)" : "NO");
              if (!code) {
                vLog.error("Auth", "Google callback missing authorization code", { url });
                throw new Error("No authorization code found in callback URL");
              }

              console.log("[GoogleSignIn] ====== EXCHANGING CODE FOR SESSION ======");
              const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

              if (exchangeError) {
                console.error("[GoogleSignIn] Exchange error:", exchangeError);
                vLog.error("Auth", "Google exchangeCodeForSession error", exchangeError);
                throw exchangeError;
              }

              // Set "just signed in" flag IMMEDIATELY after code exchange
              // This tells MainRoutes to be patient waiting for session to stabilize
              // Use localStorage instead of sessionStorage for better iOS WebView compatibility
              localStorage.setItem('auth:just-signed-in', String(Date.now()));
              console.log("[GoogleSignIn] Set just-signed-in flag");

              // VERIFY session with retries - session may not be in localStorage immediately
              let sessionVerified = false;
              let verifiedUserId = "";
              for (let i = 0; i < 5; i++) {
                const { data: sessionData } = await supabase.auth.getSession();
                if (sessionData?.session?.user) {
                  sessionVerified = true;
                  verifiedUserId = sessionData.session.user.id;
                  break;
                }
                console.log(`[GoogleSignIn] Session check attempt ${i + 1}/5 - not ready yet`);
                await new Promise(r => setTimeout(r, 200));
              }

              if (!sessionVerified) {
                vLog.error("Auth", "Google session not established after code exchange", {});
                localStorage.removeItem('auth:just-signed-in');
                throw new Error("Session not established after code exchange");
              }

              console.log("[GoogleSignIn] ====== SESSION VERIFIED ======");
              vLog.success("Auth", "Google session verified, reloading /", {
                userId: verifiedUserId,
              });

              // Close the in-app browser first, then reload after a small delay
              // This gives the WebView time to properly handle the state change
              try {
                await Browser.close();
              } catch (e) {
                // Browser might already be closed
              }

              // Use setTimeout to ensure the browser is fully closed before reload
              setTimeout(() => {
                window.location.href = "/";
                vLog.info("Auth", "Google redirect to root triggered", {});
              }, 100);
            } catch (exchangeErr) {
              console.error("[GoogleSignIn] exchangeCodeForSession failed", exchangeErr);
              vLog.error("Auth", "Google sign-in flow failed in callback handler", exchangeErr);
              toast({
                title: "Google Sign-In Failed",
                description:
                  exchangeErr instanceof Error
                    ? exchangeErr.message
                    : "Unable to finish Google sign-in. Please try again.",
                variant: "destructive",
              });
            }
          } else {
            console.log("[GoogleSignIn] URL does not include auth/callback, ignoring");
            vLog.info("Auth", "Google appUrlOpen URL ignored (no auth/callback)", { url });
          }
        });

        try {
          console.log("[GoogleSignIn] ====== OPENING BROWSER ======");
          await Browser.open({ url: data.url, presentationStyle: "fullscreen" });
          console.log("[GoogleSignIn] Browser opened successfully");
          vLog.info("Auth", "Google in-app browser opened", {});
        } catch (browserErr) {
          console.error("[GoogleSignIn] Browser open failed:", browserErr);
          vLog.error("Auth", "Google Browser.open failed", browserErr);
          await appUrlHandler.remove();
          throw browserErr;
        }
      } else {
        vLog.info("Auth", "Google web sign-in redirecting to URL", { url: data.url });
        window.location.href = data.url;
      }
    } catch (error) {
      vLog.error("Auth", "Google sign-in top-level error", error);
      toast({
        title: "Google Sign-In Failed",
        description: error instanceof Error ? error.message : "Unable to sign in with Google.",
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
      className="flex h-14 w-full items-center justify-center gap-3 rounded-2xl border border-white/40 bg-white/90 text-base font-semibold text-foreground shadow-[0_20px_60px_-35px_rgba(15,23,42,0.55)] backdrop-blur-xl transition-transform duration-200 hover:translate-y-[-2px] hover:bg-white active:scale-[0.97] disabled:translate-y-0 disabled:opacity-60 dark:border-white/15 dark:bg-white/10 dark:text-white dark:hover:bg-white/15"
      aria-label="Sign in with Google"
    >
      <GoogleLogo />
      {loading ? "Signing in..." : "Sign in with Google"}
    </Button>
  );
};
