import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { extractOAuthCode } from "@/lib/oauth";
import { vLog } from "@/components/VisualDebugLogger";

const AuthCallback = () => {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const exchangeSession = async () => {
      try {
        console.log("[AuthCallback] Exchanging code for session...");
        vLog.info("Auth", "AuthCallback route hit, exchanging code", {
          href: window.location.href,
        });
        const code = extractOAuthCode(window.location.href);
        if (!code) {
          vLog.error("Auth", "AuthCallback missing authorization code", {
            href: window.location.href,
          });
          throw new Error("Missing authorization code in callback URL");
        }
        const { error, data } = await supabase.auth.exchangeCodeForSession(code);
        if (error) throw error;

        console.log("[AuthCallback] Session exchange successful");
        vLog.success("Auth", "AuthCallback session exchange successful", {
          hasSession: Boolean(data?.session),
        });

        // Check if we're in a browser (not in the app's WebView)
        // If the URL contains the web domain, we need to redirect back to the app
        const isInBrowser = window.location.origin.includes('minimalog.fit') ||
                           window.location.origin.includes('localhost') ||
                           window.location.origin.includes('192.168');

        if (isInBrowser && data?.session) {
          console.log("[AuthCallback] In browser, redirecting to app via deep link...");
          // Redirect to the app using custom URL scheme with session tokens
          // Pass tokens via URL hash so the app can establish the session
          const { access_token, refresh_token } = data.session;
          const deepLinkUrl = `com.minimalog.app://#access_token=${access_token}&refresh_token=${refresh_token}&type=recovery`;
          console.log("[AuthCallback] Redirecting to:", deepLinkUrl);
          vLog.info("Auth", "AuthCallback redirecting back to app via deep link", {
            deepLinkUrl,
          });
          window.location.href = deepLinkUrl;
          // Also show a message in case the redirect doesn't work
          setTimeout(() => {
            setError("Please return to the app to continue.");
          }, 1000);
        } else {
          // In the app's WebView - don't navigate directly to home.
          // The SIGNED_IN event will trigger MainRoutes to check onboarding status
          // and navigate to /onboarding for new users or / for existing users.
          console.log("[AuthCallback] Session established, MainRoutes will handle navigation");
        }
      } catch (err) {
        console.error("[AuthCallback] Exchange failed:", err);
        vLog.error("Auth", "AuthCallback session exchange failed", err);
        setError(err instanceof Error ? err.message : "Unexpected error");
      }
    };

    void exchangeSession();
  }, [navigate]);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md text-center">
          <h1 className="text-xl font-semibold">Login Failed</h1>
          <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="animate-pulse text-muted-foreground">Finishing sign-in…</div>
    </div>
  );
};

export default AuthCallback;
