import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { User, Trophy, Weight, Dumbbell, ArrowLeft, RefreshCw, Lock } from "lucide-react";
import { enrichPostsWithSharedWorkouts } from "@/lib/sharedWorkout";
import PostCard from "@/components/PostCard";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
// PERFORMANCE: Import shared follow relationships hook
import { useFollowersList, useFollowingList } from "@/hooks/useFollowRelationships";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { LiquidGlassTabs } from "@/components/LiquidGlassTabs";

type FollowStatus = "none" | "pending" | "accepted";
type ProfileStats = {
  followers: number | null;
  following: number | null;
  posts: number | null;
};

const capitalizeUsername = (username: string | undefined | null): string => {
  if (!username) return "";
  return username.charAt(0).toUpperCase() + username.slice(1);
};

const UserProfile = () => {
  const { userId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [currentUserId, setCurrentUserId] = useState("");
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<ProfileStats>({
    followers: null,
    following: null,
    posts: null,
  });
  const [posts, setPosts] = useState<any[]>([]);
  const [prs, setPrs] = useState<any[]>([]);
  const [followStatus, setFollowStatus] = useState<FollowStatus>("none");
  const [followersDialogOpen, setFollowersDialogOpen] = useState(false);
  const [followingDialogOpen, setFollowingDialogOpen] = useState(false);
  // PERFORMANCE: Infinite scroll state for user profile posts
  const [loadingMorePosts, setLoadingMorePosts] = useState(false);
  const [hasMorePosts, setHasMorePosts] = useState(true);
  const [activeTab, setActiveTab] = useState<"posts" | "prs">("posts");
  const mainScrollRef = useRef<HTMLDivElement | null>(null);
  const isPrivateProfile = Boolean(profile?.is_private);
  const canViewPrivateSections = !isPrivateProfile || followStatus === "accepted";
  const isPendingRequest = followStatus === "pending";

  // PERFORMANCE OPTIMIZATION: Use shared follow hooks instead of local state
  // BEFORE: Duplicate followers/following logic in multiple files
  // AFTER: Shared hook with optimized embedded relations query
  const { followersList, loadFollowers: loadFollowersList } = useFollowersList(userId);
  const { followingList, loadFollowing: loadFollowingList } = useFollowingList(userId);


  const openFollowersDialog = () => {
    if (!canViewPrivateSections) return;
    loadFollowersList();
    setFollowersDialogOpen(true);
  };

  const openFollowingDialog = () => {
    if (!canViewPrivateSections) return;
    loadFollowingList();
    setFollowingDialogOpen(true);
  };

  const formatStat = (value: number | null) =>
    typeof value === "number" ? value : "—";
  const followButtonLabel =
    followStatus === "accepted"
      ? "Following"
      : followStatus === "pending"
      ? "Requested"
      : "Follow";
  const followButtonVariant =
    followStatus === "accepted"
      ? "outline"
      : followStatus === "pending"
        ? "secondary"
        : "default";

  const categorizeExercise = (name: string): "squat" | "bench" | "deadlift" | null => {
    const lower = (name || "").toLowerCase();
    if (lower.includes("squat")) return "squat";
    if (lower.includes("bench")) return "bench";
    if (lower.includes("deadlift")) return "deadlift";
    return null;
  };

  const deriveFallbackPrs = (userPosts: any[]) => {
    const fallback: Record<"squat" | "bench" | "deadlift", any | null> = {
      squat: null,
      bench: null,
      deadlift: null,
    };

    userPosts.forEach((post) => {
      if (!post?.show_workout_details || !Array.isArray(post?.shared_workout_details)) return;
      const postedAt = post.created_at ?? new Date().toISOString();

      post.shared_workout_details.forEach((exercise: any) => {
        const exerciseName = exercise?.exercises?.name ?? "";
        const category = categorizeExercise(exerciseName);
        if (!category) return;

        const sets = Array.isArray(exercise?.sets) ? exercise.sets : [];
        sets.forEach((set: any) => {
          if (set?.is_warmup) return;
          const weight = Number(set?.weight);
          const reps = Number(set?.reps);
          if (!Number.isFinite(weight) || !Number.isFinite(reps)) return;
          const unit = set?.unit === "lb" ? "lb" : "kg";

          const current = fallback[category];
          if (!current || weight > current.weight) {
            fallback[category] = {
              weight,
              reps,
              unit,
              est_1rm: null,
              achieved_at: postedAt,
              exercise: { name: exerciseName },
            };
          }
        });
      });
    });

    return Object.values(fallback).filter(Boolean) as any[];
  };

  useEffect(() => {
    loadProfile();
  }, [userId]);

  const loadProfile = async () => {
    try {
      if (!userId) {
        setLoading(false);
        return;
      }
      // Ensure we have an authenticated session
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        navigate("/auth");
        return;
      }

      setCurrentUserId(user.id);

      // If viewing own profile, redirect to /profile
      if (user.id === userId) {
        navigate("/profile");
        return;
      }

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Load profile data
      const { data: profileData, error: profileError } = await supabase
        .from("public_profiles" as any)
        .select("*")
        .eq("id", userId)
        .maybeSingle();

      if (profileError) {
        throw profileError;
      }

      if (!profileData) {
        toast({
          title: "User not found",
          variant: "destructive",
        });
        navigate(-1);
        return;
      }

      setProfile(profileData);

      // Check if current user follows this profile
      const { data: followRow, error: followError } = await supabase
        .from("follows" as any)
        .select("id, status")
        .eq("follower_id", user.id)
        .eq("following_id", userId)
        .maybeSingle();

      if (followError) {
        throw followError;
      }

      const statusValue = (followRow as { status?: FollowStatus } | null)?.status;
      const derivedFollowStatus: FollowStatus =
        statusValue === "accepted" || statusValue === "pending" ? statusValue : "none";
      setFollowStatus(derivedFollowStatus);

      const allowFullView = !profileData.is_private || derivedFollowStatus === "accepted";

      if (!allowFullView) {
        setStats({ followers: null, following: null, posts: null });
        setPosts([]);
        setPrs([]);
        setHasMorePosts(false);
        return;
      }

      const [{ count: followersCount }, { count: followingCount }, postsQuery] = await Promise.all([
        supabase
          .from("follows" as any)
          .select("*", { count: "exact", head: true })
          .eq("following_id", userId)
          .eq("status", "accepted"),
        supabase
          .from("follows" as any)
          .select("*", { count: "exact", head: true })
          .eq("follower_id", userId)
          .eq("status", "accepted"),
        supabase
          .from("posts" as any)
          .select("*", { count: "exact" })
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(20),
      ]);

      if (postsQuery.error) {
        throw postsQuery.error;
      }

      setStats({
        followers: followersCount ?? 0,
        following: followingCount ?? 0,
        posts: postsQuery.count ?? (postsQuery.data?.length ?? 0),
      });

      const postsData = postsQuery.data ?? [];

      let postsWithWorkouts: any[] = [];

      if (postsData) {
        const enriched = postsData.map((p: any) => ({
          ...p,
          public_profiles: {
            username: profileData.username,
            avatar_url: profileData.avatar_url
          }
        }));

        try {
          postsWithWorkouts = await enrichPostsWithSharedWorkouts(enriched, {
            supabaseUrl,
            accessToken,
            apiKey,
          });
        } catch (enrichError) {
          console.error("Failed to enrich viewed user posts with workout details:", enrichError);
          postsWithWorkouts = enriched;
        }

        setPosts(
          postsWithWorkouts.map((post: any) => ({
            ...post,
            is_private: Boolean(post.is_private),
          }))
        );

        // PERFORMANCE: Set hasMore based on if we got a full page
        setHasMorePosts(postsWithWorkouts.length >= 20);
      }

      // Load PRs via REST API
      try {
        const prsResponse = await fetch(`${supabaseUrl}/rest/v1/prs?user_id=eq.${userId}&select=*,exercise:exercises(name,muscle_group)&order=achieved_at.desc`, {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'apikey': apiKey
          }
        });

        if (prsResponse.ok) {
          const prsData = await prsResponse.json();

          const filteredPRs = (prsData || []).filter((pr: any) => {
            const name = pr.exercise?.name?.toLowerCase?.() ?? "";
            return name.includes('squat') || 
                   name.includes('bench') || 
                   name.includes('deadlift');
          });

          if (filteredPRs.length > 0) {
            setPrs(filteredPRs);
          } else {
            setPrs(deriveFallbackPrs(postsWithWorkouts));
          }
        } else {
          throw new Error(`PR fetch failed with status ${prsResponse.status}`);
        }
      } catch (error) {
        console.warn("Failed to fetch PR rows for user profile, falling back:", error);
        setPrs(postsWithWorkouts.length > 0 ? deriveFallbackPrs(postsWithWorkouts) : []);
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to load profile",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  // PERFORMANCE: Load more posts for infinite scroll
  const loadMorePosts = useCallback(async () => {
    if (!canViewPrivateSections) return;
    if (loadingMorePosts || !hasMorePosts || posts.length === 0 || !userId) return;

    try {
      setLoadingMorePosts(true);

      const session = await getSupabaseSession();
      const accessToken = session?.access_token;
      if (!accessToken) return;

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      const lastPost = posts[posts.length - 1];
      const cursor = lastPost.created_at;

      const postsQuery = await supabase
        .from("posts" as any)
        .select("*")
        .eq("user_id", userId)
        .lt("created_at", cursor)
        .order("created_at", { ascending: false })
        .limit(10);

      if (postsQuery.error) throw postsQuery.error;

      const postsData = postsQuery.data ?? [];

      if (postsData.length === 0) {
        setHasMorePosts(false);
        return;
      }

      const enriched = postsData.map((p: any) => ({
        ...p,
        public_profiles: {
          username: profile?.username || "User",
          avatar_url: profile?.avatar_url
        }
      }));

      let postsWithWorkouts = enriched;
      try {
        postsWithWorkouts = await enrichPostsWithSharedWorkouts(enriched, {
          supabaseUrl,
          accessToken,
          apiKey,
        });
      } catch (enrichError) {
        console.error("Failed to enrich more user posts:", enrichError);
      }

      const newPosts = postsWithWorkouts.map((post: any) => ({
        ...post,
        is_private: Boolean(post.is_private),
      }));

      setPosts([...posts, ...newPosts]);
      setHasMorePosts(newPosts.length >= 10);

      if (import.meta.env.DEV) {
        console.log(`[UserProfile] Loaded ${newPosts.length} more posts`);
      }
    } catch (error) {
      console.error("Failed to load more user profile posts:", error);
    } finally {
      setLoadingMorePosts(false);
    }
  }, [canViewPrivateSections, loadingMorePosts, hasMorePosts, posts, userId, profile?.username, profile?.avatar_url]);

  // PERFORMANCE: Infinite scroll listener
  useEffect(() => {
    const container = mainScrollRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

      if (distanceFromBottom < 500 && !loadingMorePosts && hasMorePosts) {
        loadMorePosts();
      }
    };

    container.addEventListener('scroll', handleScroll);
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [loadingMorePosts, hasMorePosts, loadMorePosts]);

  const handleFollowAction = async () => {
    if (!currentUserId || !userId) return;
    try {
      if (followStatus === "accepted") {
        const { error } = await supabase
          .from("follows")
          .delete()
          .eq("follower_id", currentUserId)
          .eq("following_id", userId);

        if (error) throw error;

        setFollowStatus("none");
        setStats((prev) => ({
          ...prev,
          followers:
            typeof prev.followers === "number" ? Math.max(prev.followers - 1, 0) : prev.followers,
        }));
        toast({ title: "Unfollowed" });
      } else if (followStatus === "none") {
        const isTargetPrivate = Boolean(profile?.is_private);
        const { error } = await supabase
          .from("follows")
          .insert({
            follower_id: currentUserId,
            following_id: userId,
            status: isTargetPrivate ? "pending" : "accepted",
          });

        if (error) throw error;

        const nextStatus: FollowStatus = isTargetPrivate ? "pending" : "accepted";
        setFollowStatus(nextStatus);

        if (nextStatus === "accepted") {
          setStats((prev) => ({
            ...prev,
            followers:
              typeof prev.followers === "number" ? prev.followers + 1 : prev.followers,
          }));
          toast({ title: "Following" });
        } else {
          toast({
            title: "Request sent",
            description: "We'll notify you when your request is accepted.",
          });
        }
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update follow status",
        variant: "destructive",
      });
    }
  };

  const handleCancelRequest = async () => {
    if (!currentUserId || !userId) return;
    try {
      const { error } = await supabase
        .from("follows")
        .delete()
        .eq("follower_id", currentUserId)
        .eq("following_id", userId);

      if (error) throw error;

      setFollowStatus("none");
      toast({ title: "Request canceled" });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to cancel request",
        variant: "destructive",
      });
    }
  };

  const getTopPR = (category: string) => {
    const categoryPRs = prs.filter(pr => {
      const name = pr.exercise.name.toLowerCase();
      return name.includes(category);
    });

    if (categoryPRs.length === 0) return null;

    return categoryPRs.reduce((max, pr) => {
      const maxValue = max.est_1rm || max.weight;
      const prValue = pr.est_1rm || pr.weight;
      return prValue > maxValue ? pr : max;
    });
  };

  const liftConfigs = [
    { 
      category: 'squat', 
      title: 'Squat',
      icon: <Dumbbell className="h-12 w-12" />,
    },
    { 
      category: 'bench', 
      title: 'Bench Press',
      icon: <Weight className="h-12 w-12" />,
    },
    { 
      category: 'deadlift', 
      title: 'Deadlift',
      icon: <Trophy className="h-12 w-12" />,
    },
  ];

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
    <div className="min-h-screen w-full flex flex-col bg-white dark:bg-neutral-900 relative">
      <header
        className="z-10 flex-shrink-0 absolute top-0 left-0 right-0"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <div className="mx-4 mb-2 px-4 py-3 flex items-center gap-3 rounded-[28px] backdrop-blur-xl backdrop-saturate-150 bg-gray-200/90 dark:bg-neutral-800/80 border border-gray-300/50 dark:border-white/10">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => navigate(-1)}
            className="h-8 w-8"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-lg font-bold flex-1 text-center pr-8">{profile?.username ? `${capitalizeUsername(profile.username)}'s Minimalog` : "User's Minimalog"}</h1>
        </div>
      </header>

      <main ref={mainScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll" style={{ paddingTop: 'calc(env(safe-area-inset-top) + 70px)' }}>
        <div className="container mx-auto px-4 py-6 max-w-2xl pb-[calc(env(safe-area-inset-bottom, 0px) + 4rem)]">
          {/* Profile Header */}
          <div className="flex items-start gap-4 mb-6">
            <Avatar className="h-20 w-20">
              {profile?.avatar_url && (
                <AvatarImage
                  src={profile.avatar_url}
                  alt={profile?.username || "User"}
                  loading="eager"
                  cacheKey={userId}
                />
              )}
              <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
                {profile?.username?.charAt(0).toUpperCase() || "U"}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1">
              <h2 className="text-2xl font-bold mb-2">{capitalizeUsername(profile?.username) || "User"}</h2>
              <div className="flex gap-6 text-sm items-center mb-3">
                <span>
                  <span className="font-bold">{formatStat(stats.posts)}</span>
                  <span className="text-muted-foreground ml-1">posts</span>
                </span>
                <button
                  onClick={openFollowersDialog}
                  disabled={!canViewPrivateSections}
                  className={`transition-opacity ${
                    canViewPrivateSections ? "hover:opacity-70" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  <span className="font-bold">{formatStat(stats.followers)}</span>
                  <span className="text-muted-foreground ml-1">followers</span>
                </button>
                <button
                  onClick={openFollowingDialog}
                  disabled={!canViewPrivateSections}
                  className={`transition-opacity ${
                    canViewPrivateSections ? "hover:opacity-70" : "opacity-50 cursor-not-allowed"
                  }`}
                >
                  <span className="font-bold">{formatStat(stats.following)}</span>
                  <span className="text-muted-foreground ml-1">following</span>
                </button>
              </div>
              {profile?.bio && (
                <div className="rounded-2xl border border-border bg-muted/20 p-3 sm:p-4 text-sm text-muted-foreground whitespace-pre-line break-words">
                  {profile.bio}
                </div>
              )}
            </div>
          </div>

          {/* Full-width Follow Button */}
          <Button
            onClick={followStatus === "pending" ? handleCancelRequest : handleFollowAction}
            variant={followButtonVariant}
            size="sm"
            className="w-full rounded-full mb-2"
          >
            {followButtonLabel}
          </Button>
          {followStatus === "pending" && (
            <p className="text-xs text-muted-foreground text-center mb-4">
              Tap to cancel your follow request.
            </p>
          )}

          {isPrivateProfile && !canViewPrivateSections && (
            <Card className="border border-dashed">
              <CardContent className="flex items-center gap-3 py-6">
                <Lock className="h-10 w-10 text-muted-foreground" />
                <div>
                  <p className="font-semibold">This account is private</p>
                  <p className="text-sm text-muted-foreground">
                    Follow to request access. Only accepted followers can view posts, PRs, and stats.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          {canViewPrivateSections && (
            <>
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
                      currentUserId={currentUserId}
                      onPostDeleted={loadProfile}
                    />
                  ))}

                  {/* PERFORMANCE: Infinite scroll loading indicator */}
                  {loadingMorePosts && (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="h-5 w-5 animate-spin mr-2" />
                      <span className="text-sm text-muted-foreground">Loading more posts...</span>
                    </div>
                  )}

                  {/* End of posts indicator */}
                  {!loadingMorePosts && !hasMorePosts && posts.length > 0 && (
                    <div className="flex items-center justify-center py-8">
                      <span className="text-sm text-muted-foreground">You've reached the end</span>
                    </div>
                  )}
                </>
              )}
            </div>
              )}

              {activeTab === "prs" && (
            <div className="space-y-6 mt-4">
              {prs.length === 0 ? (
                <Card className="p-8 text-center border-2">
                  <CardContent className="py-8">
                    <Trophy className="h-16 w-16 mx-auto mb-4 opacity-50" />
                    <h3 className="text-xl font-semibold mb-2">No PRs yet</h3>
                    <p className="text-muted-foreground">
                      No squat, bench, or deadlift PRs to show
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
                                  {topPR.weight} {topPR.unit}
                                </div>
                                {topPR.est_1rm && (
                                  <p className="text-sm text-muted-foreground">
                                    Est. 1RM: {topPR.est_1rm.toFixed(1)} {topPR.unit}
                                  </p>
                                )}
                                <p className="text-sm text-muted-foreground">
                                  {format(new Date(topPR.achieved_at), "MMM d, yyyy")}
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
            </>
          )}
        </div>
      </main>

      <Dialog open={followersDialogOpen} onOpenChange={setFollowersDialogOpen}>
        <DialogContent
          className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur"
          showClose={false}
        >
          <DialogHeader>
            <DialogTitle>Followers</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] sm:max-h-[80vh] pr-4">
            <div className="space-y-3">
              {followersList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No followers yet
                </p>
              ) : (
                followersList.map((follower) => (
                  <div
                    key={follower.id}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                    onClick={() => {
                      setFollowersDialogOpen(false);
                      navigate(`/user/${follower.id}`);
                    }}
                  >
                    <Avatar className="h-10 w-10">
                      {follower.avatar_url && (
                        <AvatarImage
                          src={follower.avatar_url}
                          alt={follower.username || "User"}
                          loading="lazy"
                          cacheKey={follower.id}
                        />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {follower.username?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {capitalizeUsername(follower.username) || "User"}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      <Dialog open={followingDialogOpen} onOpenChange={setFollowingDialogOpen}>
        <DialogContent
          className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur"
          showClose={false}
        >
          <DialogHeader>
            <DialogTitle>Following</DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[70vh] sm:max-h-[80vh] pr-4">
            <div className="space-y-3">
              {followingList.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">
                  Not following anyone yet
                </p>
              ) : (
                followingList.map((followingUser) => (
                  <div
                    key={followingUser.id}
                    className="flex items-center gap-3 p-2 rounded-lg cursor-pointer"
                    onClick={() => {
                      setFollowingDialogOpen(false);
                      navigate(`/user/${followingUser.id}`);
                    }}
                  >
                    <Avatar className="h-10 w-10">
                      {followingUser.avatar_url && (
                        <AvatarImage
                          src={followingUser.avatar_url}
                          alt={followingUser.username || "User"}
                          loading="lazy"
                          cacheKey={followingUser.id}
                        />
                      )}
                      <AvatarFallback className="bg-primary text-primary-foreground">
                        {followingUser.username?.charAt(0).toUpperCase() || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">
                        {capitalizeUsername(followingUser.username) || "User"}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default UserProfile;
