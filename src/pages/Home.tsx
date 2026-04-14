import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { fetchWithTimeout } from "@/lib/fetchWithTimeout";
import { enrichPostsWithSharedWorkouts } from "@/lib/sharedWorkout";
import { runWithSupabaseTimeout } from "@/lib/supabaseTimeout";
import { PROFILE_SELECT_STRINGS } from "@/lib/profileFields";
import { shouldUseOfflineMode } from "@/lib/network";
import { getDB } from "@/lib/db/indexedDB";
import { Search, Users, Clock, Bell, Dumbbell } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import PostCard from "@/components/PostCard";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { z } from "zod";
import { WorkoutTimer } from "@/components/WorkoutTimer";
import {
  startLiveActivity,
  stopLiveActivity,
  setLiveActivitiesMetadata,
  setLiveActivitiesWorkoutId,
} from "@/lib/liveActivity";
import { NotificationsDialog } from "@/components/NotificationsDialog";
import { Badge } from "@/components/ui/badge";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RefreshCw } from "lucide-react";
import { LiquidGlassHeader } from "@/components/LiquidGlassHeader";
import { LiquidGlassTabs } from "@/components/LiquidGlassTabs";

const searchSchema = z.string().trim().max(100, "Search query too long").regex(/^[a-zA-Z0-9\s]*$/, "Only letters, numbers, and spaces allowed");

const SUPPRESSED_STORAGE_KEY = "weightstone:suppressed-active-workouts";
const SUPPRESS_TTL_MS = 10 * 60 * 1000;
const PULL_TO_REFRESH_THRESHOLD = 150;
const PULL_TO_REFRESH_MAX_DISTANCE = 240;
const PULL_DEAD_ZONE = 30;
const PULL_DAMPING = 0.45;

interface Post {
  id: string;
  user_id: string;
  workout_id: string;
  title: string;
  caption: string | null;
  created_at: string;
  show_workout_details: boolean;
   is_private: boolean;
}
type FollowStatus = "none" | "pending" | "accepted";

const Home = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const [user, setUser] = useState<any>(null);
  const [profile, setProfile] = useState<any>(null);
  const [followingPosts, setFollowingPosts] = useState<Post[]>([]);
  const [forYouPosts, setForYouPosts] = useState<Post[]>([]);
  const [activeTab, setActiveTab] = useState<"following" | "forYou">("following");
  const [loading, setLoading] = useState(true);
  // PERFORMANCE: Infinite scroll state
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreFollowing, setHasMoreFollowing] = useState(true);
  const [hasMoreForYou, setHasMoreForYou] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchPerformed, setSearchPerformed] = useState(false);
  const [followingMap, setFollowingMap] = useState<Map<string, FollowStatus>>(new Map());
  const [activeWorkout, setActiveWorkout] = useState<any>(null);
  const cancelledWorkoutIdsRef = useRef<Map<string, number>>(new Map());
  const pendingCancelledWorkoutRef = useRef<any>(null);
  const activeWorkoutRef = useRef<any>(null);
  const [activeWorkoutExerciseCount, setActiveWorkoutExerciseCount] = useState<number>(0);
  const activeWorkoutMetadataLoggedRef = useRef(false);
  const loadUserAndFeedRef = useRef<(() => Promise<void>) | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const lastTouchYRef = useRef<number | null>(null);
  const isHandlingPullRef = useRef(false);
  const refreshTimeoutRef = useRef<number | null>(null);

  const persistSuppressed = () => {
    if (typeof window === "undefined") return;
    try {
      const entries = Array.from(cancelledWorkoutIdsRef.current.entries());
      sessionStorage.setItem(SUPPRESSED_STORAGE_KEY, JSON.stringify(entries));
    } catch (error) {
      console.warn("Failed to persist suppressed workout ids", error);
    }
  };

  const pruneSuppressed = () => {
    const now = Date.now();
    let changed = false;
    cancelledWorkoutIdsRef.current.forEach((expiry, key) => {
      if (expiry <= now) {
        cancelledWorkoutIdsRef.current.delete(key);
        changed = true;
      }
    });
    if (changed) persistSuppressed();
  };

  const addSuppressedId = (id: string) => {
    if (!id) return;
    pruneSuppressed();
    cancelledWorkoutIdsRef.current.set(id, Date.now() + SUPPRESS_TTL_MS);
    persistSuppressed();
  };

  const removeSuppressedId = (id: string) => {
    if (!id) return;
    if (cancelledWorkoutIdsRef.current.delete(id)) {
      persistSuppressed();
    }
  };
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [focusedComment, setFocusedComment] = useState<{ postId: string; commentId: string } | null>(null);
  const postRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const scrollPositionsRef = useRef<{ following: number; forYou: number }>({
    following: 0,
    forYou: 0,
  });
  const mainContainerRef = useRef<HTMLDivElement | null>(null);
  // PERFORMANCE: Store posts in refs to avoid recreating loadMorePosts callback
  const followingPostsRef = useRef<Post[]>([]);
  const forYouPostsRef = useRef<Post[]>([]);
  const acceptedFollowingIdsRef = useRef<string[]>([]);
  const profileRetryCountRef = useRef<number>(0);
  // Helper to trigger haptic feedback on native platforms
  const triggerHaptic = () => {
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {
        console.log('Haptic feedback not available');
      });
    }
  };

  const handleFeedTabChange = useCallback(
    (tab: "following" | "forYou") => {
      if (tab === activeTab) return;
      triggerHaptic();
      if (mainContainerRef.current) {
        scrollPositionsRef.current[activeTab] = mainContainerRef.current.scrollTop;
      }
      setActiveTab(tab);
    },
    [activeTab]
  );
  const [pullState, setPullState] = useState<{
    isPulling: boolean;
    pullDistance: number;
    visualDistance: number;
    isRefreshing: boolean;
  }>({
    isPulling: false,
    pullDistance: 0,
    visualDistance: 0,
    isRefreshing: false,
  });

  useEffect(() => {
    activeWorkoutRef.current = activeWorkout;
  }, [activeWorkout]);

  // PERFORMANCE: Keep refs in sync with state
  useEffect(() => {
    followingPostsRef.current = followingPosts;
  }, [followingPosts]);

  useEffect(() => {
    forYouPostsRef.current = forYouPosts;
  }, [forYouPosts]);

  useEffect(() => {
    console.log('🔵 Home useEffect [activeWorkout?.id] exercise count fired', activeWorkout?.id);
    if (!activeWorkout?.id) {
      setActiveWorkoutExerciseCount(0);
      return;
    }

    let isCancelled = false;
    const loadExerciseCount = async () => {
      try {
        const { count, error } = await supabase
          .from('workout_exercises')
          .select('id', { count: 'exact', head: true })
          .eq('workout_id', activeWorkout.id);
        if (error) throw error;
        if (!isCancelled) {
          console.log('🔵 Loaded active workout exercise count:', count ?? 0);
          setActiveWorkoutExerciseCount(count ?? 0);
        }
      } catch (error) {
        console.error('Failed to load active workout exercise count', error);
        if (!isCancelled) {
          console.log('🔵 Failed to load count, defaulting to 0');
          setActiveWorkoutExerciseCount(0);
        }
      }
    };

    void loadExerciseCount();
    return () => {
      isCancelled = true;
    };
  }, [activeWorkout?.id]);

  useEffect(() => {
    console.log('🔵 Home useEffect [activeWorkout] fired', activeWorkout, 'exerciseCount:', activeWorkoutExerciseCount);
    if (!activeWorkout) {
      setLiveActivitiesWorkoutId(null);
      setLiveActivitiesMetadata(null);
      void stopLiveActivity();
      setActiveWorkoutExerciseCount(0);
      return;
    }

    const metadata = {
      id: String(activeWorkout.id),
      name: typeof activeWorkout.name === 'string' && activeWorkout.name.trim() !== ''
        ? activeWorkout.name
        : 'Workout',
      exerciseCount: activeWorkoutExerciseCount ?? 0,
    };
    console.log('🔵 Derived metadata for Live Activity:', metadata);

    const startDateIso = typeof activeWorkout.started_at === 'string' ? activeWorkout.started_at : null;
    setLiveActivitiesWorkoutId(metadata.id);
    setLiveActivitiesMetadata(metadata);

    if (!startDateIso) {
      console.log('🔵 Active workout missing start date, skipping Live Activity start');
      return;
    }

    void startLiveActivity(metadata, startDateIso);
    console.log('🔵 Calling LiveActivities.start from Home', metadata, startDateIso);
    void startLiveActivity(metadata, startDateIso);
  }, [activeWorkout, activeWorkoutExerciseCount]);

  useEffect(() => {
    const container = mainContainerRef.current;
    if (!container) return;
    const target = scrollPositionsRef.current[activeTab] ?? 0;
    requestAnimationFrame(() => {
      container.scrollTop = target;
    });
  }, [activeTab]);

  useEffect(() => {
    const handlePostDeleted = (event: Event) => {
      const custom = event as CustomEvent<{ postId?: string }>;
      const postId = custom.detail?.postId;
      if (!postId) return;
      setFollowingPosts((prev) => prev.filter((post) => post.id !== postId));
      setForYouPosts((prev) => prev.filter((post) => post.id !== postId));
    };

    window.addEventListener("post:deleted", handlePostDeleted);
    return () => {
      window.removeEventListener("post:deleted", handlePostDeleted);
    };
  }, []);

  useEffect(() => {
    const refreshFeed = () => {
      loadUserAndFeedRef.current?.();
    };

    window.addEventListener("post:deleted:confirmed", refreshFeed);
    window.addEventListener("post:delete:failed", refreshFeed);
    return () => {
      window.removeEventListener("post:deleted:confirmed", refreshFeed);
      window.removeEventListener("post:delete:failed", refreshFeed);
    };
  }, []);

  useEffect(() => {
    const handlePrivacyChanged = (event: Event) => {
      const custom = event as CustomEvent<{ postId?: string; isPrivate?: boolean }>;
      const postId = custom.detail?.postId;
      if (!postId || typeof custom.detail?.isPrivate !== "boolean") return;
      const applyPrivacy = (list: Post[]) =>
        list.map((post) =>
          post.id === postId ? { ...post, is_private: custom.detail!.isPrivate } : post
        );
      setFollowingPosts(applyPrivacy);
      setForYouPosts(applyPrivacy);
    };

    window.addEventListener("post:privacy-changed", handlePrivacyChanged);
    return () => {
      window.removeEventListener("post:privacy-changed", handlePrivacyChanged);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = sessionStorage.getItem(SUPPRESSED_STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const hydrated = new Map<string, number>();
          const now = Date.now();
          for (const entry of parsed) {
            if (Array.isArray(entry) && typeof entry[0] === "string" && typeof entry[1] === "number") {
              if (entry[1] > now) {
                hydrated.set(entry[0], entry[1]);
              }
            }
          }
          cancelledWorkoutIdsRef.current = hydrated;
          persistSuppressed();
        }
      }
    } catch (error) {
      console.warn("Failed to hydrate suppressed workout ids", error);
    }
    pruneSuppressed();
  }, []);

  useEffect(() => {
    loadUserAndFeedRef.current = loadUserAndFeed;
  });

  useEffect(() => {
    const handlePrUpdated = (event: Event) => {
      const custom = event as CustomEvent<{ userId?: string; summary?: unknown }>;
      if (!custom.detail?.userId || !user?.id) return;
      if (custom.detail.userId !== user.id) return;

      setProfile((prev: any) =>
        prev
          ? {
              ...prev,
              pr_summary: custom.detail.summary ?? {},
            }
          : prev
      );
    };

    window.addEventListener("pr:updated", handlePrUpdated);
    return () => {
      window.removeEventListener("pr:updated", handlePrUpdated);
    };
  }, [user?.id]);

  useEffect(() => {
    if (import.meta.env.DEV) console.log('Home mounted: initial load');
    loadUserAndFeed();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (import.meta.env.DEV) console.log('Home auth state change:', event);

        // Handle sign out - redirect to auth page
        if (event === "SIGNED_OUT") {
          if (import.meta.env.DEV) console.log('User signed out, redirecting to auth');
          navigate("/auth");
          return;
        }

        // Handle successful sign in - reload feed to get user data
        if (event === "SIGNED_IN" && session?.user) {
          if (import.meta.env.DEV) console.log('User signed in, reloading feed');
          loadUserAndFeed();
          return;
        }

        // Ignore other events like TOKEN_REFRESHED, USER_UPDATED, etc.
        // These are normal background operations that shouldn't affect the UI or reload data
      }
    );

    return () => subscription.unsubscribe();
  }, []); // Empty dependency array - only run once on mount

  // Reload active workout when navigating back from workout page
  useEffect(() => {
    const handleWorkoutNavigatedBack = async () => {
      console.log('🔴 Workout navigated back event received');

      if (!user?.id) {
        console.log('🔴 No user, skipping reload');
        return;
      }

      console.log('🔴 Reloading active workout for user:', user.id);

      try {
        pruneSuppressed();
        const { data: activeWorkoutData, error } = await runWithSupabaseTimeout(
          supabase
            .from("workouts")
            .select("id, user_id, started_at, created_at")
            .eq("user_id", user.id)
            .is("ended_at", null)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle(),
          3000
        );

        if (error) {
          console.error('🔴 Error loading active workout:', error);
          return;
        }

        console.log('🔴 Active workout data:', activeWorkoutData);

        if (activeWorkoutData) {
          // Remove from suppression list since user is navigating back (not terminating)
          removeSuppressedId(String(activeWorkoutData.id));
          console.log('🔴 Setting active workout:', activeWorkoutData);
          setActiveWorkout(activeWorkoutData);
        } else {
          console.log('🔴 Clearing active workout (not found)');
          setActiveWorkout(null);
        }
      } catch (error) {
        console.error('🔴 Failed to reload active workout:', error);
      }
    };

    console.log('🔴 Setting up workout:navigated-back listener');
    window.addEventListener("workout:navigated-back", handleWorkoutNavigatedBack);

    return () => {
      console.log('🔴 Removing workout:navigated-back listener');
      window.removeEventListener("workout:navigated-back", handleWorkoutNavigatedBack);
    };
  }, [user?.id]);

  useEffect(() => {
    const handleWorkoutCancelled = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const cancelledId = detail?.workoutId;
      const key = cancelledId ? String(cancelledId) : "";
      if (import.meta.env.DEV) console.log("Workout cancelled event received");
      if (key) {
        pendingCancelledWorkoutRef.current = null;
        const current = activeWorkoutRef.current;
        if (current && String(current.id) === key) {
          pendingCancelledWorkoutRef.current = current;
        }
        addSuppressedId(key);
        setActiveWorkout((prev) => (prev && String(prev.id) === key ? null : prev));
      }
    };

    window.addEventListener("workout:cancelled", handleWorkoutCancelled);
    return () => {
      window.removeEventListener("workout:cancelled", handleWorkoutCancelled);
    };
  }, []);

  useEffect(() => {
    const handleSuccess = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const id = detail?.workoutId ? String(detail.workoutId) : "";
      if (id) {
        // Keep this workout suppressed so it doesn't reappear after a successful cancellation
        addSuppressedId(id);
      }
      pendingCancelledWorkoutRef.current = null;
      pruneSuppressed();
      loadUserAndFeedRef.current?.();
    };

    const handleFailed = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      const id = detail?.workoutId ? String(detail.workoutId) : "";
      if (id) {
        removeSuppressedId(id);
      }
      const pending = pendingCancelledWorkoutRef.current;
      if (pending && id && String(pending.id) === id) {
        setActiveWorkout(pending);
      }
      pendingCancelledWorkoutRef.current = null;
      pruneSuppressed();
      loadUserAndFeedRef.current?.();
    };

    window.addEventListener("workout:cancelled:success", handleSuccess);
    window.addEventListener("workout:cancelled:failed", handleFailed);

    return () => {
      window.removeEventListener("workout:cancelled:success", handleSuccess);
      window.removeEventListener("workout:cancelled:failed", handleFailed);
    };
  }, [toast]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      if (
        (isMac && event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r") ||
        (!isMac && event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "r")
      ) {
        event.preventDefault();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search ?? "");
    const targetPostId = params.get("postId");
    if (!targetPostId) return;

    const isInFollowing = followingPosts.some((post) => post.id === targetPostId);
    const isInForYou = forYouPosts.some((post) => post.id === targetPostId);

    if (!isInFollowing && !isInForYou) return;

    const desiredTab: "following" | "forYou" = isInFollowing ? "following" : "forYou";

    if (desiredTab !== activeTab) {
      handleFeedTabChange(desiredTab);
      return;
    }

    const target = postRefs.current[targetPostId];
    if (!target) return;

    const targetCommentId = params.get("commentId") || null;

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (targetCommentId) {
      setFocusedComment({ postId: targetPostId, commentId: targetCommentId });
    } else {
      setFocusedComment(null);
    }
    const clearQuery = window.setTimeout(() => {
      navigate("/", { replace: true });
    }, 600);
    return () => {
      window.clearTimeout(clearQuery);
    };
  }, [
    location.search,
    followingPosts,
    forYouPosts,
    activeTab,
    handleFeedTabChange,
    navigate,
  ]);

  useEffect(() => {
    if (user) {
      loadUnreadCount();
      
      // Set up realtime subscription for notifications
      const channel = supabase
        .channel("notifications-changes")
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          () => {
            loadUnreadCount();
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }
  }, [user]);

  useEffect(() => {
    if (!showSearch) {
      setSearchQuery("");
      setSearchResults([]);
      setSearchPerformed(false);
      setSearchLoading(false);
    }
  }, [showSearch]);

  const loadUserAndFeed = async () => {
    // Global timeout to ensure loading screen never hangs indefinitely
    const GLOBAL_TIMEOUT_MS = 8000;
    let globalTimeoutId: ReturnType<typeof setTimeout> | undefined;

    const globalTimeoutPromise = new Promise<'timeout'>((resolve) => {
      globalTimeoutId = setTimeout(() => {
        console.warn('Global feed load timeout reached');
        resolve('timeout');
      }, GLOBAL_TIMEOUT_MS);
    });

    const loadLogic = async () => {
      try {
        if (import.meta.env.DEV) console.log('Loading user and feed');

        // Check if we're in post-OAuth flow - session might not be ready yet
        const justSignedIn = localStorage.getItem('auth:just-signed-in');
        const isPostOAuthFlow = justSignedIn && (Date.now() - parseInt(justSignedIn, 10)) < 300000; // 5 minutes - extended for slow connections

        if (isPostOAuthFlow) {
          console.log('[Home] Post-OAuth flow detected, waiting for session to stabilize...');
          // Wait for Supabase SDK to load session from localStorage
          await new Promise(r => setTimeout(r, 500));
        }

        let session = await getSupabaseSession({ throwOnError: false, timeoutMs: 10000 });

        // If no session in post-OAuth flow, retry a few times
        if (!session && isPostOAuthFlow) {
          console.log('[Home] No session in post-OAuth flow, retrying...');
          for (let i = 0; i < 8; i++) {
            await new Promise(r => setTimeout(r, 800)); // Increased wait time for iOS
            // Use raw Supabase getSession to bypass offline mode checks
            const { data } = await supabase.auth.getSession();
            if (data?.session) {
              session = data.session;
              console.log('[Home] Session found on retry', i + 1);
              break;
            }
            console.log(`[Home] Session retry ${i + 1}/8 - not ready yet`);
          }
        }

        // Clear the post-OAuth flag once session is acquired to prevent unnecessary delays on refresh
        if (session && isPostOAuthFlow) {
          localStorage.removeItem('auth:just-signed-in');
        }

        const user = session?.user;
        const accessToken = session?.access_token;

        if (import.meta.env.DEV) console.log('Session available:', !!session);

        if (!user || !accessToken) {
          // Final check - if we're in post-OAuth flow and still no session, something is wrong
          // but don't redirect immediately, let MainRoutes handle it
          if (isPostOAuthFlow) {
            console.warn('[Home] No session after OAuth retries, but not redirecting (let MainRoutes handle)');
            return;
          }
          if (import.meta.env.DEV) console.log('No active session, redirecting');
          navigate("/auth");
          return;
        }

        if (import.meta.env.DEV) console.log('User loaded');
        setUser(user);

        // Fetch the list of accounts the current user follows so we can scope the feed
        let followingIds: string[] = [];
        try {
          const { data: followingData, error: followingError } = await runWithSupabaseTimeout(
            supabase
              .from("follows")
              .select("following_id")
              .eq("follower_id", user.id)
              .eq("status", "accepted"),
            5000
          );

          if (followingError) throw followingError;
          followingIds = (followingData ?? []).map((row: any) => row.following_id);
          acceptedFollowingIdsRef.current = followingIds;
        } catch (error) {
          console.error("Failed to load following list:", error);
          acceptedFollowingIdsRef.current = [];
        }

        // Load profile with direct REST API call (max 2 attempts with 5s timeout each)
        if (import.meta.env.DEV) console.log('Loading profile via REST API');
        try {
          const supabaseUrl = getSupabaseUrl();
          const apiKey = getSupabaseAnonKey();
          let profileData: any | null = null;
          const MAX_PROFILE_ATTEMPTS = 2;

          for (let i = 0; i < MAX_PROFILE_ATTEMPTS && i < PROFILE_SELECT_STRINGS.length; i++) {
            const selectString = PROFILE_SELECT_STRINGS[i];
            try {
              const response = await fetchWithTimeout(
                `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=${selectString}`,
                {
                  method: 'GET',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${accessToken}`,
                    'apikey': apiKey
                  },
                  timeoutMs: 5000,
                }
              );

              if (import.meta.env.DEV) console.log('Profile API response:', response.status);

              if (response.ok) {
                const profiles = await response.json();
                const candidate = profiles[0];
                if (candidate) {
                  profileData = candidate;
                  break;
                }
              }
            } catch (attemptError) {
              console.warn(`Profile fetch attempt ${i + 1} failed:`, attemptError);
              if (i === MAX_PROFILE_ATTEMPTS - 1) throw attemptError;
            }
          }

          if (profileData) {
            if (import.meta.env.DEV) console.log('Home profile loaded');
            profileRetryCountRef.current = 0;
            setProfile(profileData);

            // Check if user needs to complete onboarding
            if (profileData.onboarding_completed === false) {
              console.log('[Home] User has not completed onboarding, redirecting');
              navigate("/onboarding", { replace: true });
              return;
            }
          } else {
            if (import.meta.env.DEV) console.warn('Home profile load attempts failed');
            profileRetryCountRef.current += 1;

            // Give the profile insert trigger a moment to finish right after signup
            if (profileRetryCountRef.current <= 3) {
              setTimeout(() => loadUserAndFeedRef.current?.(), 300);
              return;
            }
            // Continue without profile - will retry
          }
        } catch (error) {
          console.error('Profile load failed:', error);
          // Continue without profile - will retry on next load
        }

        // Load active workout and posts in parallel (non-blocking)
        const [workoutResult, postsResult] = await Promise.allSettled([
          // Active workout lookup
          (async () => {
            try {
              if (import.meta.env.DEV) console.log('Loading active workout...');
              pruneSuppressed();

              const isOffline = shouldUseOfflineMode();

              // OFFLINE MODE: Check IndexedDB for active workouts
              if (isOffline) {
                if (import.meta.env.DEV) console.log('[Home] Offline mode: checking IndexedDB for active workouts');
                try {
                  const db = await getDB();

                  // SAFETY: Check if workouts store exists before querying (prevents errors on first login)
                  if (!db.objectStoreNames.contains('workouts')) {
                    if (import.meta.env.DEV) console.log('[Home] Workouts store not initialized yet, skipping offline check');
                    return null;
                  }

                  const allWorkouts = await db.getAll('workouts');

                  // Find workouts for this user that haven't ended and aren't deleted
                  const activeWorkouts = allWorkouts.filter(
                    (w) => w.userId === user.id && !w.data.endedAt && !w.deleted
                  );

                  if (activeWorkouts.length > 0) {
                    // Sort by creation time (most recent first)
                    activeWorkouts.sort((a, b) =>
                      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    );

                    const activeWorkout = activeWorkouts[0];

                    // Check if this workout is in the suppression list
                    if (cancelledWorkoutIdsRef.current.has(String(activeWorkout.id))) {
                      if (import.meta.env.DEV) console.log('[Home] Ignoring suppressed offline workout');
                      return null;
                    }

                    if (import.meta.env.DEV) console.log('[Home] Found active workout in IndexedDB:', activeWorkout.id);

                    // Map IndexedDB format to match Supabase format
                    return {
                      id: activeWorkout.id,
                      user_id: activeWorkout.userId,
                      started_at: activeWorkout.data.startedAt || activeWorkout.data.workoutStartedAt,
                      created_at: activeWorkout.createdAt
                    };
                  }

                  if (import.meta.env.DEV) console.log('[Home] No active workouts in IndexedDB');
                  return null;
                } catch (error) {
                  console.error('[Home] Failed to check IndexedDB for active workouts:', error);
                  return null;
                }
              }

              // ONLINE MODE: Query Supabase for active workouts
              const { data: allActiveWorkouts } = await runWithSupabaseTimeout(
                supabase
                  .from("workouts")
                  .select("id, user_id, started_at, created_at")
                  .eq("user_id", user.id)
                  .is("ended_at", null)
                  .order("created_at", { ascending: false }),
                3000
              );

              // Filter out workouts that have posts
              let activeWorkoutData = null;
              if (allActiveWorkouts && allActiveWorkouts.length > 0) {
                for (const workout of allActiveWorkouts) {
                  try {
                    const { data: postCheck, error: postError } = await supabase
                      .from("posts")
                      .select("id")
                      .eq("workout_id", workout.id)
                      .maybeSingle();

                    if (postError) {
                      console.error('[Home] Error checking for post:', postError);
                      continue; // Skip this workout and check the next one
                    }

                    if (!postCheck) {
                      // This workout has no post, it's a valid active workout
                      activeWorkoutData = workout;
                      break;
                    }
                  } catch (error) {
                    console.error('[Home] Exception checking for post:', error);
                    continue; // Skip and try next workout
                  }
                }
              }

              if (import.meta.env.DEV) console.log('Active workout lookup complete');
              if (activeWorkoutData && cancelledWorkoutIdsRef.current.has(String(activeWorkoutData.id))) {
                if (import.meta.env.DEV) console.log('Ignoring recently cancelled workout');
                return null;
              }
              return activeWorkoutData;
            } catch (error) {
              console.error('Workout load failed:', error);
              return null;
            }
          })(),

          // Posts for feeds
          (async () => {
            try {
              if (import.meta.env.DEV) console.log('Loading posts for feeds...');
              const supabaseUrl = getSupabaseUrl();
              const apiKey = getSupabaseAnonKey();

              const ensureSessionMetrics = async (postsList: Post[]): Promise<Post[]> => {
                if (postsList.length === 0) return postsList;

                const normalized = postsList.map((post) => {
                  if (Array.isArray(post.session_metrics)) {
                    return post;
                  }
                  if (post.session_metrics) {
                    return { ...post, session_metrics: [post.session_metrics] };
                  }
                  return { ...post, session_metrics: [] };
                });

                const missingWorkoutIds = normalized
                  .filter((post) => Array.isArray(post.session_metrics) && post.session_metrics.length === 0)
                  .map((post) => post.workout_id)
                  .filter((id): id is string => typeof id === "string" && id.length > 0);

                if (missingWorkoutIds.length === 0) {
                  return normalized;
                }

                const { data, error } = await supabase
                  .from("session_metrics" as any)
                  .select("workout_id,sleep,mood,preworkout,soreness_area")
                  .in("workout_id", missingWorkoutIds);

                if (error) {
                  console.error("Failed to fetch session metrics fallback:", error);
                  return normalized;
                }

                const metricsMap = new Map<string, any>();
                (data ?? []).forEach((row: any) => {
                  if (!row?.workout_id) return;
                  metricsMap.set(String(row.workout_id), {
                    workout_id: String(row.workout_id),
                    sleep: row.sleep ?? null,
                    mood: row.mood ?? null,
                    preworkout:
                      typeof row.preworkout === "boolean"
                        ? row.preworkout
                        : row.preworkout === null
                        ? null
                        : Boolean(row.preworkout),
                    soreness_area:
                      typeof row.soreness_area === "string" && row.soreness_area.trim().length > 0
                        ? row.soreness_area
                        : null,
                  });
                });

                return normalized.map((post) => {
                  const existing = Array.isArray(post.session_metrics)
                    ? post.session_metrics
                    : post.session_metrics
                    ? [post.session_metrics]
                    : [];
                  if (existing.length > 0) {
                    return { ...post, session_metrics: existing };
                  }
                  const fallback = post.workout_id
                    ? metricsMap.get(String(post.workout_id))
                    : null;
                  return {
                    ...post,
                    session_metrics: fallback ? [fallback] : [],
                  };
                });
              };

              const loadFollowingPosts = async (): Promise<Post[]> => {
                const visibleUserIds = Array.from(new Set([user.id, ...followingIds]));
                if (visibleUserIds.length === 0) {
                  return [];
                }

                // PERFORMANCE: Reduced from 50 → 15 posts for faster initial load
                // Infinite scroll will load more as user scrolls
                const { data, error } = await supabase
                  .from("posts")
                  .select(
                    "id, user_id, workout_id, title, caption, created_at, show_workout_details, is_private, image_urls"
                  )
                  .in("user_id", visibleUserIds)
                  .order("created_at", { ascending: false })
                  .limit(15);

                if (error) {
                  console.error("Failed to load user's posts:", error);
                  return [];
                }

                const postsArray = data ?? [];
                if (postsArray.length === 0) {
                  return [];
                }

                const authorIds = Array.from(new Set(postsArray.map((post: any) => post.user_id)));
                let authorMap = new Map<
                  string,
                  { username: string; avatar_url?: string | null; is_private?: boolean }
                >();

                if (authorIds.length > 0) {
                  const { data: profilesData, error: profilesError } = await supabase
                    .from("public_profiles")
                    .select("id, username, avatar_url, is_private")
                    .in("id", authorIds);

                  if (profilesError) {
                    console.error("Failed to load usernames for Following feed:", profilesError);
                  } else {
                    authorMap = new Map(
                      (profilesData ?? []).map((row: any) => [row.id, { username: row.username, avatar_url: row.avatar_url }])
                    );
                  }
                }

                let mapped = postsArray.map((post: any) => ({
                  ...post,
                  public_profiles: authorMap.get(post.user_id) || {
                    username: post.user_id === user.id
                      ? profile?.username || profile?.full_name || "You"
                      : "Unknown",
                    avatar_url: post.user_id === user.id ? profile?.avatar_url : null,
                  },
                }));

                try {
                  mapped = await enrichPostsWithSharedWorkouts(mapped, {
                    supabaseUrl,
                    accessToken,
                    apiKey,
                  });
                } catch (enrichError) {
                  console.error(
                    "Failed to enrich Following posts with workout details:",
                    enrichError
                  );
                }

                mapped = await ensureSessionMetrics(mapped);

                const finalFollowing = mapped.map((post: any) => ({
                  ...post,
                  is_private: Boolean(post.is_private),
                }));

                if (import.meta.env.DEV) {
                  console.log("[Home] Following feed resolved:", finalFollowing.length);
                }

                return finalFollowing;
              };

              const loadForYouPosts = async (): Promise<Post[]> => {
                // PERFORMANCE: Reduced from 50 → 15 posts for faster initial load
                // Infinite scroll will load more as user scrolls
                const { data, error } = await supabase
                  .from("posts")
                  .select(
                    "id, user_id, workout_id, title, caption, created_at, show_workout_details, is_private, image_urls"
                  )
                  .eq("is_private", false)
                  .order("created_at", { ascending: false })
                  .limit(15);

                if (error) {
                  console.error("Failed to load community posts:", error);
                  return [];
                }

                const postsArray = data ?? [];
                if (postsArray.length === 0) {
                  return [];
                }

                const authorIds = Array.from(new Set(postsArray.map((post: any) => post.user_id)));
                let authorMap = new Map<string, { username: string; avatar_url?: string | null }>();

                if (authorIds.length > 0) {
                  const { data: profilesData, error: profileError } = await supabase
                    .from("public_profiles")
                    .select("id, username, avatar_url, is_private")
                    .in("id", authorIds);

                  if (profileError) {
                    console.error("Failed to load usernames for For You feed:", profileError);
                  } else {
                    authorMap = new Map(
                      (profilesData ?? []).map((row: any) => [
                        row.id,
                        {
                          username: row.username,
                          avatar_url: row.avatar_url,
                          is_private: row.is_private,
                        },
                      ])
                    );
                  }
                }

                const visibleAuthors = new Set([user.id, ...followingIds]);
                const filteredPosts = postsArray.filter((post: any) => {
                  const author = authorMap.get(post.user_id);
                  const isPrivateAuthor = Boolean(author?.is_private);
                  if (!isPrivateAuthor) return true;
                  return visibleAuthors.has(post.user_id);
                });

                if (filteredPosts.length === 0) {
                  return [];
                }

                let mapped = filteredPosts.map((post: any) => ({
                  ...post,
                  public_profiles: authorMap.get(post.user_id) || { username: "Unknown" },
                }));

                try {
                  mapped = await enrichPostsWithSharedWorkouts(mapped, {
                    supabaseUrl,
                    accessToken,
                    apiKey,
                  });
                } catch (enrichError) {
                  console.error(
                    "Failed to enrich For You posts with workout details:",
                    enrichError
                  );
                }

                mapped = await ensureSessionMetrics(mapped);

                const finalForYou = mapped.map((post: any) => ({
                  ...post,
                  is_private: Boolean(post.is_private),
                }));

                if (import.meta.env.DEV) {
                  console.log("[Home] For You feed resolved:", finalForYou.length);
                }

                return finalForYou;
              };

              const [followingFeed, forYouFeed] = await Promise.all([
                loadFollowingPosts(),
                loadForYouPosts(),
              ]);

              return { followingFeed, forYouFeed };
            } catch (error) {
              console.error('Posts load failed:', error);
              return { followingFeed: [], forYouFeed: [] };
            }
          })()
        ]);

        // Apply results
        if (workoutResult.status === 'fulfilled') {
          setActiveWorkout(workoutResult.value);
        }

        if (postsResult.status === 'fulfilled') {
          setFollowingPosts(postsResult.value.followingFeed);
          setForYouPosts(postsResult.value.forYouFeed);
          // PERFORMANCE: Set hasMore based on if we got a full page (15 posts)
          setHasMoreFollowing(postsResult.value.followingFeed.length >= 15);
          setHasMoreForYou(postsResult.value.forYouFeed.length >= 15);

          // PERFORMANCE: Batch prefetch avatars for visible posts (runs in background)
          // This ensures avatars are cached before user scrolls, eliminating loading flicker
          import('@/lib/cache/avatarPrefetch').then(({ prefetchAvatarBatch }) => {
            const allPosts = [...postsResult.value.followingFeed, ...postsResult.value.forYouFeed];
            const avatarsToFetch = allPosts
              .filter((post: any) => post.public_profiles?.avatar_url)
              .slice(0, 10) // Limit to first 10 unique avatars
              .map((post: any) => ({
                url: post.public_profiles.avatar_url,
                cacheKey: post.user_id
              }));
            void prefetchAvatarBatch(avatarsToFetch, 3);
          });
        } else {
          setFollowingPosts([]);
          setForYouPosts([]);
          setHasMoreFollowing(false);
          setHasMoreForYou(false);
        }
      } catch (error: any) {
        console.error("Failed to load feed:", error);
        console.error("Error name:", error?.name);
        console.error("Error message:", error?.message);

        const message = typeof error?.message === "string" ? error.message.toLowerCase() : "";
        const isTimeout = error?.name === "TimeoutError" || message.includes("timeout");
        const isAbort = error?.name === "AbortError" || message.includes("abort");
        const isAuthIssue =
          error?.status === 401 ||
          error?.status === 403 ||
          message.includes("auth") ||
          message.includes("jwt");

        if (isTimeout || isAbort) {
          console.warn("Feed load timed out or was aborted");
          toast({
            title: "Connection timed out",
            description: "We couldn't reach the feed. Pull to refresh to try again.",
            variant: "destructive",
          });
          setFollowingPosts([]);
          setForYouPosts([]);
          return;
        }

        if (isAuthIssue) {
          if (import.meta.env.DEV) console.log("Auth issue detected, redirecting to login");
          navigate("/auth");
          return;
        } else {
          toast({
            title: "Failed to load feed",
            description: "Something went wrong while loading your feed. Pull to refresh to try again.",
            variant: "destructive",
          });
        }
      }
    };

    try {
      const result = await Promise.race([loadLogic(), globalTimeoutPromise]);

      if (result === 'timeout') {
        console.error('Feed load exceeded global timeout');
      }
    } finally {
      if (globalTimeoutId) clearTimeout(globalTimeoutId);
      if (import.meta.env.DEV) console.log('Setting loading to false');
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUserAndFeedRef.current = loadUserAndFeed;
  });

  const loadUnreadCount = async () => {
    try {
      if (!user) return;

      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false)
        .not("and(type.eq.follow_request,resolved.eq.true)");

      if (error) {
        console.error("Unread count query error:", error);
        setUnreadCount(0);
        return;
      }
      setUnreadCount(count || 0);
    } catch (error) {
      console.error("Failed to load unread count:", error);
      setUnreadCount(0);
    }
  };

  // PERFORMANCE: Load more posts for infinite scroll
  const loadMorePosts = useCallback(async () => {
    if (loadingMore || !user || !profile) return;

    // Determine which feed we're loading for
    const currentTab = activeTab;

    // Use refs to get current posts without adding them to dependencies
    const currentPosts = currentTab === "following" ? followingPostsRef.current : forYouPostsRef.current;
    const hasMore = currentTab === "following" ? hasMoreFollowing : hasMoreForYou;

    if (!hasMore || currentPosts.length === 0) return;

    try {
      setLoadingMore(true);

      // Get cursor from last post
      const lastPost = currentPosts[currentPosts.length - 1];
      const cursor = lastPost.created_at;

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();
      const session = await getSupabaseSession();
      const accessToken = session?.access_token;

      if (!accessToken) return;

      let newPosts: Post[] = [];

      if (activeTab === "following") {
        // Load following posts
        const followingIds = await (async () => {
          const { data } = await supabase
            .from("follows")
            .select("following_id")
            .eq("follower_id", user.id)
            .eq("status", "accepted");
          return (data || []).map((row: any) => row.following_id);
        })();

        const visibleUserIds = Array.from(new Set([user.id, ...followingIds]));

        const { data, error } = await supabase
          .from("posts")
          .select("id, user_id, workout_id, title, caption, created_at, show_workout_details, is_private, image_urls")
          .in("user_id", visibleUserIds)
          .lt("created_at", cursor)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) throw error;

        const postsArray = data ?? [];

        // Enrich with author data
        const authorIds = Array.from(new Set(postsArray.map((post: any) => post.user_id)));
        let authorMap = new Map<
          string,
          { username: string; avatar_url?: string | null; is_private?: boolean }
        >();

        if (authorIds.length > 0) {
          const { data: profilesData } = await supabase
            .from("public_profiles")
            .select("id, username, avatar_url, is_private")
            .in("id", authorIds);

          authorMap = new Map(
            (profilesData ?? []).map((row: any) => [
              row.id,
              { username: row.username, avatar_url: row.avatar_url, is_private: row.is_private },
            ])
          );
        }

        const visibleAuthors = new Set<string>([
          ...(user?.id ? [user.id] : []),
          ...acceptedFollowingIdsRef.current,
        ]);
        const filteredPosts = postsArray.filter((post: any) => {
          const author = authorMap.get(post.user_id);
          const isPrivateAuthor = Boolean(author?.is_private);
          if (!isPrivateAuthor) return true;
          return visibleAuthors.has(post.user_id);
        });

        if (filteredPosts.length === 0) {
          setHasMoreForYou(false);
          return;
        }

        let mapped = filteredPosts.map((post: any) => ({
          ...post,
          public_profiles: authorMap.get(post.user_id) || { username: "Unknown" },
          is_private: Boolean(post.is_private),
        }));

        // Enrich with workout details
        try {
          mapped = await enrichPostsWithSharedWorkouts(mapped, {
            supabaseUrl,
            accessToken,
            apiKey,
          });
        } catch (error) {
          console.error("Failed to enrich posts:", error);
        }

        newPosts = mapped;
        setFollowingPosts(prev => [...prev, ...newPosts]);
        setHasMoreFollowing(newPosts.length >= 10);
      } else {
        // Load For You posts
        const { data, error } = await supabase
          .from("posts")
          .select("id, user_id, workout_id, title, caption, created_at, show_workout_details, is_private, image_urls")
          .eq("is_private", false)
          .lt("created_at", cursor)
          .order("created_at", { ascending: false })
          .limit(10);

        if (error) throw error;

        const postsArray = data ?? [];

        // Enrich with author data
        const authorIds = Array.from(new Set(postsArray.map((post: any) => post.user_id)));
        let authorMap = new Map<string, { username: string; avatar_url?: string | null }>();

        if (authorIds.length > 0) {
          const { data: profilesData, error: profileError } = await supabase
            .from("public_profiles")
            .select("id, username, avatar_url, is_private")
            .in("id", authorIds);

          if (profileError) {
            console.error("Failed to load author profiles for For You feed:", profileError);
          }

          authorMap = new Map(
            (profilesData ?? []).map((row: any) => [row.id, { username: row.username, avatar_url: row.avatar_url, is_private: row.is_private }])
          );
        }

        // Filter out posts from private accounts unless user follows them
        const followingIds = acceptedFollowingIdsRef.current;
        const visibleAuthors = new Set<string>([
          ...(user?.id ? [user.id] : []),
          ...followingIds,
        ]);

        const filteredPosts = postsArray.filter((post: any) => {
          const author = authorMap.get(post.user_id);
          // If author data is missing, include the post (fail open for public access)
          if (!author) return true;
          // If is_private is explicitly true, only show if user follows them
          const isPrivateAuthor = author.is_private === true;
          if (!isPrivateAuthor) return true;
          return visibleAuthors.has(post.user_id);
        });

        if (filteredPosts.length === 0) {
          setHasMoreForYou(false);
          return;
        }

        let mapped = filteredPosts.map((post: any) => ({
          ...post,
          public_profiles: authorMap.get(post.user_id) || { username: "Unknown" },
          is_private: Boolean(post.is_private),
        }));

        // Enrich with workout details
        try {
          mapped = await enrichPostsWithSharedWorkouts(mapped, {
            supabaseUrl,
            accessToken,
            apiKey,
          });
        } catch (error) {
          console.error("Failed to enrich posts:", error);
        }

        newPosts = mapped;
        setForYouPosts(prev => [...prev, ...newPosts]);
        setHasMoreForYou(newPosts.length >= 10);
      }

      if (import.meta.env.DEV) {
        console.log(`[Home] Loaded ${newPosts.length} more posts for ${activeTab} feed`);
      }
    } catch (error) {
      console.error("Failed to load more posts:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, user, profile, activeTab, hasMoreFollowing, hasMoreForYou]);
  // Note: Using refs for posts to avoid recreating callback on every post change

  // PERFORMANCE: Infinite scroll - detect when user scrolls near bottom
  useEffect(() => {
    const container = mainContainerRef.current;
    if (!container || loading) return; // Don't attach listener during initial load

    const handleScroll = () => {
      // Guard against errors during initial load
      if (!user || !profile) return;

      const { scrollTop, scrollHeight, clientHeight} = container;
      // Trigger load when user is within 500px of bottom
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      // Only trigger if we have posts and user is scrolling down
      const currentPosts = activeTab === "following" ? followingPostsRef.current : forYouPostsRef.current;
      if (distanceFromBottom < 500 && !loadingMore && currentPosts && currentPosts.length > 0) {
        const hasMore = activeTab === "following" ? hasMoreFollowing : hasMoreForYou;
        if (hasMore) {
          loadMorePosts();
        }
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [activeTab, loading, loadingMore, hasMoreFollowing, hasMoreForYou, loadMorePosts, user, profile]);

  const handleSearch = async () => {
    if (!searchQuery.trim()) return;

    // Validate search input
    const validation = searchSchema.safeParse(searchQuery);
    if (!validation.success) {
      toast({
        title: "Invalid search",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    try {
      setSearchPerformed(true);
      setSearchLoading(true);
      setSearchResults([]);
      setFollowingMap(new Map<string, FollowStatus>());

      const { data, error } = await supabase
        .from("public_profiles" as any)
        .select("id, username, is_private, avatar_url")
        .ilike("username", `%${searchQuery}%`)
        .limit(10);

      if (error) throw error;
      
      const results = data || [];
      setSearchResults(results);

      // Check following status for each result
      if (results.length > 0) {
        const { data: followsData } = await supabase
          .from("follows")
          .select("following_id, status")
          .eq("follower_id", user.id)
          .in("following_id", results.map((r: any) => r.id));

        const newFollowingMap = new Map<string, FollowStatus>();
        followsData?.forEach((f: any) => {
          const status: FollowStatus =
            f.status === "pending" ? "pending" : f.status === "accepted" ? "accepted" : "none";
          newFollowingMap.set(f.following_id, status);
        });
        setFollowingMap(newFollowingMap);
      }
    } catch (error) {
      console.error("Search failed:", error);
      toast({
        title: "Search failed",
        description: "Please try again",
        variant: "destructive",
      });
    } finally {
      setSearchLoading(false);
    }
  };

  const handleFollow = async (target: { id: string; is_private?: boolean }) => {
    const targetId = target.id;
    const currentStatus = followingMap.get(targetId) ?? "none";
    try {
      if (currentStatus === "accepted" || currentStatus === "pending") {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", user.id)
          .eq("following_id", targetId);

        if (error) throw error;

        setFollowingMap((prev) => {
          const updated = new Map(prev);
          updated.set(targetId, "none");
          return updated;
        });

        toast({
          title: currentStatus === "accepted" ? "Unfollowed" : "Request canceled",
        });
      } else {
        const isTargetPrivate = Boolean(target.is_private);
        const nextStatus: FollowStatus = isTargetPrivate ? "pending" : "accepted";

        const { error } = await supabase
          .from("follows")
          .insert({
            follower_id: user.id,
            following_id: targetId,
            status: nextStatus,
          });

        if (error) throw error;

        setFollowingMap((prev) => {
          const updated = new Map(prev);
          updated.set(targetId, nextStatus);
          return updated;
        });

        toast({
          title: nextStatus === "accepted" ? "Following" : "Request sent",
          description:
            nextStatus === "pending" ? "You'll get a notification when it's accepted." : undefined,
        });
      }

      loadUserAndFeed();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to update follow status",
        variant: "destructive",
      });
    }
  };

  const handleViewProfile = (profileId: string) => {
    setShowSearch(false);
    navigate(`/user/${profileId}`);
  };

  const openNotifications = () => {
    // Open dialog immediately without transition
    setShowNotifications(true);
    // Defer unread count update to avoid blocking
    startTransition(() => {
      setUnreadCount(0);
    });
  };

  const refreshFeed = useCallback(async () => {
    if (pullState.isRefreshing) return;
    setPullState((prev) => ({
      ...prev,
      isPulling: false,
      pullDistance: 0,
      visualDistance: 0,
      isRefreshing: true,
    }));
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
    refreshTimeoutRef.current = window.setTimeout(() => {
      loadUserAndFeedRef.current?.();
    }, 100);
    await loadUserAndFeedRef.current?.();
    if (refreshTimeoutRef.current) {
      window.clearTimeout(refreshTimeoutRef.current);
      refreshTimeoutRef.current = null;
    }
    setPullState({
      isPulling: false,
      pullDistance: 0,
      visualDistance: 0,
      isRefreshing: false,
    });
  }, [pullState.isRefreshing]);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
    if (pullState.isRefreshing || !mainContainerRef.current) return;
    const scrollTop = mainContainerRef.current.scrollTop;
    if (scrollTop > 0) return;
    touchStartYRef.current = event.touches[0].clientY;
    lastTouchYRef.current = touchStartYRef.current;
    isHandlingPullRef.current = true;
    setPullState((prev) => ({ ...prev, isPulling: false, pullDistance: 0, visualDistance: 0 }));
  },
  [pullState.isRefreshing]
);

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isHandlingPullRef.current || touchStartYRef.current === null) return;
      if (mainContainerRef.current && mainContainerRef.current.scrollTop > 0) {
        isHandlingPullRef.current = false;
        setPullState((prev) => ({
          ...prev,
          isPulling: false,
          pullDistance: 0,
          visualDistance: 0,
        }));
        return;
      }

      const currentY = event.touches[0].clientY;
      lastTouchYRef.current = currentY;
      const delta = currentY - touchStartYRef.current;

      if (delta <= 0) {
        setPullState((prev) => ({
          ...prev,
          isPulling: false,
          pullDistance: 0,
          visualDistance: 0,
        }));
        return;
      }

      if (delta < PULL_DEAD_ZONE) {
        setPullState((prev) => ({
          ...prev,
          isPulling: false,
          pullDistance: 0,
          visualDistance: 0,
        }));
        return;
      }

      event.preventDefault();
      const effectivePull = delta - PULL_DEAD_ZONE;
      const dampened = Math.min(
        PULL_TO_REFRESH_MAX_DISTANCE - PULL_DEAD_ZONE,
        effectivePull * PULL_DAMPING
      );
      const visual = Math.max(0, dampened);

      setPullState((prev) => ({
        ...prev,
        isPulling: true,
        pullDistance: Math.min(PULL_TO_REFRESH_MAX_DISTANCE, delta),
        visualDistance: visual,
      }));
    },
    []
  );

  const handleTouchEnd = useCallback(async () => {
    if (!isHandlingPullRef.current) return;
    isHandlingPullRef.current = false;
    const shouldRefresh = pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD && !pullState.isRefreshing;
    if (shouldRefresh) {
      setPullState((prev) => ({
        ...prev,
        isPulling: false,
        pullDistance: 0,
        visualDistance: 0,
        isRefreshing: true,
      }));
      await refreshFeed();
    } else {
      setPullState((prev) => ({
        ...prev,
        isPulling: false,
        pullDistance: 0,
        visualDistance: 0,
      }));
    }
    touchStartYRef.current = null;
    lastTouchYRef.current = null;
  }, [pullState.pullDistance, pullState.isRefreshing, refreshFeed]);

  // OPTIMIZATION: Memoize visible posts calculation
  const visiblePosts = useMemo(
    () => (activeTab === "following" ? followingPosts : forYouPosts),
    [activeTab, followingPosts, forYouPosts]
  );

  // OPTIMIZATION: Memoize callbacks to prevent PostCard re-renders
  const handlePostDeleted = useCallback(() => {
    loadUserAndFeedRef.current?.();
  }, []);

  const handleCommentFocusHandled = useCallback((postId: string) => {
    setFocusedComment((prev) => (prev && prev.postId === postId ? null : prev));
  }, []);

  // OPTIMIZATION: Virtual scrolling for feed (only render visible posts)
  // PERFORMANCE: Dynamic size estimation based on post content
  const estimatePostSize = useCallback((index: number) => {
    const post = visiblePosts[index];
    if (!post) return 600; // Increased default to account for potential expansion

    let estimatedHeight = 250; // Increased base height (header + footer + interactions)

    // Add height for caption
    if (post.caption) {
      const lines = Math.ceil(post.caption.length / 50);
      estimatedHeight += Math.min(lines * 20, 100); // Max 100px for caption
    }

    // Add height for images
    if (post.image_urls && post.image_urls.length > 0) {
      estimatedHeight += 400; // Standard image height
    }

    // Add height for workout details with buffer for expansion
    if (post.show_workout_details && post.shared_workout_details) {
      const exerciseCount = Array.isArray(post.shared_workout_details)
        ? post.shared_workout_details.length
        : 0;
      // Increased to ~150px per exercise to account for expanded sets/details
      estimatedHeight += exerciseCount * 150;
    } else if (post.show_workout_details) {
      // Even if details not loaded yet, add buffer space
      estimatedHeight += 300;
    }

    // Add buffer for potential comment expansion (estimate ~50px per comment if any exist)
    estimatedHeight += 150; // Reserve space for comment section expansion

    return estimatedHeight;
  }, [visiblePosts]);

  const virtualizer = useVirtualizer({
    count: visiblePosts.length,
    getScrollElement: () => mainContainerRef.current,
    estimateSize: estimatePostSize,
    overscan: 1, // Reduced from 2 to 1 to render fewer off-screen items
    scrollMargin: mainContainerRef.current?.offsetTop ?? 0,
    measureElement:
      typeof window !== 'undefined' && navigator.userAgent.includes('Firefox')
        ? undefined
        : (el) => el?.getBoundingClientRect().height ?? 450,
  });

  if (loading) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading feed...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      {/* Header */}
      <LiquidGlassHeader className="justify-between">
        <div
          role="button"
          tabIndex={0}
          onClick={openNotifications}
          className="relative p-2 mt-2 rounded-full cursor-pointer active:opacity-70"
          title="Notifications"
        >
          <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 h-4 w-4 flex items-center justify-center rounded-full bg-red-500 text-white text-[10px] font-medium">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </div>
        <div className="text-center">
          <h1 className="text-[26px] sm:text-3xl font-bold text-gray-900 dark:text-gray-100">MinimaLog</h1>
          <p className="text-xs italic text-gray-400 dark:text-gray-500 mt-0.5">You Log, We Track</p>
        </div>
        <div
          role="button"
          tabIndex={0}
          onClick={() => setShowSearch(true)}
          className="p-2 mt-2 rounded-full cursor-pointer active:opacity-70"
          title="Find Friends"
        >
          <Search className="h-5 w-5 text-gray-600 dark:text-gray-400" />
        </div>
      </LiquidGlassHeader>

      {/* Feed - scrollable content */}
      <main
        ref={mainContainerRef}
        className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Active Workout Banner */}
        {activeWorkout && (
          <div className="px-4 mt-8 mb-4">
            <Card
              className="border-2 border-primary cursor-pointer hover:bg-muted/50 transition-colors max-w-2xl mx-auto"
              onClick={() => navigate(`/workout/${activeWorkout.id}`)}
            >
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center animate-pulse">
                      <Clock className="h-6 w-6 text-primary-foreground" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-lg">Workout in Progress</h3>
                      <p className="text-sm text-muted-foreground">Tap to continue</p>
                    </div>
                  </div>
                  <WorkoutTimer startedAt={activeWorkout.started_at} />
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Following / For You Tabs */}
        <div className={`px-4 mb-4 ${activeWorkout ? '' : 'mt-8'}`}>
          <LiquidGlassTabs
            tabs={[
              { id: "following", label: "Following" },
              { id: "forYou", label: "For You" },
            ]}
            activeTab={activeTab}
            onTabChange={handleFeedTabChange}
            className="w-full max-w-sm mx-auto"
          />
        </div>

        {/* Pull to refresh indicator */}
        <div
          className="sticky top-0 z-20 flex justify-center transition-all duration-150"
          style={{
            height: pullState.isRefreshing
              ? 60
              : pullState.isPulling
              ? Math.min(60, pullState.visualDistance * 0.4)
              : 0,
            opacity: pullState.isPulling || pullState.isRefreshing ? 1 : 0,
          }}
        >
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <RefreshCw
              className={`h-4 w-4 ${
                pullState.isRefreshing
                  ? "animate-spin"
                  : pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD
                  ? "text-primary"
                  : ""
              }`}
            />
            <span>
              {pullState.isRefreshing
                ? "Refreshing feed..."
                : pullState.pullDistance >= PULL_TO_REFRESH_THRESHOLD
                ? "Release to refresh"
                : "Pull to refresh"}
            </span>
          </div>
        </div>

        {/* Feed content */}
        <div
          className="container mx-auto px-4 py-2 max-w-2xl"
          style={{
            transform:
              pullState.isPulling && !pullState.isRefreshing
                ? `translateY(${Math.min(140, pullState.visualDistance)}px)`
                : undefined,
          }}
        >
          {/* Posts */}
          <div style={{ marginTop: '8px' }}>
        {visiblePosts.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <Users className="h-16 w-16 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold mb-2">
                {activeTab === "following" ? "No posts yet" : "Nothing here yet"}
              </h2>
              <p className="text-muted-foreground">
                {activeTab === "following"
                  ? "Follow friends to see their workouts here"
                  : "Check back soon for the latest workouts from the community"}
              </p>
            </div>
            {activeTab === "following" && (
              <Button onClick={() => setShowSearch(true)}>
                Find Friends
              </Button>
            )}
          </div>
        ) : (
          // OPTIMIZATION: Virtual scrolling - only render visible posts
          <div
            style={{
              height: `${virtualizer.getTotalSize() + (loadingMore ? 300 : 0)}px`,
              width: '100%',
              position: 'relative',
              paddingTop: 0,
            }}
          >
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const post = visiblePosts[virtualItem.index];
              return (
                <div
                  key={post.id}
                  data-index={virtualItem.index}
                  ref={(el) => {
                    if (el) {
                      virtualizer.measureElement(el);
                      postRefs.current[post.id] = el;
                    } else {
                      delete postRefs.current[post.id];
                    }
                  }}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualItem.start}px)`,
                    willChange: 'transform',
                  }}
                  className="rounded-lg"
                >
                  <PostCard
                    post={post}
                    currentUserId={user.id}
                    onPostDeleted={handlePostDeleted}
                    focusedCommentId={
                      focusedComment?.postId === post.id ? focusedComment.commentId : undefined
                    }
                    onCommentFocusHandled={() => handleCommentFocusHandled(post.id)}
                  />
                </div>
              );
            })}

            {/* PERFORMANCE: Infinite scroll loading indicator */}
            {loadingMore && visiblePosts.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: `${virtualizer.getTotalSize() + 150}px`,
                  left: 0,
                  width: '100%',
                }}
                className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground"
              >
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Loading more posts…</span>
              </div>
            )}
          </div>
        )}

        {/* End of feed indicator */}
        {!loadingMore && visiblePosts.length > 0 && !(activeTab === "following" ? hasMoreFollowing : hasMoreForYou) && (
          <div className="flex items-center justify-center py-6 text-xs uppercase tracking-wide text-muted-foreground">
            You've reached the end
          </div>
        )}
        </div>

        </div>
      </main>

      {/* Search Dialog */}
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent
          className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur overflow-hidden"
          showClose={false}
        >
          <DialogHeader>
            <DialogTitle>Find Friends</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 overflow-hidden">
            <div className="rounded-2xl bg-muted/30 p-2">
              <div className="flex items-center gap-2 bg-background rounded-xl px-3 py-2 shadow-inner overflow-hidden">
                <Search className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <Input
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => {
                    const value = e.target.value;
                    setSearchQuery(value);
                    if (!value.trim()) {
                      setSearchResults([]);
                      setSearchPerformed(false);
                    }
                  }}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1 min-w-0 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                />
                <Button
                  onClick={handleSearch}
                  size="sm"
                  className="flex-shrink-0"
                  disabled={searchLoading || !searchQuery.trim()}
                >
                  {searchLoading ? "Searching..." : "Search"}
                </Button>
              </div>
            </div>
            <ScrollArea className="max-h-[60vh] pr-4">
              {searchLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  Searching...
                </div>
              ) : searchResults.length === 0 ? (
                <div className="text-center py-10 text-muted-foreground space-y-3">
                  <Users className="h-12 w-12 mx-auto opacity-50" />
                  <p>
                    {searchPerformed
                      ? "No users found. Try another name."
                      : "Search for a username to connect."}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((result) => {
                    return (
                      <div
                        key={result.id}
                        onClick={() => handleViewProfile(result.id)}
                        className="flex items-center gap-3 rounded-2xl border border-primary/10 bg-background/70 p-3 hover:bg-muted/50 transition-colors cursor-pointer"
                      >
                        <Avatar className="h-12 w-12 flex-shrink-0">
                          {result.avatar_url && (
                            <AvatarImage
                              src={result.avatar_url}
                              alt={result.username || "User"}
                              loading="lazy"
                              cacheKey={result.id}
                            />
                          )}
                          <AvatarFallback className="text-base">
                            {result.username?.[0]?.toUpperCase() || "U"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-sm truncate">{result.username || "Unknown"}</p>
                          <p className="text-xs text-muted-foreground truncate">View profile</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>

      <NotificationsDialog
        open={showNotifications}
        onOpenChange={setShowNotifications}
        userId={user?.id || ""}
      />
    </div>
  );
};

export default Home;
