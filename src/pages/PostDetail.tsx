import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseSession } from "@/lib/session";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { enrichPostsWithSharedWorkouts, SharedWorkoutSummary } from "@/lib/sharedWorkout";
import PostCard from "@/components/PostCard";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dumbbell, ArrowLeft } from "lucide-react";

interface PostRecord {
  id: string;
  user_id: string;
  workout_id: string;
  title: string;
  caption: string | null;
  created_at: string;
  show_workout_details: boolean;
  public_profiles?: { username: string; avatar_url?: string | null };
  workout?: { started_at: string; ended_at: string | null };
  session_metrics?: {
    mood: number | null;
    sleep: number | null;
    preworkout: boolean;
    soreness_area?: string | null;
  }[];
  shared_workout_summary?: SharedWorkoutSummary | null;
  shared_workout_details?: any[] | null;
}

const PostDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [post, setPost] = useState<PostRecord | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const load = async () => {
      if (!id) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      try {
        const session = await getSupabaseSession();
        if (!session?.user) {
          navigate("/auth");
          return;
        }
        setCurrentUserId(session.user.id);

        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();
        const response = await fetch(
          `${supabaseUrl}/rest/v1/posts?id=eq.${id}&select=*,public_profiles(username,avatar_url),workouts:workouts(id,started_at,ended_at),session_metrics(*)`,
          {
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${session.access_token}`,
              apikey: apiKey,
            },
          }
        );

        if (!response.ok) {
          setNotFound(true);
          return;
        }

        const data = await response.json();
        if (!data || data.length === 0) {
          setNotFound(true);
          return;
        }

        let recordWithShared: any = null;
        try {
          const [enriched] = await enrichPostsWithSharedWorkouts(data, {
            supabaseUrl,
            accessToken: session.access_token,
            apiKey,
          });
          recordWithShared = enriched;
        } catch (enrichError) {
          console.error("Failed to enrich post with workout details:", enrichError);
          recordWithShared = null;
        }

        const record = recordWithShared || data[0];

        setPost({
          id: record.id,
          user_id: record.user_id,
          workout_id: record.workout_id,
          title: record.title,
          caption: record.caption,
          created_at: record.created_at,
          show_workout_details: record.show_workout_details,
          public_profiles: record.public_profiles,
          workout: record.workouts,
          session_metrics: record.session_metrics,
          shared_workout_summary: record.shared_workout_summary ?? null,
          shared_workout_details: record.shared_workout_details ?? null,
        });
      } catch (error) {
        console.error("Failed to load post", error);
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading post...</p>
        </div>
      </div>
    );
  }

  if (notFound || !post) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="w-full max-w-md border-2">
          <CardContent className="py-10 text-center space-y-4">
            <Dumbbell className="h-12 w-12 mx-auto text-muted-foreground" />
            <div>
              <h2 className="text-xl font-semibold">Post not found</h2>
              <p className="text-sm text-muted-foreground">We couldn’t locate that post.</p>
            </div>
            <Button onClick={() => navigate(-1)}>Go Back</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-background">
        <div className="container mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold">Post Details</h1>
        </div>
      </header>

      <main className="container mx-auto px-4 py-6 max-w-3xl">
        <PostCard post={post} currentUserId={currentUserId} />
      </main>
    </div>
  );
};

export default PostDetail;
