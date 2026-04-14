import { useState, useEffect, useLayoutEffect, useCallback, useRef, type UIEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { User, Settings, Trophy, Weight, Dumbbell, RefreshCw } from "lucide-react";
import { ProfileSettings } from "@/components/ProfileSettings";
import PostCard from "@/components/PostCard";
import PRCalculator from "@/components/PRCalculator";
import { format } from "date-fns";
import { enrichPostsWithSharedWorkouts } from "@/lib/sharedWorkout";
import { PROFILE_SELECT_STRINGS } from "@/lib/profileFields";
import { syncProfileFirstName } from "@/util/profile";
import { extractFirstName, extractEmailUsername } from "@/util/names";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { SyncStatusIndicator } from "@/components/SyncStatusIndicator";
import { LiquidGlassHeader } from "@/components/LiquidGlassHeader";
import { LiquidGlassTabs } from "@/components/LiquidGlassTabs";

type PrCategory = "squat" | "bench" | "deadlift";

interface PostDerivedPR {
  category: PrCategory;
  exerciseName: string;
  weight: number;
  unit: string;
  postedAt: string;
}

const createEmptyPrState = (): Record<PrCategory, PostDerivedPR | null> => ({
  squat: null,
  bench: null,
  deadlift: null,
});

const categorizeExercise = (name: string): PrCategory | null => {
  const lower = (name || "").toLowerCase();
  if (lower.includes("squat")) return "squat";
  if (lower.includes("bench")) return "bench";
  if (lower.includes("deadlift")) return "deadlift";
  return null;
};

const PR_CATEGORIES: ReadonlyArray<PrCategory> = ["squat", "bench", "deadlift"] as const;

const normalizeCandidateName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "user") return "";
  return trimmed;
};

const capitalizeUsername = (username: string | undefined | null): string => {
  if (!username) return "";
  return username.charAt(0).toUpperCase() + username.slice(1);
};

const FIRST_NAME_KEYS = [
  "first_name",
  "firstName",
  "given_name",
  "givenName",
  "name",
  "full_name",
  "fullName",
  "nickname",
  "preferred_username",
  "email",
] as const;

interface FirstNameDiscovery {
  value: string;
  path: string;
  rawValue: unknown;
}

const findFirstNameInSource = (
  source: unknown,
  contextPath = "root"
): FirstNameDiscovery | null => {
  if (!source || typeof source !== "object") {
    return null;
  }

  const record = source as Record<string, unknown>;

  for (const key of FIRST_NAME_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) continue;
    const value = record[key];
    const nextPath = `${contextPath}.${key}`;
    if (import.meta.env.DEV) console.log("findFirstNameInSource inspecting path:", nextPath);

    if (typeof value === "string") {
      const extracted = extractFirstName(value);
      if (extracted) {
        if (import.meta.env.DEV)
        if (import.meta.env.DEV)
          console.log("findFirstNameInSource extracted name:", { path: nextPath });
        return { value: extracted, path: nextPath, rawValue: value };
      }

      const emailCandidate = extractEmailUsername(value);
      if (emailCandidate) {
        if (import.meta.env.DEV)
        if (import.meta.env.DEV)
          console.log("findFirstNameInSource derived from email:", { path: nextPath });
        return { value: emailCandidate, path: `${nextPath} (email local-part)`, rawValue: value };
      }
    } else if (value && typeof value === "object") {
      const nested = findFirstNameInSource(value, nextPath);
      if (nested) {
        return nested;
      }
    }
  }

  if (import.meta.env.DEV)
  if (import.meta.env.DEV)
    console.log("findFirstNameInSource did not locate a name at path:", contextPath);
  return null;
};

const deriveFirstNameFromUser = (user: unknown): { name: string; path: string } | null => {
  if (!user || typeof user !== "object") {
    return null;
  }

  if (import.meta.env.DEV) console.log("deriveFirstNameFromUser evaluating user object");

  const metadata = (user as Record<string, unknown>).user_metadata;
  if (import.meta.env.DEV) console.log("deriveFirstNameFromUser user_metadata present:", Boolean(metadata));
  const metadataResult = findFirstNameInSource(metadata, "user_metadata");
  if (metadataResult) {
    if (import.meta.env.DEV) console.log("deriveFirstNameFromUser found name in metadata");
    return { name: metadataResult.value, path: metadataResult.path };
  }

  const identities = (user as Record<string, unknown>).identities;
  if (import.meta.env.DEV) console.log("deriveFirstNameFromUser identities present:", Array.isArray(identities));
  if (Array.isArray(identities)) {
    for (let index = 0; index < identities.length; index += 1) {
      const identity = identities[index];
      if (import.meta.env.DEV) console.log(`deriveFirstNameFromUser identity[${index}] found`);
      if (!identity || typeof identity !== "object") continue;
      const identityData = (identity as Record<string, unknown>).identity_data;
      if (import.meta.env.DEV) console.log(`deriveFirstNameFromUser identity[${index}].identity_data present:`);
      const identityResult = findFirstNameInSource(identityData, `identities[${index}].identity_data`);
      if (identityResult) {
        if (import.meta.env.DEV) console.log("deriveFirstNameFromUser found name in identity_data");
        return { name: identityResult.value, path: identityResult.path };
      }
    }
  }

  const appMetadata = (user as Record<string, unknown>).app_metadata;
  if (import.meta.env.DEV) console.log("deriveFirstNameFromUser app_metadata present:", Boolean(appMetadata));
  const appMetadataResult = findFirstNameInSource(appMetadata, "app_metadata");
  if (appMetadataResult) {
    if (import.meta.env.DEV) console.log("deriveFirstNameFromUser found name in app_metadata");
    return { name: appMetadataResult.value, path: appMetadataResult.path };
  }

  const email = (user as Record<string, unknown>).email;
  const emailFallback = typeof email === "string" ? extractEmailUsername(email) : "";
  if (emailFallback) {
    const path = "user.email (email local-part fallback)";
    if (import.meta.env.DEV) console.log("deriveFirstNameFromUser using email fallback");
    return { name: emailFallback, path };
  }

  if (import.meta.env.DEV) console.log("deriveFirstNameFromUser did not find a name in any source.");
  return null;
};

const convertSummaryToPrState = (
  summary: unknown
): Record<PrCategory, PostDerivedPR | null> => {
  const next = createEmptyPrState();
  if (!summary || typeof summary !== "object") {
    return next;
  }

  for (const category of PR_CATEGORIES) {
    const entry = (summary as Record<string, any>)[category];
    if (!entry || typeof entry !== "object") {
      next[category] = null;
      continue;
    }

    const weightValue = Number(entry.weight);
    if (!Number.isFinite(weightValue)) {
      next[category] = null;
      continue;
    }

    next[category] = {
      category,
      exerciseName: entry.exercise_name ?? "",
      weight: weightValue,
      unit: entry.unit === "lb" ? "lb" : "kg",
      postedAt: entry.achieved_at ?? new Date().toISOString(),
    };
  }

  return next;
};

const convertPrArrayToPrState = (
  prs: unknown
): Record<PrCategory, PostDerivedPR | null> => {
  const next = createEmptyPrState();
  if (!Array.isArray(prs)) {
    return next;
  }

  prs.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const typed = entry as Record<string, any>;
    const exerciseName = typed.exercise_name ?? typed.exerciseName ?? "";
    const category = categorizeExercise(exerciseName);
    if (!category) return;

    const weightValue = Number(typed.weight);
    if (!Number.isFinite(weightValue)) return;

    const current = next[category];
    if (!current || weightValue > current.weight) {
      next[category] = {
        category,
        exerciseName,
        weight: weightValue,
        unit: typed.unit === "lb" ? "lb" : "kg",
        postedAt: typed.achieved_at ?? new Date().toISOString(),
      };
    }
  });

  return next;
};

const PROFILE_PULL_THRESHOLD = 150;
const PROFILE_PULL_MAX_DISTANCE = 240;
const PROFILE_PULL_DEAD_ZONE = 30;
const PROFILE_PULL_DAMPING = 0.45;
const FOLLOW_PAGE_SIZE = 5;
const FOLLOW_LIST_ROW_HEIGHT = 64;
const FOLLOW_LIST_MAX_HEIGHT = FOLLOW_PAGE_SIZE * FOLLOW_LIST_ROW_HEIGHT;

const Profile = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pullState, setPullState] = useState<{
    pullDistance: number;
    visualDistance: number;
  }>({
    pullDistance: 0,
    visualDistance: 0,
  });
  const touchStartYRef = useRef<number | null>(null);
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const isPullingRef = useRef(false);
  const [profile, setProfile] = useState<any>(null);
  const [userEmail, setUserEmail] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [stats, setStats] = useState({
    followers: 0,
    following: 0,
    posts: 0,
  });
  const [posts, setPosts] = useState<any[]>([]);
  const [postPrs, setPostPrs] = useState<Record<PrCategory, PostDerivedPR | null>>(
    () => createEmptyPrState()
  );
  const [followersDialogOpen, setFollowersDialogOpen] = useState(false);
  const [followingDialogOpen, setFollowingDialogOpen] = useState(false);
  const [followersList, setFollowersList] = useState<any[]>([]);
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<"posts" | "prs">("posts");
  const followersPageRef = useRef(0);
  const followingPageRef = useRef(0);
  const [followersHasMore, setFollowersHasMore] = useState(true);
  const [followingHasMore, setFollowingHasMore] = useState(true);
  const [followersLoading, setFollowersLoading] = useState(false);
  const [followingLoading, setFollowingLoading] = useState(false);
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);

  const computePrsFromPosts = useCallback(async (userPosts: any[]) => {
    const emptyState = createEmptyPrState();
    const postsWithWorkouts = userPosts.filter(
      (post) => post.workout_id && post.show_workout_details
    );

    if (postsWithWorkouts.length === 0) {
      return emptyState;
    }

    const workoutIds = Array.from(
      new Set(postsWithWorkouts.map((post: any) => post.workout_id))
    );

    const { data, error } = await supabase
      .from("workout_exercises")
      .select(
        `workout_id,
         exercises!workout_exercises_exercise_id_fkey (name),
         sets (weight, unit, is_warmup)`
      )
      .in("workout_id", workoutIds);

    if (error) {
      console.error("Failed to derive PRs from posts:", error);
      return emptyState;
    }

    const postLookup = new Map(
      postsWithWorkouts.map((post: any) => [post.workout_id, post])
    );

    const nextPrs = createEmptyPrState();

    data?.forEach((entry: any) => {
      const exerciseName = entry.exercises?.name || "";
      const category = categorizeExercise(exerciseName);
      if (!category) return;

      const associatedPost = postLookup.get(entry.workout_id);
      if (!associatedPost) return;

      const workingSets = (entry.sets || []).filter((set: any) => !set.is_warmup);

      workingSets.forEach((set: any) => {
        const weightValue = Number(set.weight);
        if (!weightValue || Number.isNaN(weightValue)) return;

        const currentBest = nextPrs[category];
        if (!currentBest || weightValue > currentBest.weight) {
          nextPrs[category] = {
            category,
            exerciseName,
            weight: weightValue,
            unit: set.unit || "kg",
            postedAt: associatedPost.created_at,
          };
        }
      });
    });

    return nextPrs;
  }, []);

  const derivePrStateFromPayload = useCallback(
    (payload: { summary?: unknown; prs?: unknown }) => {
      const fromSummary = convertSummaryToPrState(payload?.summary);
      if (Object.values(fromSummary).some(Boolean)) {
        return fromSummary;
      }
      return convertPrArrayToPrState(payload?.prs);
    },
    []
  );

  const loadProfile = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      try {
        if (silent) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const session = await getSupabaseSession();
        const user = session?.user;
        const accessToken = session?.access_token;
        if (!user || !accessToken) {
          navigate("/auth");
          return;
        }

        setUserEmail(user.email || "");

        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();

        let profileData: any | null = null;
        let profileSelectUsed: string | null = null;
        const profileFetchAttempts: Array<{
          select: string;
          status: number;
          body?: string;
        }> = [];

        for (const selectString of PROFILE_SELECT_STRINGS) {
          const profileRes = await fetch(
            `${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=${selectString}`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: apiKey,
              },
            }
          );

          if (profileRes.ok) {
            const profiles = await profileRes.json();
            const candidate = profiles[0];
            if (candidate) {
              profileData = candidate;
              profileSelectUsed = selectString;
              break;
            }
            profileFetchAttempts.push({
              select: selectString,
              status: profileRes.status,
              body: "No rows returned",
            });
            continue;
          }

          const errorText = await profileRes.text().catch(() => "");
          profileFetchAttempts.push({
            select: selectString,
            status: profileRes.status,
            body: errorText,
          });
        }

        if (!profileData) {
          if (import.meta.env.DEV) console.warn("Profile load: all profile fetch attempts failed");
          throw new Error("Profile not found.");
        }
        if (import.meta.env.DEV) console.log("Profile load: profile select fields used:", profileSelectUsed);

        let effectiveProfile: Record<string, unknown> = {
          ...profileData,
        };

        if (typeof profileData?.full_name !== "string" && typeof profileData?.name === "string") {
          effectiveProfile.full_name = profileData.name;
        }
        if (typeof profileData?.name !== "string" && typeof profileData?.full_name === "string") {
          effectiveProfile.name = profileData.full_name;
        }

        if (profileData && typeof profileData === "object") {
          if (import.meta.env.DEV) console.log("Profile load: raw profile row present");
          try {
            if (import.meta.env.DEV) console.log("Profile load: raw profile row (JSON) available");
          } catch (jsonError) {
            if (import.meta.env.DEV) console.warn("Profile load: unable to stringify profile row");
          }

          const usernameValue = normalizeCandidateName(profileData.username);

          const storedName = (() => {
            const fullNameValue = normalizeCandidateName(profileData.full_name);
            if (fullNameValue) return fullNameValue;
            const nameValue = normalizeCandidateName(profileData.name);
            if (nameValue) return nameValue;
            return usernameValue;
          })();
          if (import.meta.env.DEV) console.log("Profile load: stored name value present");

          if (!storedName) {
            const derivedResult = deriveFirstNameFromUser(user);
            const derivedFirstName = derivedResult?.name ?? "";
            if (import.meta.env.DEV) console.log("Profile load: derived first name candidate");
            if (derivedFirstName) {
              effectiveProfile = {
                ...profileData,
                name:
                  normalizeCandidateName(profileData.name) || derivedFirstName || usernameValue,
                full_name:
                  normalizeCandidateName(profileData.full_name) || derivedFirstName || usernameValue,
              };

              // Fire-and-forget: Don't await name sync - user already sees name from metadata
              syncProfileFirstName(user.id, derivedFirstName)
                .then((syncResult) => {
                  if (import.meta.env.DEV) console.log("Profile load: syncProfileFirstName completed (background)");
                  if (syncResult.success) {
                    window.dispatchEvent(
                      new CustomEvent("profile:updated", {
                        detail: {
                          id: user.id,
                          name: syncResult.storedName || derivedFirstName,
                          full_name: syncResult.storedName || derivedFirstName,
                        },
                      })
                    );
                  } else if (import.meta.env.DEV) {
                    console.warn("Failed to persist derived first name to profile (background).");
                  }
                })
                .catch(() => {
                  if (import.meta.env.DEV) console.warn("Unable to sync derived first name to profile (background)");
                });
            } else {
              if (import.meta.env.DEV) console.log("Profile load: no first name derived from user metadata.");
            }
          }
        } else {
          if (import.meta.env.DEV) console.log("Profile page Supabase payload available");
        }

        setProfile(effectiveProfile);
        if (import.meta.env.DEV) {
          console.log("Profile load: effective profile state set");
          console.log("Profile load: avatar_url =", effectiveProfile.avatar_url);
        }

        const summaryPrState = convertSummaryToPrState(effectiveProfile?.pr_summary);
        const hasSummaryPrs = Object.values(summaryPrState).some(Boolean);
        setPostPrs(hasSummaryPrs ? summaryPrState : createEmptyPrState());

        // OPTIMIZED: Parallel fetch of PRs, stats, and posts (single Promise.all)
        const [prsResponse, followersRes, followingRes, postsResponse] = await Promise.all([
          // PRs fetch
          fetch(
            `${supabaseUrl}/rest/v1/prs?user_id=eq.${user.id}&select=weight,unit,achieved_at,exercise:exercises(name)&order=weight.desc`,
            {
              headers: {
                Authorization: `Bearer ${accessToken}`,
                apikey: apiKey,
              },
            }
          ),
          // Followers count
          fetch(`${supabaseUrl}/rest/v1/follows?following_id=eq.${user.id}&status=eq.accepted&select=id`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': apiKey, 'Prefer': 'count=exact' }
          }),
          // Following count
          fetch(`${supabaseUrl}/rest/v1/follows?follower_id=eq.${user.id}&status=eq.accepted&select=id`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': apiKey, 'Prefer': 'count=exact' }
          }),
          // Posts with count AND data in single query
          fetch(`${supabaseUrl}/rest/v1/posts?user_id=eq.${user.id}&select=*&order=created_at.desc&limit=25`, {
            headers: { 'Authorization': `Bearer ${accessToken}`, 'apikey': apiKey, 'Prefer': 'count=exact' }
          }),
        ]);

        // Process PRs
        const derivedPrsFromTable = createEmptyPrState();
        let prsLoadedFromTable = false;
        try {
          if (prsResponse.ok) {
            const prsData = await prsResponse.json();
            if (Array.isArray(prsData)) {
              prsData.forEach((record: any) => {
                const exerciseName = record.exercise?.name ?? "";
                const category = categorizeExercise(exerciseName);
                if (!category) return;
                const weightValue = Number(record.weight);
                if (!Number.isFinite(weightValue)) return;
                const currentBest = derivedPrsFromTable[category];
                if (!currentBest || weightValue > currentBest.weight) {
                  derivedPrsFromTable[category] = {
                    category,
                    exerciseName,
                    weight: weightValue,
                    unit: record.unit ?? "kg",
                    postedAt: record.achieved_at ?? new Date().toISOString(),
                  };
                }
              });
              prsLoadedFromTable = Object.values(derivedPrsFromTable).some(Boolean);
            }
          }
        } catch (error) {
          if (import.meta.env.DEV) console.warn("Failed to process PR rows, falling back to posts");
        }

        // Process stats
        const followersCount = followersRes.headers.get('content-range')?.split('/')[1] || '0';
        const followingCount = followingRes.headers.get('content-range')?.split('/')[1] || '0';
        const postsCount = postsResponse.headers.get('content-range')?.split('/')[1] || '0';

        setStats({
          followers: parseInt(followersCount),
          following: parseInt(followingCount),
          posts: parseInt(postsCount),
        });
        if (import.meta.env.DEV) console.log("Profile load: follower stats ready");

        // Process posts (already fetched in parallel)
        const postsData = await postsResponse.json();

        const displayUsername =
          normalizeCandidateName(effectiveProfile?.username) || storedName || usernameValue || "User";

        const enrichedPosts = (postsData || []).map((post: any) => ({
          ...post,
          public_profiles: {
            username: displayUsername,
            avatar_url: effectiveProfile?.avatar_url,
          },
        }));

        let postsWithWorkouts = enrichedPosts;
        try {
          postsWithWorkouts = await enrichPostsWithSharedWorkouts(enrichedPosts, {
            supabaseUrl,
            accessToken,
            apiKey,
          });
        } catch (enrichError) {
          console.error("Failed to enrich profile posts with workout details:", enrichError);
          postsWithWorkouts = enrichedPosts;
        }

        setPosts(
          postsWithWorkouts.map((post: any) => ({
            ...post,
            is_private: Boolean(post.is_private),
          }))
        );
        const initialHasMore = postsWithWorkouts.length >= 25;
        setHasMorePosts(initialHasMore);

        const derivedPrsFromPosts = hasSummaryPrs
          ? null
          : await computePrsFromPosts(postsWithWorkouts);
        const hasPostDerivedPrs = derivedPrsFromPosts
          ? Object.values(derivedPrsFromPosts).some(Boolean)
          : false;

        if (!hasSummaryPrs) {
          if (hasPostDerivedPrs && derivedPrsFromPosts) {
            setPostPrs(derivedPrsFromPosts);
          } else if (prsLoadedFromTable) {
            setPostPrs(derivedPrsFromTable);
          } else {
            setPostPrs(createEmptyPrState());
          }
        }
      } catch (error: any) {
        toast({
          title: "Error",
          description: "Failed to load profile",
          variant: "destructive",
        });
        setPostPrs(createEmptyPrState());
      } finally {
        if (silent) {
          setRefreshing(false);
        } else {
          setLoading(false);
        }
      }
    },
    [computePrsFromPosts, navigate, toast]
  );

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const loadMoreProfilePosts = useCallback(async () => {
    if (loadingMorePosts || !hasMorePosts || posts.length === 0 || !profile?.id) {
      return;
    }

    try {
      setLoadingMorePosts(true);

      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) return;

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const lastPost = posts[posts.length - 1];
      const cursor = lastPost.created_at;

      const { data: postsData, error: postsError } = await supabase
        .from('posts')
        .select('*')
        .eq('user_id', user.id)
        .lt('created_at', cursor)
        .order('created_at', { ascending: false })
        .limit(10);

      if (postsError) {
        console.error('Failed to load more posts:', postsError);
        return;
      }

      if (!Array.isArray(postsData) || postsData.length === 0) {
        setHasMorePosts(false);
        return;
      }

      const displayUsername =
        normalizeCandidateName(profile?.username) ||
        normalizeCandidateName(profile?.full_name) ||
        profile?.username ||
        "User";

      const enrichedPosts = postsData.map((post: any) => ({
        ...post,
        public_profiles: {
          username: displayUsername,
          avatar_url: profile?.avatar_url,
        },
      }));

      let postsWithWorkouts = enrichedPosts;
      try {
        postsWithWorkouts = await enrichPostsWithSharedWorkouts(enrichedPosts, {
          supabaseUrl,
          accessToken,
          apiKey,
        });
      } catch (enrichError) {
        console.error("Failed to enrich more posts with workout details:", enrichError);
      }

      const newPosts = postsWithWorkouts.map((post: any) => ({
        ...post,
        is_private: Boolean(post.is_private),
      }));

      setPosts((prev) => [...prev, ...newPosts]);
      setHasMorePosts(newPosts.length >= 10);
    } catch (error) {
      console.error("Failed to load more profile posts:", error);
    } finally {
      setLoadingMorePosts(false);
    }
  }, [loadingMorePosts, hasMorePosts, posts, profile?.id, profile?.username, profile?.full_name, profile?.avatar_url]);

  useEffect(() => {
    const handlePrUpdated = (event: Event) => {
      const custom = event as CustomEvent<{
        userId?: string;
        summary?: unknown;
        prs?: unknown;
      }>;
      if (!custom.detail?.userId || !profile?.id) return;
      if (custom.detail.userId !== profile.id) return;

      const nextState = derivePrStateFromPayload(custom.detail);
      setPostPrs(nextState);
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
  }, [derivePrStateFromPayload, profile?.id]);

  useEffect(() => {
    const handleProfileUpdated = (event: Event) => {
      const custom = event as CustomEvent<{
        id?: string;
        name?: string;
        full_name?: string;
        username?: string;
        ai_tips_consent?: boolean;
        ai_tips_consent_granted_at?: string | null;
      }>;
      if (import.meta.env.DEV) console.log("Profile component received profile:updated event");
      if (!custom.detail?.id || !profile?.id) return;
      if (custom.detail.id !== profile.id) return;

      setProfile((prev: any) =>
        prev
          ? {
              ...prev,
              name:
                typeof custom.detail.name === "string"
                  ? custom.detail.name
                  : typeof custom.detail.full_name === "string"
                  ? custom.detail.full_name
                  : prev.name,
              full_name:
                typeof custom.detail.full_name === "string"
                  ? custom.detail.full_name
                  : typeof custom.detail.name === "string"
                  ? custom.detail.name
                  : prev.full_name,
              username:
                normalizeCandidateName(custom.detail.username) ||
                normalizeCandidateName(custom.detail.name) ||
                normalizeCandidateName(custom.detail.full_name) ||
                prev.username,
              ai_tips_consent:
                typeof custom.detail.ai_tips_consent === "boolean"
                  ? custom.detail.ai_tips_consent
                  : prev.ai_tips_consent,
              ai_tips_consent_granted_at:
                custom.detail.ai_tips_consent_granted_at !== undefined
                  ? custom.detail.ai_tips_consent_granted_at
                  : prev.ai_tips_consent_granted_at,
            }
          : prev
      );
    };

    window.addEventListener("profile:updated", handleProfileUpdated);
    return () => {
      window.removeEventListener("profile:updated", handleProfileUpdated);
    };
  }, [profile?.id]);

  useEffect(() => {
    const handlePrivacyChanged = (event: Event) => {
      const custom = event as CustomEvent<{ postId?: string; isPrivate?: boolean }>;
      if (!custom.detail?.postId || typeof custom.detail.isPrivate !== "boolean") return;

      setPosts((prev) =>
        prev.map((post) =>
          post.id === custom.detail?.postId
            ? { ...post, is_private: custom.detail?.isPrivate }
            : post
        )
      );
    };

    window.addEventListener("post:privacy-changed", handlePrivacyChanged);
    return () => {
      window.removeEventListener("post:privacy-changed", handlePrivacyChanged);
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    if (loading) {
      return;
    }

    const container = mainScrollRef.current;

    if (!container) {
      return;
    }

    const isContainerScrollable = container.scrollHeight > container.clientHeight + 1;

    if (!isContainerScrollable && hasMorePosts && !loadingMorePosts && posts.length > 0) {
      loadMoreProfilePosts();
    }

    const getMetrics = () => {
      if (isContainerScrollable) {
        return {
          scrollTop: container.scrollTop,
          scrollHeight: container.scrollHeight,
          clientHeight: container.clientHeight,
        };
      }

      const doc = document.documentElement;
      const scrollTop = window.scrollY ?? doc.scrollTop ?? 0;
      const scrollHeight = doc.scrollHeight;
      const clientHeight = window.innerHeight;
      return { scrollTop, scrollHeight, clientHeight };
    };

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = getMetrics();
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom < 500 && !loadingMorePosts && hasMorePosts && posts.length > 0) {
        loadMoreProfilePosts();
      }
    };

    if (isContainerScrollable) {
      container.addEventListener('scroll', handleScroll, { passive: true });
    } else {
      window.addEventListener('scroll', handleScroll, { passive: true });
    }

    return () => {
      if (isContainerScrollable) {
        container.removeEventListener('scroll', handleScroll);
      } else {
        window.removeEventListener('scroll', handleScroll);
      }
    };
  }, [loading, loadingMorePosts, hasMorePosts, loadMoreProfilePosts, posts.length]);

  const getTopPR = (category: PrCategory) => postPrs[category];

  const liftConfigs: Array<{ category: PrCategory; title: string; icon: JSX.Element }> = [
    {
      category: "squat",
      title: "Squat",
      icon: <Dumbbell className="h-12 w-12" />,
    },
    {
      category: "bench",
      title: "Bench Press",
      icon: <Weight className="h-12 w-12" />,
    },
    {
      category: "deadlift",
      title: "Deadlift",
      icon: <Trophy className="h-12 w-12" />,
    },
  ];

  const hasAnyPr = Object.values(postPrs).some(Boolean);

  const loadFollowers = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (followersLoading) return;
      if (!reset && !followersHasMore) return;

      if (reset) {
        followersPageRef.current = 0;
        setFollowersList([]);
        setFollowersHasMore(true);
      }

      try {
        const session = await getSupabaseSession();
        const accessToken = session?.access_token;
        if (!accessToken) return;

        const targetProfileId = profile?.id ?? session?.user?.id;
        if (!targetProfileId) return;

        setFollowersLoading(true);

        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();
        const offset = followersPageRef.current * FOLLOW_PAGE_SIZE;

        const followsResponse = await fetch(
          `${supabaseUrl}/rest/v1/follows?following_id=eq.${targetProfileId}&status=eq.accepted&select=follower_id&limit=${FOLLOW_PAGE_SIZE}&offset=${offset}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          }
        );
        const followsData = await followsResponse.json();

        if (!Array.isArray(followsData) || followsData.length === 0) {
          setFollowersHasMore(false);
          if (reset) {
            setFollowersList([]);
          }
          return;
        }

        const followerIds = followsData
          .map((f: any) => f?.follower_id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

        if (followerIds.length === 0) {
          setFollowersHasMore(false);
          return;
        }

        const profilesResponse = await fetch(
          `${supabaseUrl}/rest/v1/public_profiles?id=in.(${followerIds.join(",")})&select=*`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          }
        );
        const profilesData = await profilesResponse.json();
        const profileMap = new Map<string, any>();

        if (Array.isArray(profilesData)) {
          profilesData.forEach((entry: any) => {
            if (entry?.id) {
              profileMap.set(entry.id, entry);
            }
          });
        }

        const orderedProfiles = followerIds
          .map((id) => profileMap.get(id))
          .filter((entry): entry is Record<string, any> => Boolean(entry));

        setFollowersList((prev) => {
          if (reset) {
            return orderedProfiles;
          }

          if (orderedProfiles.length === 0) {
            return prev;
          }

          const existingIds = new Set(prev.map((entry: any) => entry.id));
          const merged = orderedProfiles.filter((entry) => !existingIds.has(entry.id));
          return merged.length > 0 ? [...prev, ...merged] : prev;
        });

        followersPageRef.current += 1;

        const contentRange = followsResponse.headers.get("content-range");
        let hasMore = followerIds.length === FOLLOW_PAGE_SIZE;
        if (contentRange) {
          const [, totalPartRaw] = contentRange.split("/") as [string, string?];
          if (totalPartRaw && totalPartRaw !== "*") {
            const total = Number(totalPartRaw);
            if (Number.isFinite(total)) {
              hasMore = offset + followerIds.length < total;
            }
          }
        }
        setFollowersHasMore(hasMore);
      } catch (error) {
        console.error("Error loading followers:", error);
      } finally {
        setFollowersLoading(false);
      }
    },
    [followersHasMore, followersLoading, profile?.id]
  );

  const loadFollowing = useCallback(
    async ({ reset = false }: { reset?: boolean } = {}) => {
      if (followingLoading) return;
      if (!reset && !followingHasMore) return;

      if (reset) {
        followingPageRef.current = 0;
        setFollowingList([]);
        setFollowingHasMore(true);
      }

      try {
        const session = await getSupabaseSession();
        const accessToken = session?.access_token;
        if (!accessToken) return;

        const targetProfileId = profile?.id ?? session?.user?.id;
        if (!targetProfileId) return;

        setFollowingLoading(true);

        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();
        const offset = followingPageRef.current * FOLLOW_PAGE_SIZE;

        const followsResponse = await fetch(
          `${supabaseUrl}/rest/v1/follows?follower_id=eq.${targetProfileId}&status=eq.accepted&select=following_id&limit=${FOLLOW_PAGE_SIZE}&offset=${offset}`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          }
        );
        const followsData = await followsResponse.json();

        if (!Array.isArray(followsData) || followsData.length === 0) {
          setFollowingHasMore(false);
          if (reset) {
            setFollowingList([]);
          }
          return;
        }

        const followingIds = followsData
          .map((f: any) => f?.following_id)
          .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

        if (followingIds.length === 0) {
          setFollowingHasMore(false);
          return;
        }

        const profilesResponse = await fetch(
          `${supabaseUrl}/rest/v1/public_profiles?id=in.(${followingIds.join(",")})&select=*`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          }
        );
        const profilesData = await profilesResponse.json();
        const profileMap = new Map<string, any>();

        if (Array.isArray(profilesData)) {
          profilesData.forEach((entry: any) => {
            if (entry?.id) {
              profileMap.set(entry.id, entry);
            }
          });
        }

        const orderedProfiles = followingIds
          .map((id) => profileMap.get(id))
          .filter((entry): entry is Record<string, any> => Boolean(entry));

        setFollowingList((prev) => {
          if (reset) {
            return orderedProfiles;
          }

          if (orderedProfiles.length === 0) {
            return prev;
          }

          const existingIds = new Set(prev.map((entry: any) => entry.id));
          const merged = orderedProfiles.filter((entry) => !existingIds.has(entry.id));
          return merged.length > 0 ? [...prev, ...merged] : prev;
        });

        followingPageRef.current += 1;

        const contentRange = followsResponse.headers.get("content-range");
        let hasMore = followingIds.length === FOLLOW_PAGE_SIZE;
        if (contentRange) {
          const [, totalPartRaw] = contentRange.split("/") as [string, string?];
          if (totalPartRaw && totalPartRaw !== "*") {
            const total = Number(totalPartRaw);
            if (Number.isFinite(total)) {
              hasMore = offset + followingIds.length < total;
            }
          }
        }
        setFollowingHasMore(hasMore);
      } catch (error) {
        console.error("Error loading following:", error);
      } finally {
        setFollowingLoading(false);
      }
    },
    [followingHasMore, followingLoading, profile?.id]
  );

  const openFollowersDialog = () => {
    setFollowersDialogOpen(true);
    void loadFollowers({ reset: true });
  };

  const openFollowingDialog = () => {
    setFollowingDialogOpen(true);
    void loadFollowing({ reset: true });
  };

  const handleFollowersScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (followersLoading || !followersHasMore) return;
      const target = event.currentTarget;
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining <= 16) {
        void loadFollowers();
      }
    },
    [followersHasMore, followersLoading, loadFollowers]
  );

  const handleFollowingScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      if (followingLoading || !followingHasMore) return;
      const target = event.currentTarget;
      const remaining = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remaining <= 16) {
        void loadFollowing();
      }
    },
    [followingHasMore, followingLoading, loadFollowing]
  );

  const handleManualRefresh = useCallback(() => {
    if (!refreshing) {
      loadProfile({ silent: true });
    }
  }, [loadProfile, refreshing]);

  useEffect(() => {
    if (!refreshing) {
      setPullState({ pullDistance: 0, visualDistance: 0 });
    }
  }, [refreshing]);

  const handleTouchStart = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (loading || refreshing) return;
      if (!mainScrollRef.current) return;
      if (mainScrollRef.current.scrollTop > 0) return;

      touchStartYRef.current = event.touches[0].clientY;
      isPullingRef.current = true;
      setPullState({ pullDistance: 0, visualDistance: 0 });
    },
    [loading, refreshing]
  );

  const handleTouchMove = useCallback(
    (event: React.TouchEvent<HTMLDivElement>) => {
      if (!isPullingRef.current || touchStartYRef.current === null) return;
      if (!mainScrollRef.current) return;

      const scrollTop = mainScrollRef.current.scrollTop;
      const currentY = event.touches[0].clientY;
      const delta = currentY - touchStartYRef.current;

      if (scrollTop > 0 || delta <= 0) {
        isPullingRef.current = false;
        setPullState({ pullDistance: 0, visualDistance: 0 });
        return;
      }

      if (delta < PROFILE_PULL_DEAD_ZONE) {
        setPullState({ pullDistance: 0, visualDistance: 0 });
        return;
      }

      event.preventDefault();
      const effectivePull = delta - PROFILE_PULL_DEAD_ZONE;
      const dampened = Math.min(
        PROFILE_PULL_MAX_DISTANCE - PROFILE_PULL_DEAD_ZONE,
        effectivePull * PROFILE_PULL_DAMPING
      );
      const visual = Math.max(0, dampened);

      setPullState({
        pullDistance: Math.min(PROFILE_PULL_MAX_DISTANCE, delta),
        visualDistance: visual,
      });
    },
    []
  );

  const handleTouchEnd = useCallback(() => {
    if (!isPullingRef.current) {
      touchStartYRef.current = null;
      return;
    }

    isPullingRef.current = false;
    touchStartYRef.current = null;

    const rawDistance = pullState.pullDistance;
    if (rawDistance >= PROFILE_PULL_THRESHOLD && !refreshing) {
      handleManualRefresh();
    }

    setPullState({ pullDistance: 0, visualDistance: 0 });
  }, [handleManualRefresh, pullState.pullDistance, refreshing]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  // Listen for follow request acceptances to refresh stats
  useEffect(() => {
    const handleFollowAccepted = () => {
      console.log("[Profile] Follow request accepted, refreshing...");
      loadProfile({ silent: true });
    };

    window.addEventListener("follow-request-accepted", handleFollowAccepted);
    return () => window.removeEventListener("follow-request-accepted", handleFollowAccepted);
  }, [loadProfile]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <User className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-white dark:bg-neutral-900">
      <LiquidGlassHeader className="justify-between">
        <Avatar className="h-8 w-8">
          {profile?.avatar_url && (
            <AvatarImage src={profile.avatar_url} alt={profile?.username || "User"} cacheKey={profile?.id} />
          )}
          <AvatarFallback className="bg-primary text-primary-foreground text-sm">
            {profile?.username?.charAt(0).toUpperCase() || "U"}
          </AvatarFallback>
        </Avatar>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">{profile?.username ? `${capitalizeUsername(profile.username)}'s MinimaLog` : "MinimaLog"}</h1>
        <div className="flex items-center gap-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setSettingsOpen(true)}
            aria-label="Open settings"
            className="text-gray-600 dark:text-gray-400"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </LiquidGlassHeader>

      <main
        ref={mainScrollRef}
        className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden smooth-scroll"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div
          className="transition-transform duration-75 ease-out"
          style={{
            transform:
              refreshing || !pullState.visualDistance
                ? undefined
                : `translateY(${Math.min(140, pullState.visualDistance)}px)`,
          }}
        >
          <div
            className="flex h-12 mt-4 items-center justify-center text-sm text-muted-foreground pointer-events-none select-none transition-opacity duration-150"
            style={{
              opacity: refreshing
                ? 1
                : pullState.pullDistance > 0
                ? Math.min(
                    pullState.pullDistance / PROFILE_PULL_THRESHOLD,
                    1
                  )
                : 0,
            }}
          >
            <RefreshCw
              className={`h-4 w-4 mr-2 ${
                refreshing
                  ? "animate-spin"
                  : pullState.pullDistance >= PROFILE_PULL_THRESHOLD
                  ? "text-foreground"
                  : ""
              }`}
            />
            <span>
              {refreshing
                ? "Refreshing..."
                : pullState.pullDistance >= PROFILE_PULL_THRESHOLD
                ? "Release to refresh"
                : "Pull to refresh"}
            </span>
          </div>
          <div className="container mx-auto px-4 py-4 max-w-2xl pb-[calc(env(safe-area-inset-bottom)+4rem)]">
        {/* Profile Header */}
          <div className="flex items-start gap-4 mb-4">
          <Avatar className="h-20 w-20">
            {profile?.avatar_url && (
              <AvatarImage
                src={profile.avatar_url}
                alt={profile?.username || "User"}
                loading="eager"
                cacheKey={profile?.id}
              />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
              {profile?.username?.charAt(0).toUpperCase() || "U"}
            </AvatarFallback>
          </Avatar>
          
          <div className="flex-1">
            <h2 className="text-2xl font-bold mb-2">{capitalizeUsername(profile?.username) || "User"}</h2>
            <div className="flex gap-6 text-sm items-center">
              <span>
                <span className="font-bold">{stats.posts}</span>
                <span className="text-muted-foreground ml-1">posts</span>
              </span>
              <button
                onClick={openFollowersDialog}
                className="hover:opacity-70 transition-opacity"
              >
                <span className="font-bold">{stats.followers}</span>
                <span className="text-muted-foreground ml-1">followers</span>
              </button>
              <button
                onClick={openFollowingDialog}
                className="hover:opacity-70 transition-opacity"
              >
                <span className="font-bold">{stats.following}</span>
                <span className="text-muted-foreground ml-1">following</span>
              </button>
            </div>
            {profile?.bio && (
              <div className="mt-3 rounded-2xl border border-border bg-muted/20 p-3 sm:p-4 text-sm text-muted-foreground whitespace-pre-line break-words">
                {profile.bio}
              </div>
            )}
          </div>
        </div>

        {/* Tabs */}
        <LiquidGlassTabs
          tabs={[
            { id: "posts", label: "Posts" },
            { id: "prs", label: "PRs" },
          ]}
          activeTab={activeTab}
          onTabChange={(tabId) => setActiveTab(tabId as "posts" | "prs")}
          className="mb-6 w-full max-w-sm mx-auto"
        />

          {activeTab === "posts" && (
          <div className="space-y-4 mt-4">
            {posts.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-muted-foreground">No posts yet</p>
              </Card>
            ) : (
              <>
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    post={post}
                    currentUserId={profile?.id || ""}
                    onPostDeleted={() => loadProfile({ silent: true })}
                  />
                ))}

                {loadingMorePosts && (
                  <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Loading more posts…</span>
                  </div>
                )}

                {!loadingMorePosts && !hasMorePosts && posts.length > 0 && (
                  <div className="flex items-center justify-center py-6 text-xs uppercase tracking-wide text-muted-foreground">
                    You&apos;re all caught up
                  </div>
                )}
              </>
            )}
          </div>
          )}

          {activeTab === "prs" && (
          <div className="space-y-6 mt-4">
            <PRCalculator />
            
            {!hasAnyPr ? (
              <Card className="p-8 text-center border-2">
                <CardContent className="py-8">
                  <Trophy className="h-16 w-16 mx-auto mb-4 opacity-50" />
                  <h3 className="text-xl font-semibold mb-2">No PRs yet</h3>
                  <p className="text-muted-foreground">
                    Share workouts with details to show your latest PRs
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {liftConfigs.map((config) => {
                  const topPR = getTopPR(config.category);
                  
                  return (
                    <Card key={config.category} className="border-2">
                      <CardContent className="pt-6 text-center">
                        <div className="flex flex-col items-center gap-3">
                          <div className="h-20 w-20 rounded-full bg-primary/10 flex items-center justify-center text-primary">
                            {config.icon}
                          </div>
                          <h3 className="text-lg font-semibold">{config.title}</h3>
                          {topPR ? (
                            <>
                              <div className="text-3xl font-bold">
                                {Number.isInteger(topPR.weight)
                                  ? topPR.weight
                                  : topPR.weight.toFixed(1)}{" "}
                                {topPR.unit}
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {topPR.exerciseName}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                {format(new Date(topPR.postedAt), "MMM d, yyyy")}
                              </p>
                            </>
                          ) : (
                            <p className="text-muted-foreground text-sm">No PR yet</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
          )}
          </div>
        </div>
      </main>

      <ProfileSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        profile={profile}
        userEmail={userEmail}
        onProfileUpdate={() => loadProfile({ silent: true })}
      />

      {/* Followers Dialog */}
      <Dialog open={followersDialogOpen} onOpenChange={setFollowersDialogOpen}>
        <DialogContent className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur" showClose={false}>
          <DialogHeader>
            <DialogTitle>Followers</DialogTitle>
          </DialogHeader>
          <div
            className="overflow-y-auto pr-2"
            style={{ maxHeight: `${FOLLOW_LIST_MAX_HEIGHT}px` }}
            onScroll={handleFollowersScroll}
          >
            <div className="space-y-3 pr-2">
              {followersList.length === 0 ? (
                followersLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Loading followers…
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No followers yet
                  </p>
                )
              ) : (
                followersList.map((follower) => (
                  <div
                    key={follower.id}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                    onClick={() => navigate(`/user/${follower.id}`)}
                  >
                    <Avatar className="h-10 w-10">
                      {follower.avatar_url && (
                        <AvatarImage src={follower.avatar_url} alt={follower.username || "User"} cacheKey={follower.id} />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {follower.username?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{capitalizeUsername(follower.username) || "User"}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {followersLoading && followersList.length > 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                Loading more…
              </div>
            )}
            {!followersLoading && !followersHasMore && followersList.length > 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                You&apos;re all caught up
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Following Dialog */}
      <Dialog open={followingDialogOpen} onOpenChange={setFollowingDialogOpen}>
        <DialogContent className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur" showClose={false}>
          <DialogHeader>
            <DialogTitle>Following</DialogTitle>
          </DialogHeader>
          <div
            className="overflow-y-auto pr-2"
            style={{ maxHeight: `${FOLLOW_LIST_MAX_HEIGHT}px` }}
            onScroll={handleFollowingScroll}
          >
            <div className="space-y-3 pr-2">
              {followingList.length === 0 ? (
                followingLoading ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Loading following…
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    Not following anyone yet
                  </p>
                )
              ) : (
                followingList.map((following) => (
                  <div
                    key={following.id}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                    onClick={() => navigate(`/user/${following.id}`)}
                  >
                    <Avatar className="h-10 w-10">
                      {following.avatar_url && (
                        <AvatarImage src={following.avatar_url} alt={following.username || "User"} cacheKey={following.id} />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {following.username?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{capitalizeUsername(following.username) || "User"}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
            {followingLoading && followingList.length > 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                Loading more…
              </div>
            )}
            {!followingLoading && !followingHasMore && followingList.length > 0 && (
              <div className="py-3 text-center text-xs text-muted-foreground">
                You&apos;re all caught up
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Profile;
