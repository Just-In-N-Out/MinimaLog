import { useState, useEffect, useRef, useLayoutEffect, useCallback, type RefObject, type SyntheticEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Dumbbell } from "lucide-react";
import { setupDeepLinkHandling } from "@/lib/auth-config";
import { type User } from "@supabase/supabase-js";
import { AppleSignInButton } from "@/components/auth/AppleSignInButton";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { AnimatePresence, motion } from "framer-motion";
import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { syncProfileFirstName } from "@/util/profile";
import { extractOAuthCode } from "@/lib/oauth";
import { vLog } from "@/components/VisualDebugLogger";

type AuthStage = "landing" | "providers" | "email";

const stageTransition = {
  duration: 0.35,
  ease: [0.4, 0, 0.2, 1] as const,
};

gsap.registerPlugin(CustomEase);
const ULTRA_SMOOTH_EASE = CustomEase.create("ultraSmooth", "M0,0 C0.22,0.05 0.03,1 1,1");

const STAGE_MOTION: Record<AuthStage, { y: number; scale: number }> = {
  landing: { y: 0, scale: 1 },
  providers: { y: -20, scale: 1 },
  email: { y: -20, scale: 1 },
};

const extractFirstName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] || "";
};

const Auth = () => {
  const [authStage, setAuthStage] = useState<AuthStage>("landing");
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const authStageRef = useRef<AuthStage>("landing");
  const updateAuthStage = useCallback(
    (nextStage: AuthStage) => {
      authStageRef.current = nextStage;
      setAuthStage(nextStage);
    },
    [setAuthStage],
  );

  const ensureFirstNameSaved = useCallback(
    async (user: User | null | undefined) => {
      if (!user) return;

      const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
      const candidates: unknown[] = [
        metadata.first_name,
        metadata.given_name,
        metadata.name,
        metadata.full_name,
      ];

      let derivedFirstName = "";
      for (const candidate of candidates) {
        const normalized = extractFirstName(candidate);
        if (normalized) {
          derivedFirstName = normalized;
          break;
        }
      }

      if (!derivedFirstName && typeof user.email === "string") {
        derivedFirstName = extractFirstName(user.email.split("@")[0]);
      }

      if (!derivedFirstName) return;

      try {
        const syncResult = await syncProfileFirstName(user.id, derivedFirstName);
        if (!syncResult.success) {
          console.warn("Auth first-name sync could not persist to profile", syncResult);
        } else {
          window.dispatchEvent(
            new CustomEvent("profile:updated", {
              detail: { id: user.id, name: derivedFirstName, full_name: derivedFirstName },
            }),
          );
        }
      } catch (error) {
        console.warn("Unexpected profile name sync error:", error);
      }

      try {
        await supabase.auth.updateUser({
          data: {
            first_name: derivedFirstName,
            full_name: derivedFirstName,
            name: derivedFirstName,
          },
        });
      } catch (error) {
        console.warn("Failed to sync auth metadata name:", error);
      }
    },
    [],
  );

  useEffect(() => {
    // Initialize deep link handling for native platforms
    setupDeepLinkHandling();

    const exchangeSessionFromUrl = async () => {
      if (!window.location.pathname.includes("/auth")) return;
      const code = extractOAuthCode(window.location.href);
      if (!code) return;

      try {
        vLog.info("Auth", "Exchanging OAuth code on /auth route", {
          path: window.location.pathname,
        });
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (error) {
          console.error("exchangeCodeForSession error:", error);
          vLog.error("Auth", "exchangeCodeForSession error on /auth", error);
          toast({
            title: "Sign-in failed",
            description: error.message || "Unable to complete sign-in. Please try again.",
            variant: "destructive",
          });
          return; // CRITICAL: Stop execution on error
        }
        // Don't navigate here - let MainRoutes check onboarding status first
      } catch (err) {
        console.error("Failed to exchange OAuth code:", err);
        vLog.error("Auth", "Failed to exchange OAuth code on /auth", err);
        toast({
          title: "Sign-in error",
          description: err instanceof Error ? err.message : "An unexpected error occurred.",
          variant: "destructive",
        });
      }
    };

    void exchangeSessionFromUrl();

    // Redirect to reset page only when Supabase recovery link is detected
    const hash = window.location.hash || "";
    const searchParams = new URLSearchParams(window.location.search);
    const isRecoveryLink = hash.includes("type=recovery") || searchParams.get("type") === "recovery";

    if (isRecoveryLink) {
      if (import.meta.env.DEV) console.log("Recovery link detected. Redirecting to reset.");
      navigate(`/auth/reset${hash}${window.location.search}`, { replace: true });
      return;
    }

    // Auth state listener
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (import.meta.env.DEV) console.log("Auth state change:", event);
      vLog.info("Auth", "Auth state change in Auth page", {
        event,
        hasSession: Boolean(session),
      });

      void ensureFirstNameSaved(session?.user);

      // Redirect password recovery links to dedicated page
      if (event === "PASSWORD_RECOVERY") {
        navigate("/auth/reset" + window.location.hash, { replace: true });
        return;
      }

      // If a sign out happens while a recovery hash is present, stay in reset flow
      if (event === "SIGNED_OUT") {
        const currentHash = window.location.hash || "";
        if (
          currentHash.includes("type=recovery") ||
          currentHash.includes("code=") ||
          currentHash.includes("access_token")
        ) {
          navigate(`/auth/reset${currentHash}`, { replace: true });
          return;
        }
      }

      if (event === "SIGNED_IN" && session?.user) {
        console.log("[Auth] ====== SIGNED_IN EVENT ======");
        console.log("[Auth] User ID:", session.user.id);
        vLog.success("Auth", "SIGNED_IN in Auth page", {
          userId: session.user.id,
        });

        void ensureFirstNameSaved(session.user);

        // Check if native OAuth button is handling the redirect
        // (they set "auth:just-signed-in" flag before redirect)
        const justSignedInFlag = localStorage.getItem('auth:just-signed-in');
        if (justSignedInFlag) {
          console.log("[Auth] Native OAuth button handling redirect, skipping duplicate");
          return;
        }

        // For web OAuth and email/password: redirect here
        // The session is established, page reload will handle the rest
        console.log("[Auth] ====== REDIRECTING NOW ======");
        window.location.href = "/";
      }
    });

    // Initial session check - sync first name but don't navigate
    // Let MainRoutes check onboarding status and handle navigation
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        void ensureFirstNameSaved(session.user);
      }
    });

    return () => subscription.unsubscribe();
  }, [ensureFirstNameSaved, navigate, toast]);

  useEffect(() => {
    // Warn if backend env is missing in local builds (common when running via Xcode)
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      toast({
        title: "Backend not configured",
        description:
          "Missing backend URL or key. Ensure capacitor.config.ts points to the preview URL, then run npx cap sync ios.",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedEmail = email.trim();
    const trimmedPassword = password.trim();

    if (!trimmedEmail) {
      toast({
        title: "Missing email",
        description: "Please enter your email address.",
        variant: "destructive",
      });
      return;
    }

    if (!trimmedPassword || trimmedPassword.length < 6) {
      toast({
        title: "Password required",
        description: "Password must be at least 6 characters.",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      if (isSignUp) {
        // Sign up
        const { error } = await supabase.auth.signUp({
          email: trimmedEmail,
          password: trimmedPassword,
        });

        if (error) {
          toast({
            title: "Sign up failed",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Account created!",
          description: "Welcome to MinimaLog",
        });
      } else {
        // Sign in
        const { error } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password: trimmedPassword,
        });

        if (error) {
          toast({
            title: "Sign in failed",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Welcome back!",
          description: "Successfully signed in",
        });

        // Set just-signed-in flag to enable session retry logic in Home/App
        localStorage.setItem('auth:just-signed-in', String(Date.now()));
      }
    } catch (error: unknown) {
      console.error("Auth exception:", error);
      toast({
        title: "Unexpected error",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const goBack = () => {
    const currentStage = authStageRef.current;
    if (currentStage === "landing") return;

    transitionToStage("landing");
    setEmail("");
    setPassword("");
    setIsSignUp(false);
  };

  const handlePrimarySelect = (signUp: boolean) => {
    setIsSignUp(signUp);
    transitionToStage("providers");
  };

  const cardRef = useRef<HTMLDivElement | null>(null);
  const emailInputRef = useRef<HTMLInputElement | null>(null);
  const passwordInputRef = useRef<HTMLInputElement | null>(null);
  const logoGroupRef = useRef<HTMLDivElement | null>(null);
  const logoFloatingRef = useRef<HTMLDivElement | null>(null);
  const logoTrailRef = useRef<HTMLDivElement | null>(null);
  const groupMoveTweenRef = useRef<gsap.core.Animation | null>(null);
  const breathingTimelineRef = useRef<gsap.core.Timeline | null>(null);

  const ensureBreathing = useCallback(() => {
    const floatingElement = logoFloatingRef.current;
    if (!floatingElement || breathingTimelineRef.current) return;

    breathingTimelineRef.current = gsap
      .timeline({ repeat: -1, defaults: { ease: "power1.inOut" } })
      .to(floatingElement, { duration: 2, y: -8 })
      .to(floatingElement, { duration: 2, y: 0 });
  }, []);

  const animateGroupForStage = useCallback((stage: AuthStage) => {
    const groupElement = logoGroupRef.current;
    const trailElement = logoTrailRef.current;
    if (!groupElement) return;

    const { y, scale } = STAGE_MOTION[stage];

    if (groupMoveTweenRef.current) {
      groupMoveTweenRef.current.kill();
    }

    const duration = stage === "landing" ? 1.6 : 1.8;

    if (trailElement) {
      gsap.killTweensOf(trailElement);
    }

    const timeline = gsap.timeline({ overwrite: true });

    timeline.to(groupElement, {
      duration,
      y,
      scale,
      ease: ULTRA_SMOOTH_EASE,
      transformOrigin: "50% 50%",
      force3D: true,
    });

    if (trailElement) {
      const trailDuration = Math.min(1.0, duration * 0.6);
      if (stage !== "landing") {
        timeline.fromTo(
          trailElement,
          {
            opacity: 0.28,
            scaleY: 0.3,
            y: 22,
            transformOrigin: "50% 0%",
          },
          {
            opacity: 0,
            scaleY: 1.0,
            y: 70,
            duration: trailDuration,
            ease: ULTRA_SMOOTH_EASE,
            force3D: true,
          },
          0,
        );
      } else {
        timeline.fromTo(
          trailElement,
          {
            opacity: 0.2,
            scaleY: 0.5,
            y: 50,
            transformOrigin: "50% 0%",
          },
          {
            opacity: 0,
            scaleY: 0.2,
            y: 12,
            duration: trailDuration * 0.8,
            ease: ULTRA_SMOOTH_EASE,
            force3D: true,
          },
          0,
        );
      }
    }

    groupMoveTweenRef.current = timeline;
  }, []);

  const transitionToStage = useCallback(
    (nextStage: AuthStage) => {
      const currentStage = authStageRef.current;
      if (nextStage === currentStage) return;

      updateAuthStage(nextStage);
      ensureBreathing();
      animateGroupForStage(nextStage);
    },
    [animateGroupForStage, ensureBreathing, updateAuthStage],
  );

  const focusInput = (ref: RefObject<HTMLInputElement>) => {
    if (!ref.current) {
      return;
    }

    if (typeof document !== "undefined" && document.activeElement === ref.current) {
      return;
    }

    ref.current.focus({ preventScroll: true });
  };

  const handleInputContainerPress = (ref: RefObject<HTMLInputElement>) => (event?: SyntheticEvent) => {
    event?.preventDefault();
    event?.stopPropagation();
    requestAnimationFrame(() => {
      focusInput(ref);
    });
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (authStage === "landing") {
      return;
    }

    if (cardRef.current && cardRef.current.contains(e.target as Node)) {
      return;
    }

    goBack();
  };

  useLayoutEffect(() => {
    if (typeof window === "undefined") return;

    const floatingElement = logoFloatingRef.current;
    const groupElement = logoGroupRef.current;
    const trailElement = logoTrailRef.current;
    if (!floatingElement || !groupElement) return;

    gsap.set(floatingElement, {
      y: 0,
      force3D: true,
    });
    gsap.set(groupElement, {
      y: STAGE_MOTION[authStageRef.current].y,
      scale: STAGE_MOTION[authStageRef.current].scale,
      transformOrigin: "50% 50%",
    });
    if (trailElement) {
      gsap.set(trailElement, {
        opacity: 0,
        scaleY: 0.2,
        y: 16,
        transformOrigin: "50% 0%",
      });
    }

    gsap.ticker.fps(60);
    ensureBreathing();

    return () => {
      if (groupMoveTweenRef.current) {
        groupMoveTweenRef.current.kill();
        groupMoveTweenRef.current = null;
      }
      if (breathingTimelineRef.current) {
        breathingTimelineRef.current.kill();
        breathingTimelineRef.current = null;
      }
      if (trailElement) {
        gsap.killTweensOf(trailElement);
      }
    };
  }, [ensureBreathing]);

  return (
    <div
      className="relative flex min-h-screen w-full items-center justify-center bg-background"
      onClick={handleBackdropClick}
    >
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-background via-background/60 to-background" />
      <div className="pointer-events-none absolute inset-0 blur-3xl bg-[radial-gradient(circle_at_20%_20%,rgba(15,23,42,0.2),transparent),radial-gradient(circle_at_80%_30%,rgba(15,23,42,0.16),transparent),radial-gradient(circle_at_50%_80%,rgba(15,23,42,0.18),transparent)] dark:bg-[radial-gradient(circle_at_20%_20%,rgba(250,250,250,0.14),transparent),radial-gradient(circle_at_80%_30%,rgba(250,250,250,0.12),transparent),radial-gradient(circle_at_50%_80%,rgba(250,250,250,0.16),transparent)]" />

      <div
        className={`relative z-10 flex w-full max-w-xl min-h-screen flex-col px-6 text-center sm:px-10 ${authStage === "landing" ? "py-0" : "py-12"
          }`}
      >
        <div
          ref={logoGroupRef}
          className="relative flex w-full flex-col items-center flex-1 justify-center"
          style={{ willChange: "transform" }}
        >
          <div
            ref={logoTrailRef}
            className="pointer-events-none absolute inset-x-0 top-[88px] flex justify-center blur-[18px]"
            style={{ willChange: "transform, opacity" }}
          >
            <div className="h-24 w-24 bg-gradient-to-b from-primary/35 via-primary/15 to-transparent rounded-full" />
          </div>
          <div
            ref={logoFloatingRef}
            className="gpu-accelerated flex flex-col items-center"
            style={{ willChange: "transform" }}
          >
            <div className="flex h-28 w-28 items-center justify-center rounded-full bg-primary shadow-[0_25px_50px_-18px_rgba(15,23,42,0.55)] text-primary-foreground sm:h-32 sm:w-32">
              <Dumbbell className="h-14 w-14 sm:h-16 sm:w-16" />
            </div>
            <h1 className="mt-8 pb-1 text-5xl font-bold leading-none tracking-tight bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent sm:text-6xl">
              MinimaLog
            </h1>
            <p className="mt-3 text-xl font-medium text-foreground/80 sm:text-2xl">
              You log <span className="text-primary font-semibold">+</span> we track
            </p>
          </div>
        </div>

        <AnimatePresence mode="wait">
          {authStage === "landing" && (
            <motion.div
              key="landing"
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -16 }}
              transition={stageTransition}
              className="mt-auto w-full pb-6 sm:pb-10"
            >
              <div
                ref={cardRef}
                className="relative flex flex-col overflow-hidden rounded-[30px] border border-white/20 bg-white/80 p-6 shadow-[0_35px_90px_-50px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/70 sm:p-8"
              >
                <div className="pointer-events-none absolute inset-x-8 top-0 z-0 h-24 rounded-[28px] bg-gradient-to-b from-white/70 via-white/10 to-transparent blur-3xl dark:from-white/10 dark:via-transparent" />
                <div className="relative flex flex-col gap-5 text-left">
                  <div className="flex flex-col gap-3">
                    <AppleSignInButton />
                    <GoogleSignInButton />
                    <Button
                      type="button"
                      onClick={() => {
                        setIsSignUp(false);
                        transitionToStage("email");
                      }}
                      className="h-14 rounded-2xl border border-foreground/20 bg-transparent text-base font-semibold text-foreground transition-all duration-200 hover:translate-y-[-2px] hover:bg-foreground/5 active:scale-[0.97] dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                    >
                      Continue with Email
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {authStage === "providers" && (
            <motion.div
              key={`providers-${isSignUp ? "up" : "in"}`}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -40 }}
              transition={stageTransition}
              className="mt-10 w-full"
            >
              <div
                ref={cardRef}
                className="relative flex max-h-[65vh] flex-col overflow-hidden rounded-[30px] border border-white/20 bg-white/80 p-6 shadow-[0_35px_90px_-50px_rgba(15,23,42,0.7)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/70 sm:p-8"
              >
                <div className="pointer-events-none absolute inset-x-8 top-0 z-0 h-24 rounded-[28px] bg-gradient-to-b from-white/70 via-white/10 to-transparent blur-3xl dark:from-white/10 dark:via-transparent" />
                <div className="relative flex flex-1 flex-col gap-6 overflow-y-auto pt-0 text-left">
                  <div>
                    {isSignUp ? (
                      <>
                        <h2 className="text-3xl font-black text-foreground">Create your MinimaLog</h2>
                        <p className="mt-1 text-sm font-medium text-foreground/70 sm:text-base">
                          Choose how to get started
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-3xl font-black text-foreground">Welcome back</h2>
                        <p className="mt-1 text-sm font-medium text-foreground/70 sm:text-base">Choose how to continue</p>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    <AppleSignInButton />
                    <GoogleSignInButton />
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                      <span>or</span>
                      <span className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent" />
                    </div>
                    <Button
                      type="button"
                      onClick={() => transitionToStage("email")}
                      className="h-14 rounded-2xl border border-foreground/20 bg-transparent text-base font-semibold text-foreground transition-all duration-200 hover:translate-y-[-2px] hover:bg-foreground/5 active:scale-[0.97] dark:border-white/20 dark:text-white dark:hover:bg-white/10"
                    >
                      Continue with Email
                    </Button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {authStage === "email" && (
            <motion.div
              key={`email-${isSignUp ? "up" : "in"}`}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -30 }}
              transition={stageTransition}
              className="mt-10 w-full"
            >
              <motion.div
                layout
                ref={cardRef}
                className="relative flex max-h-[70vh] flex-col overflow-hidden rounded-[30px] border border-white/15 bg-white/75 p-6 shadow-[0_35px_90px_-60px_rgba(15,23,42,0.65)] backdrop-blur-2xl dark:border-white/10 dark:bg-zinc-900/70 sm:p-8"
              >
                <div className="pointer-events-none absolute inset-x-6 top-0 z-0 h-28 rounded-[28px] bg-gradient-to-b from-white/60 via-white/15 to-transparent blur-3xl dark:from-white/15 dark:via-transparent" />
                <div className="relative flex flex-1 flex-col gap-6 overflow-y-auto pt-0 text-left">
                  <div>
                    {isSignUp ? (
                      <>
                        <h2 className="text-3xl font-black text-foreground">Create your MinimaLog</h2>
                        <p className="mt-1 text-sm font-medium text-foreground/70 sm:text-base">
                          Enter your email and password to get started.
                        </p>
                      </>
                    ) : (
                      <>
                        <h2 className="text-3xl font-black text-foreground">Welcome back</h2>
                        <p className="mt-1 text-sm font-medium text-foreground/70 sm:text-base">
                          Enter your credentials to continue.
                        </p>
                      </>
                    )}
                  </div>

                  <form onSubmit={handleEmailAuth} className="flex flex-col gap-5">
                    <motion.div
                      layout
                      onClick={handleInputContainerPress(emailInputRef)}
                      onTouchEnd={handleInputContainerPress(emailInputRef)}
                      className="relative isolate touch-manipulation cursor-text rounded-[26px] border border-white/20 bg-white/45 p-4 transition-all duration-300 focus-within:border-foreground/30 focus-within:bg-white/65 [transform:none] dark:border-white/10 dark:bg-white/10 dark:focus-within:border-white/50 dark:focus-within:bg-white/20"
                    >
                      <Label htmlFor="email" className="text-sm font-medium text-muted-foreground">
                        Email
                      </Label>
                      <Input
                        id="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        required
                        ref={emailInputRef}
                        className="relative z-20 mt-2 h-12 w-full select-text rounded-2xl border-none bg-transparent px-0 text-base pointer-events-auto focus-visible:ring-0 focus-visible:ring-offset-0"
                        autoComplete="email"
                        inputMode="email"
                        enterKeyHint="send"
                      />
                    </motion.div>

                    <motion.div
                      layout
                      onClick={handleInputContainerPress(passwordInputRef)}
                      onTouchEnd={handleInputContainerPress(passwordInputRef)}
                      className="relative isolate touch-manipulation cursor-text rounded-[26px] border border-white/20 bg-white/45 p-4 transition-all duration-300 focus-within:border-foreground/30 focus-within:bg-white/65 [transform:none] dark:border-white/10 dark:bg-white/10 dark:focus-within:border-white/50 dark:focus-within:bg-white/20"
                    >
                      <Label htmlFor="password" className="text-sm font-medium text-muted-foreground">
                        Password
                      </Label>
                      <Input
                        id="password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="At least 6 characters"
                        required
                        ref={passwordInputRef}
                        className="relative z-20 mt-2 h-12 w-full select-text rounded-2xl border-none bg-transparent px-0 text-base pointer-events-auto focus-visible:ring-0 focus-visible:ring-offset-0"
                        autoComplete={isSignUp ? "new-password" : "current-password"}
                        enterKeyHint="done"
                      />
                    </motion.div>

                    <Button
                      type="submit"
                      className="mt-2 h-14 rounded-2xl bg-foreground text-base font-semibold text-background shadow-[0_25px_60px_-30px_rgba(15,23,42,0.75)] transition-transform duration-200 hover:translate-y-[-2px] hover:bg-foreground/90 active:scale-[0.97] dark:bg-white dark:text-black dark:hover:bg-white/90"
                      disabled={loading}
                      aria-label={loading ? "Processing" : isSignUp ? "Create account" : "Sign in"}
                    >
                      {loading ? "Processing..." : isSignUp ? "Create Account" : "Sign In"}
                    </Button>
                  </form>

                  <div className="flex flex-col gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setIsSignUp((prev) => !prev);
                        setPassword("");
                      }}
                      className="text-sm font-semibold text-foreground/70 transition hover:text-foreground dark:text-white/70 dark:hover:text-white"
                      aria-label={isSignUp ? "Switch to sign in" : "Switch to sign up"}
                    >
                      {isSignUp ? "Already have an account? Sign in" : "New here? Create an account"}
                    </button>
                    <button
                      type="button"
                      onClick={goBack}
                      className="text-sm font-medium text-foreground/60 underline-offset-4 transition hover:text-foreground hover:underline dark:text-white/60 dark:hover:text-white"
                      aria-label="Return to options"
                    >
                      Back
                    </button>
                  </div>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default Auth;
