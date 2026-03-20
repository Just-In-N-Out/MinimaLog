import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Heart, MessageCircle, Dumbbell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Textarea } from "@/components/ui/textarea";
import { z } from "zod";

const commentSchema = z.string().trim().min(1, "Comment cannot be empty").max(500, "Comment must be less than 500 characters");

interface Post {
  id: string;
  user_id: string;
  workout_id: string;
  title: string;
  caption: string | null;
  created_at: string;
  show_workout_details: boolean;
  profile?: {
    name: string;
  };
  workout?: {
    started_at: string;
    ended_at: string | null;
  };
  session_metrics?: {
    mood: number | null;
    sleep: number | null;
    preworkout: boolean;
  }[];
}

interface PostCardProps {
  post: Post;
  currentUserId: string;
  initialLikes?: { count: number; liked: boolean };
  initialSummary?: { exercises: number; sets: number };
}

function PostCard({ post, currentUserId, initialLikes, initialSummary }: PostCardProps) {
  const { toast } = useToast();
  const [liked, setLiked] = useState(initialLikes?.liked ?? false);
  const [likeCount, setLikeCount] = useState(initialLikes?.count ?? 0);
  const [likeLoading, setLikeLoading] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentLoading, setCommentLoading] = useState(false);
  const [hasMoreComments, setHasMoreComments] = useState(true);
  const [workoutSummary, setWorkoutSummary] = useState<{ exercises: number; sets: number }>(initialSummary ?? { exercises: 0, sets: 0 });
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(false);
  const [workoutDetails, setWorkoutDetails] = useState<any[]>([]);

  useEffect(() => {
    // Only fetch if pre-fetched data wasn't provided
    if (!initialLikes) loadLikes();
    if (!initialSummary) loadWorkoutSummary();
  }, [post.id]);

  // Real-time: like count updates from other users
  useEffect(() => {
    const channel = supabase
      .channel(`likes-${post.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "likes", filter: `post_id=eq.${post.id}` },
        (payload) => {
          if ((payload.new as any).user_id !== currentUserId) {
            setLikeCount(prev => prev + 1);
          }
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "likes", filter: `post_id=eq.${post.id}` },
        (payload) => {
          if ((payload.old as any)?.user_id !== currentUserId) {
            setLikeCount(prev => Math.max(0, prev - 1));
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [post.id, currentUserId]);

  // Real-time: new comments from other users (only when comments are open)
  useEffect(() => {
    if (!showComments) return;

    const channel = supabase
      .channel(`comments-${post.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${post.id}` },
        (payload) => {
          if ((payload.new as any).user_id !== currentUserId) {
            loadComments(0);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [showComments, post.id, currentUserId]);

  const loadLikes = async () => {
    try {
      const { data: likes, error } = await supabase
        .from("likes" as any)
        .select("user_id")
        .eq("post_id", post.id);

      if (error) throw error;

      setLikeCount(likes?.length || 0);
      setLiked(likes?.some((like: any) => like.user_id === currentUserId) || false);
    } catch (error) {
      console.error("Failed to load likes:", error);
    }
  };

  const loadWorkoutSummary = async () => {
    try {
      const { data: workoutExercises, error } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          sets (count)
        `)
        .eq("workout_id", post.workout_id);

      if (error) throw error;

      const exerciseCount = workoutExercises?.length || 0;
      const totalSets = workoutExercises?.reduce((sum, we: any) => sum + (we.sets?.[0]?.count || 0), 0) || 0;

      setWorkoutSummary({ exercises: exerciseCount, sets: totalSets });
    } catch (error) {
      console.error("Failed to load workout summary:", error);
    }
  };

  const COMMENTS_PAGE_SIZE = 20;

  const loadComments = async (page = 0) => {
    try {
      const { data, error } = await supabase
        .from("comments" as any)
        .select(`
          id, content, created_at, user_id,
          profiles!comments_user_id_fkey (name)
        `)
        .eq("post_id", post.id)
        .order("created_at", { ascending: true })
        .range(page * COMMENTS_PAGE_SIZE, (page + 1) * COMMENTS_PAGE_SIZE - 1);

      if (error) throw error;

      if (page === 0) {
        setComments(data || []);
      } else {
        setComments(prev => [...prev, ...(data || [])]);
      }
      setHasMoreComments((data?.length || 0) === COMMENTS_PAGE_SIZE);
    } catch (error) {
      console.error("Failed to load comments:", error);
    }
  };

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);

    const wasLiked = liked;
    setLiked(!wasLiked);
    setLikeCount(prev => wasLiked ? prev - 1 : prev + 1);

    try {
      if (wasLiked) {
        const { error } = await supabase
          .from("likes" as any)
          .delete()
          .eq("post_id", post.id)
          .eq("user_id", currentUserId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("likes" as any)
          .insert({ post_id: post.id, user_id: currentUserId });
        if (error) throw error;
      }
    } catch (error: any) {
      setLiked(wasLiked);
      setLikeCount(prev => wasLiked ? prev + 1 : prev - 1);
      toast({
        title: "Error",
        description: "Failed to update like",
        variant: "destructive",
      });
    } finally {
      setLikeLoading(false);
    }
  };

  const handleComment = async () => {
    if (commentLoading) return;

    const validation = commentSchema.safeParse(commentText);
    if (!validation.success) {
      toast({
        title: "Invalid comment",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    setCommentLoading(true);
    try {
      const { error } = await supabase
        .from("comments" as any)
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          content: validation.data,
        });

      if (error) throw error;

      setCommentText("");
      loadComments();
      toast({
        title: "Comment added",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    } finally {
      setCommentLoading(false);
    }
  };

  const handleToggleComments = () => {
    if (!showComments) {
      loadComments();
    }
    setShowComments(!showComments);
  };

  const loadWorkoutDetails = async () => {
    try {
      const { data: exercises, error } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          order_index,
          exercises (name, muscle_group),
          sets (
            set_no,
            reps,
            weight,
            unit,
            rpe,
            rir,
            is_warmup
          )
        `)
        .eq("workout_id", post.workout_id)
        .order("order_index", { ascending: true });

      if (error) throw error;
      setWorkoutDetails(exercises || []);
    } catch (error) {
      console.error("Failed to load workout details:", error);
      toast({
        title: "Error",
        description: "Failed to load workout details",
        variant: "destructive",
      });
    }
  };

  const handleToggleWorkoutDetails = () => {
    if (!showWorkoutDetails && workoutDetails.length === 0) {
      loadWorkoutDetails();
    }
    setShowWorkoutDetails(!showWorkoutDetails);
  };

  const metrics = post.session_metrics?.[0];

  return (
    <Card className="mb-4 rounded-2xl shadow-md">
      <CardHeader>
        <div className="flex items-center gap-3">
          <Avatar>
            <AvatarFallback>{post.profile?.name?.[0] || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-semibold">{post.profile?.name || "Unknown User"}</p>
            <p className="text-sm text-muted-foreground">
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            </p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <h3 className="font-bold text-lg">{post.title}</h3>
          {post.caption && <p className="text-muted-foreground mt-1">{post.caption}</p>}
        </div>

        <div className="bg-muted/50 rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <Dumbbell className="h-4 w-4" />
              <span>{workoutSummary.exercises} exercises • {workoutSummary.sets} sets</span>
            </div>
            {post.show_workout_details && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleToggleWorkoutDetails}
              >
                {showWorkoutDetails ? "Hide Details" : "View Details"}
              </Button>
            )}
          </div>
          {metrics && (
            <div className="flex gap-4 text-sm text-muted-foreground">
              {metrics.mood !== null && <span>😊 Mood: {metrics.mood}/10</span>}
              {metrics.sleep !== null && <span>😴 Sleep: {metrics.sleep}/10</span>}
              {metrics.preworkout && <span>⚡ Pre-workout</span>}
            </div>
          )}

          {showWorkoutDetails && workoutDetails.length > 0 && (
            <div className="mt-4 space-y-3 border-t pt-3">
              {workoutDetails.map((exercise: any, idx: number) => (
                <div key={exercise.id} className="space-y-2">
                  <div className="font-semibold text-sm">
                    {idx + 1}. {exercise.exercises?.name}
                    {exercise.exercises?.muscle_group && (
                      <span className="text-muted-foreground font-normal ml-2">
                        ({exercise.exercises.muscle_group})
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {exercise.sets
                      ?.filter((set: any) => !set.is_warmup)
                      .map((set: any) => (
                        <div
                          key={set.set_no}
                          className="text-xs flex items-center gap-2 text-muted-foreground"
                        >
                          <span>Set {set.set_no}:</span>
                          <span className="font-medium text-foreground">
                            {set.reps} reps × {set.weight} {set.unit}
                          </span>
                          {set.rpe && <span>RPE {set.rpe}</span>}
                          {set.rir !== null && <span>RIR {set.rir}</span>}
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-4 pt-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLike}
            className={liked ? "text-red-500" : ""}
          >
            <Heart className={`h-4 w-4 mr-1 ${liked ? "fill-current" : ""}`} />
            {likeCount}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleToggleComments}>
            <MessageCircle className="h-4 w-4 mr-1" />
            {comments.length}
          </Button>
        </div>

        {showComments && (
          <div className="space-y-3 pt-3 border-t">
            {comments.map((comment) => (
              <div key={comment.id} className="flex gap-2">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="text-xs">
                    {comment.profile?.name?.[0] || "U"}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 bg-muted rounded-lg p-2">
                  <p className="font-semibold text-sm">{comment.profiles?.name || "Unknown"}</p>
                  <p className="text-sm">{comment.content}</p>
                </div>
              </div>
            ))}
            {hasMoreComments && comments.length >= COMMENTS_PAGE_SIZE && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => loadComments(Math.ceil(comments.length / COMMENTS_PAGE_SIZE))}
              >
                Load more comments
              </Button>
            )}
            <div className="flex gap-2">
              <Textarea
                placeholder="Add a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="min-h-[60px]"
              />
              <Button onClick={handleComment} size="sm">
                Post
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default React.memo(PostCard);
