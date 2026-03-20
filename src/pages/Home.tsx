import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useProfile, useActiveWorkout } from "@/hooks/queries/useFeed";
import { Plus, User, Search, Users, Home as HomeIcon, History, LineChart, Trophy, Clock, Bell } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
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
import { NotificationsDialog } from "@/components/NotificationsDialog";
import { Badge } from "@/components/ui/badge";

const searchSchema = z.string().trim().max(100, "Search query too long").regex(/^[a-zA-Z0-9\s]*$/, "Only letters, numbers, and spaces allowed");

const FEED_PAGE_SIZE = 50;

const Home = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const { data: profile } = useProfile(user?.id);
  const { data: activeWorkout } = useActiveWorkout(user?.id);
  const [feedData, setFeedData] = useState<any[]>([]);
  const [feedOffset, setFeedOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [newPostsAvailable, setNewPostsAvailable] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate("/auth"); return; }
    if (profile && !profile.onboarding_completed) { navigate("/onboarding"); return; }
    loadFeed(0);
  }, [user, authLoading, profile]);

  useEffect(() => {
    if (!user) return;

    loadUnreadCount();

    const notifChannel = supabase
      .channel("notifications-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { loadUnreadCount(); }
      )
      .subscribe();

    // Real-time: show banner when new posts appear from other users
    const feedChannel = supabase
      .channel("feed-changes")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "posts" },
        (payload) => {
          if ((payload.new as any).user_id !== user.id) {
            setNewPostsAvailable(true);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(notifChannel);
      supabase.removeChannel(feedChannel);
    };
  }, [user]);

  const loadFeed = async (offset: number) => {
    if (!user) return;
    if (offset > 0) setLoadingMore(true);
    try {
      const { data: feed, error } = await supabase.rpc("get_feed", {
        p_user_id: user.id,
        p_limit: FEED_PAGE_SIZE,
        p_offset: offset,
      });

      if (error) throw error;
      const feedArr = (feed as any[]) || [];

      if (offset === 0) {
        setFeedData(feedArr);
      } else {
        setFeedData(prev => [...prev, ...feedArr]);
      }
      setFeedOffset(offset + feedArr.length);
      setHasMore(feedArr.length === FEED_PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load feed:", error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const loadUnreadCount = async () => {
    try {
      if (!user) return;
      
      const { count, error } = await supabase
        .from("notifications")
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("read", false);

      if (error) throw error;
      setUnreadCount(count || 0);
    } catch (error) {
      console.error("Failed to load unread count:", error);
    }
  };

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
      const { data, error } = await supabase
        .from("public_profiles" as any)
        .select("id, name")
        .ilike("name", `%${searchQuery}%`)
        .limit(10);

      if (error) throw error;
      setSearchResults(data || []);
    } catch (error) {
      console.error("Search failed:", error);
      toast({
        title: "Search failed",
        description: "Please try again",
        variant: "destructive",
      });
    }
  };

  const handleFollow = async (userId: string) => {
    try {
      const { error } = await supabase
        .from("follows" as any)
        .insert({
          follower_id: user.id,
          following_id: userId,
        });

      if (error) throw error;

      toast({
        title: "Following user",
      });

      setShowSearch(false);
      loadFeed(0);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to follow user",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-bounce">💪</div>
          <p className="text-lg text-muted-foreground">Loading feed...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <header className="border-b sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="w-10" />
          <h1 className="text-2xl font-bold ml-4">MinimaLog</h1>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowNotifications(true)}
              className="relative"
              title="Notifications"
            >
              <Bell className="h-5 w-5" />
              {unreadCount > 0 && (
                <Badge 
                  variant="destructive" 
                  className="absolute -top-1 -right-1 h-5 w-5 flex items-center justify-center p-0 text-xs"
                >
                  {unreadCount > 9 ? "9+" : unreadCount}
                </Badge>
              )}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setShowSearch(true)}
              title="Find Friends"
            >
              <Search className="h-5 w-5" />
            </Button>
          </div>
        </div>
      </header>

      {/* Feed */}
      <main className="container mx-auto px-4 py-6 pb-24 max-w-2xl">
        {/* Active Workout Banner */}
        {activeWorkout && (
          <Card 
            className="mb-6 border-2 border-primary cursor-pointer hover:bg-muted/50 transition-colors"
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
        )}

        {newPostsAvailable && (
          <Button
            variant="outline"
            className="w-full mb-4 border-primary text-primary"
            onClick={() => {
              setNewPostsAvailable(false);
              loadFeed(0);
            }}
          >
            New posts available — tap to refresh
          </Button>
        )}

        {feedData.length === 0 ? (
          <div className="text-center py-12 space-y-4">
            <Users className="h-16 w-16 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold mb-2">No posts yet</h2>
              <p className="text-muted-foreground">
                Follow friends to see their workouts here
              </p>
            </div>
            <Button onClick={() => setShowSearch(true)}>
              Find Friends
            </Button>
          </div>
        ) : (
          <>
            {feedData.map((fd: any) => (
              <PostCard
                key={fd.id}
                post={{
                  id: fd.id,
                  user_id: fd.user_id,
                  workout_id: fd.workout_id,
                  title: fd.title,
                  caption: fd.caption,
                  created_at: fd.created_at,
                  show_workout_details: fd.show_workout_details,
                }}
                currentUserId={user!.id}
                initialLikes={{ count: Number(fd.like_count), liked: fd.liked_by_me }}
                initialSummary={{ exercises: Number(fd.exercise_count), sets: Number(fd.set_count) }}
              />
            ))}
            {hasMore && (
              <div className="py-4 text-center">
                <Button
                  variant="outline"
                  onClick={() => loadFeed(feedOffset)}
                  disabled={loadingMore}
                >
                  {loadingMore ? "Loading..." : "Load more posts"}
                </Button>
              </div>
            )}
          </>
        )}
      </main>

      {/* Search Dialog */}
      <Dialog open={showSearch} onOpenChange={setShowSearch}>
        <DialogContent className="backdrop-blur-md bg-background/95">
          <DialogHeader>
            <DialogTitle>Find Friends</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Input
                placeholder="Search by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
              <Button onClick={handleSearch}>Search</Button>
            </div>
            <div className="space-y-2">
              {searchResults.map((result) => (
                <div
                  key={result.id}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <Avatar>
                      <AvatarFallback>{result.name?.[0] || "U"}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold">{result.name || "Unknown"}</p>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handleFollow(result.id)}
                  >
                    Follow
                  </Button>
                </div>
              ))}
            </div>
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
