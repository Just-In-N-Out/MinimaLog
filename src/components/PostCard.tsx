import { useState, useEffect, useCallback, useRef, memo } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Heart, MessageCircle, Dumbbell, Pencil, X, Check, Trash2, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { formatDistanceToNow } from "date-fns";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { z } from "zod";
import { summariseWorkoutDetails, SharedWorkoutSummary } from "@/lib/sharedWorkout";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";
import { PostImageUpload } from "@/components/PostImageUpload";
// PERFORMANCE: Import image optimization utilities for lazy loading and Supabase transforms
import { getOptimizedPostImage } from "@/lib/imageOptimization";

const commentSchema = z.string().trim().min(1, "Comment cannot be empty").max(500, "Comment must be less than 500 characters");

const postEditSchema = z.object({
  title: z.string().trim().min(1, "Title cannot be empty").max(200, "Title must be less than 200 characters"),
  caption: z.string().trim().max(500, "Caption must be less than 500 characters").optional(),
});

const capitalizeUsername = (username: string | undefined | null): string => {
  if (!username) return "";
  return username.charAt(0).toUpperCase() + username.slice(1);
};

type SessionMetrics = {
  mood: number | null;
  sleep: number | null;
  preworkout: boolean | null;
  soreness_area?: string | null;
};

type CheckInResponses = {
  sleepQuality: number | null;
  preWorkoutTaken: boolean | null;
  sorenessArea: string | null;
  energyLevel: number | null;
};

type CheckInOptionValue = number | boolean | string;

interface CheckInOption {
  value: CheckInOptionValue;
  label: string;
  helper?: string;
}

interface CheckInStep {
  key: keyof CheckInResponses;
  title: string;
  description?: string;
  type: "scale" | "binary" | "options";
  options: CheckInOption[];
}

type CheckInSummary = {
  sleepScore: number | null;
  energyScore: number | null;
  preWorkoutStatus: string | null;
  sorenessTag: { icon: string; label: string } | null;
};

const PRE_WORKOUT_CHECK_IN_STEPS: CheckInStep[] = [
  {
    key: "sleepQuality",
    title: "How did you sleep last night?",
    description: "1 = rough night, 5 = out like a light.",
    type: "scale",
    options: [
      { value: 1, label: "1", helper: "Rough" },
      { value: 2, label: "2", helper: "Restless" },
      { value: 3, label: "3", helper: "Okay" },
      { value: 4, label: "4", helper: "Solid" },
      { value: 5, label: "5", helper: "Great" },
    ],
  },
  {
    key: "preWorkoutTaken",
    title: "Did you take pre-workout?",
    type: "binary",
    options: [
      { value: true, label: "Yes" },
      { value: false, label: "No" },
    ],
  },
  {
    key: "sorenessArea",
    title: "Any soreness today?",
    description: "Pick what stands out the most.",
    type: "options",
    options: [
      { value: "none", label: "Feeling fresh" },
      { value: "upper", label: "Upper body" },
      { value: "lower", label: "Lower body" },
      { value: "full", label: "Full body" },
    ],
  },
  {
    key: "energyLevel",
    title: "How's your energy level?",
    description: "1 = running on fumes, 5 = unstoppable.",
    type: "scale",
    options: [
      { value: 1, label: "1", helper: "Low" },
      { value: 2, label: "2", helper: "Below avg" },
      { value: 3, label: "3", helper: "Steady" },
      { value: 4, label: "4", helper: "Charged" },
      { value: 5, label: "5", helper: "Peak" },
    ],
  },
];

const parseNumericMetric = (value: unknown): number | null => {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const derivePreWorkoutValue = (
  metrics: SessionMetrics | null,
  options: { sleepScore: number | null; energyScore: number | null; normalizedSoreness: string | null },
): boolean | null => {
  if (!metrics) {
    return null;
  }

  const rawValue =
    typeof metrics.preworkout === "boolean"
      ? metrics.preworkout
      : typeof metrics.preworkout === "number"
      ? Boolean(metrics.preworkout)
      : null;

  if (rawValue !== false) {
    return rawValue;
  }

  const hasRecordedResponses =
    typeof options.sleepScore === "number" ||
    typeof options.energyScore === "number" ||
    Boolean(options.normalizedSoreness);

  if (hasRecordedResponses) {
    return rawValue;
  }

  const hasRawSoreness =
    typeof metrics.soreness_area === "string" && metrics.soreness_area.trim().length > 0;
  const hasRawSleep =
    typeof metrics.sleep === "number" ||
    (typeof metrics.sleep === "string" && metrics.sleep.trim().length > 0);
  const hasRawMood =
    typeof metrics.mood === "number" ||
    (typeof metrics.mood === "string" && metrics.mood.trim().length > 0);

  if (hasRawSleep || hasRawMood || hasRawSoreness) {
    return rawValue;
  }

  return null;
};

const PreWorkoutCheckInReview = ({
  metrics,
  summary,
}: {
  metrics: SessionMetrics | null;
  summary: CheckInSummary;
}) => {
  if (!metrics) {
    return null;
  }

  const sleepValue = parseNumericMetric(metrics.sleep);
  const energyValue = parseNumericMetric(metrics.mood);
  const rawSoreness =
    typeof metrics.soreness_area === "string" && metrics.soreness_area.trim().length > 0
      ? metrics.soreness_area
      : null;
  const normalizedSoreness =
    typeof rawSoreness === "string" ? rawSoreness.toLowerCase() : null;
  const preWorkoutValue = derivePreWorkoutValue(metrics, {
    sleepScore: sleepValue,
    energyScore: energyValue,
    normalizedSoreness,
  });

  const sleepStep = PRE_WORKOUT_CHECK_IN_STEPS.find((step) => step.key === "sleepQuality");
  const energyStep = PRE_WORKOUT_CHECK_IN_STEPS.find((step) => step.key === "energyLevel");
  const sorenessStep = PRE_WORKOUT_CHECK_IN_STEPS.find((step) => step.key === "sorenessArea");

  const sleepHelper =
    typeof sleepValue === "number"
      ? sleepStep?.options.find((option) => option.value === sleepValue)?.helper ?? null
      : null;
  const energyHelper =
    typeof energyValue === "number"
      ? energyStep?.options.find((option) => option.value === energyValue)?.helper ?? null
      : null;
  const sorenessLabel =
    normalizedSoreness && sorenessStep
      ? sorenessStep.options.find(
          (option) => String(option.value).toLowerCase() === normalizedSoreness,
        )?.label ?? summary.sorenessTag?.label ?? null
      : summary.sorenessTag?.label ?? null;

  const summaryItems = [
    {
      key: "sleep",
      label: "Sleep",
      value: typeof sleepValue === "number" ? `${sleepValue}/5` : "—",
      helper: sleepHelper,
      icon: "😴",
      active: typeof sleepValue === "number",
    },
    {
      key: "energy",
      label: "Energy",
      value: typeof energyValue === "number" ? `${energyValue}/5` : "—",
      helper: energyHelper,
      icon: "🔋",
      active: typeof energyValue === "number",
    },
    {
      key: "preworkout",
      label: "Pre-workout",
      value:
        preWorkoutValue === null ? "—" : preWorkoutValue ? "Yes" : "No",
      helper: null,
      icon: "⚡",
      active: preWorkoutValue !== null,
    },
    {
      key: "soreness",
      label: "Soreness",
      value: normalizedSoreness ? sorenessLabel ?? "—" : "—",
      helper: normalizedSoreness === "none" ? "Feeling fresh" : null,
      icon: summary.sorenessTag?.icon ?? "🩹",
      active: Boolean(normalizedSoreness),
    },
  ];

  const hasRecordedValues = summaryItems.some((item) => item.active);

  if (!hasRecordedValues) {
    return null;
  }

  return (
    <div className="rounded-2xl border border-muted/40 bg-muted/10 p-4 sm:p-5">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
          Pre-Workout Check-In
        </Badge>
      </div>

     <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {summaryItems.map((item) => (
          <div
            key={item.key}
            className={cn(
              "flex flex-col gap-1.5 rounded-[18px] border px-3 py-3 shadow-sm transition-colors",
              item.active
                ? "border-primary/40 bg-primary/10 text-foreground"
                : "border-muted/30 bg-background/80 text-muted-foreground",
            )}
          >
            <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide">
              <span role="img" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </span>
            <span
              className={cn(
                "text-lg font-semibold",
                item.active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {item.value}
            </span>
            {item.helper ? (
              <span className="text-xs font-medium text-muted-foreground">{item.helper}</span>
            ) : null}
          </div>
        ))}
      </div>

    </div>
  );
};

interface Post {
  id: string;
  user_id: string;
  workout_id: string;
  title: string;
  caption: string | null;
  created_at: string;
  show_workout_details: boolean;
  is_private?: boolean;
  image_urls?: string[] | null;
  profile?: {
    username: string;
    avatar_url?: string | null;
  };
  public_profiles?: {
    username: string;
    avatar_url?: string | null;
  };
  workout?: {
    started_at: string;
    ended_at: string | null;
  };
  session_metrics?: SessionMetrics[] | SessionMetrics | null;
  shared_workout_summary?: SharedWorkoutSummary | null;
  shared_workout_details?: any[] | null;
}

interface PostCardProps {
  post: Post;
  currentUserId: string;
  onPostDeleted?: () => void;
  focusedCommentId?: string;
  onCommentFocusHandled?: () => void;
}

const PostCard = memo(function PostCard({
  post,
  currentUserId,
  onPostDeleted,
  focusedCommentId,
  onCommentFocusHandled,
}: PostCardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const triggerHaptic = () => {
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    }
  };
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [commentCount, setCommentCount] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [workoutSummary, setWorkoutSummary] = useState<SharedWorkoutSummary>(
    post.shared_workout_summary ?? { exercises: 0, sets: 0, totalVolume: 0 }
  );
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(false);
  const [workoutDetails, setWorkoutDetails] = useState<any[]>(post.shared_workout_details ?? []);
  const [workoutDetailsLoading, setWorkoutDetailsLoading] = useState(false);
  const [sharedWorkoutLoaded, setSharedWorkoutLoaded] = useState(false);
  const [currentUserName, setCurrentUserName] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editCaption, setEditCaption] = useState(post.caption || "");
  const [editImageUrls, setEditImageUrls] = useState<string[]>(post.image_urls || []);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [isPrivate, setIsPrivate] = useState<boolean>(Boolean(post.is_private));
  const [privacyUpdating, setPrivacyUpdating] = useState(false);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [isSwiping, setIsSwiping] = useState(false);
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const carouselRef = useRef<HTMLDivElement>(null);
  const touchStartX = useRef<number>(0);
  const touchStartY = useRef<number>(0);
  const pendingFocusCommentId = useRef<string | null>(null);
  const [hasCommented, setHasCommented] = useState(false);
  const hasRequestedCommentReload = useRef(false);
  const instanceIdRef = useRef(`postcard-${post.id}-${Math.random().toString(36).slice(2)}`);
  const postCardRef = useRef<HTMLDivElement>(null);
  const broadcastPostUpdate = useCallback(
    (payload: { likeCount?: number; liked?: boolean; commentCount?: number }) => {
      if (typeof window === "undefined") return;
      window.dispatchEvent(
        new CustomEvent("post:interaction", {
          detail: { postId: post.id, sourceId: instanceIdRef.current, ...payload },
        })
      );
    },
    [post.id]
  );

  const formatNumericValue = (rawValue: unknown, options?: { integer?: boolean }) => {
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      return "-";
    }
    const value = Number(rawValue);
    if (!Number.isFinite(value)) {
      return "-";
    }
    if (options?.integer) {
      return Math.round(value).toString();
    }
    if (Number.isInteger(value)) {
      return value.toString();
    }
    return value.toFixed(1);
  };

  useEffect(() => {
    // Fetch current user's display name for optimistic comments
    const fetchName = async () => {
      const { data } = await supabase
        .from("public_profiles")
        .select("username")
        .eq("id", currentUserId)
        .maybeSingle();
      setCurrentUserName(data?.username || "You");
    };
    fetchName();
  }, [currentUserId]);

  useEffect(() => {
    setIsPrivate(Boolean(post.is_private));
  }, [post.is_private]);

  const loadLikes = async () => {
    try {
      const { data: likes, error } = await supabase
        .from("likes" as any)
        .select("*")
        .eq("post_id", post.id);

      if (error) throw error;

      const nextLikeCount = likes?.length || 0;
      const nextLiked = likes?.some((like: any) => like.user_id === currentUserId) || false;

      setLikeCount(nextLikeCount);
      setLiked(nextLiked);
      broadcastPostUpdate({ likeCount: nextLikeCount, liked: nextLiked });
    } catch (error) {
      console.error("Failed to load likes:", error);
    }
  };

  const loadComments = useCallback(async () => {
    try {
      const { data: baseComments, error } = await supabase
        .from("comments" as any)
        .select("*")
        .eq("post_id", post.id)
        .order("created_at", { ascending: true });

      if (error) throw error;

      const commentsData = baseComments || [];
      if (commentsData.length === 0) {
        setComments([]);
        setCommentCount(0);
        setHasCommented(false);
        broadcastPostUpdate({ commentCount: 0 });
        return [];
      }

      const userIds = Array.from(new Set(commentsData.map((c: any) => c.user_id)));
      const { data: profiles } = await supabase
        .from("public_profiles")
        .select("id, username, avatar_url")
        .in("id", userIds);

      const profileMap = new Map((profiles || []).map((p: any) => [p.id, { username: p.username, avatar_url: p.avatar_url }]));

      const merged = commentsData.map((c: any) => ({
        ...c,
        public_profiles: profileMap.get(c.user_id) || { username: "Unknown", avatar_url: null }
      }));

      setComments(merged);
      setCommentCount(merged.length);
      setHasCommented(merged.some((c: any) => c.user_id === currentUserId));
      broadcastPostUpdate({ commentCount: merged.length });
      return merged;
    } catch (error) {
      console.error("Failed to load comments:", error);
      return [];
    }
  }, [post.id, currentUserId, broadcastPostUpdate]);

  useEffect(() => {
    const handleInteraction = (event: Event) => {
      const detail = (event as CustomEvent)?.detail;
      if (!detail || detail.postId !== post.id || detail.sourceId === instanceIdRef.current) {
        return;
      }

      if (typeof detail.likeCount === "number") {
        setLikeCount(detail.likeCount);
      }
      if (typeof detail.liked === "boolean") {
        setLiked(detail.liked);
      }
      if (typeof detail.commentCount === "number") {
        setCommentCount(detail.commentCount);
        if (showComments) {
          void loadComments();
        }
      }
    };

    window.addEventListener("post:interaction", handleInteraction as EventListener);
    return () => {
      window.removeEventListener("post:interaction", handleInteraction as EventListener);
    };
  }, [post.id, loadComments, showComments]);

  const normalizeSharedDetails = (details: any[]): any[] => {
    return details.map((exercise: any, idx: number) => {
      const rawExercise =
        exercise.exercises && typeof exercise.exercises === "object"
          ? exercise.exercises
          : exercise.exercise && typeof exercise.exercise === "object"
            ? exercise.exercise
            : exercise.exercise ?? exercise;

      const resolvedName =
        exercise.display_name ??
        rawExercise?.name ??
        exercise.exercise_name ??
        exercise.exerciseTitle ??
        exercise?.name ??
        exercise?.exercise_name ??
        `Exercise ${idx + 1}`;

      const resolvedMuscleGroup =
        rawExercise?.muscle_group ??
        exercise.exercise_muscle_group ??
        exercise?.muscle_group ??
        null;

      const resolvedId =
        exercise.id ??
        rawExercise?.id ??
        exercise.exercise_id ??
        exercise.workout_exercise_id ??
        `${post.id}-exercise-${idx}`;

      const resolvedImageUrl =
        rawExercise?.image_url ??
        exercise.exercise?.image_url ??
        exercise.exercises?.image_url ??
        exercise?.image_url ??
        null;

      return {
        ...exercise,
        id: resolvedId,
        exercise: {
          ...(rawExercise ?? {}),
          id: resolvedId,
          name: resolvedName,
          muscle_group: resolvedMuscleGroup,
          image_url: resolvedImageUrl,
        },
        exercises: {
          ...(rawExercise ?? {}),
          id: resolvedId,
          name: resolvedName,
          muscle_group: resolvedMuscleGroup,
          image_url: resolvedImageUrl,
        },
        display_name: resolvedName,
        image_url: resolvedImageUrl,
        sets: Array.isArray(exercise.sets)
          ? exercise.sets.map((set: any, setIndex: number) => ({
              ...set,
              set_no:
                typeof set?.set_no === "number" && set?.set_no > 0
                  ? set.set_no
                  : setIndex + 1,
              weight: set?.weight ?? null,
              left_weight: set?.left_weight ?? null,
              right_weight: set?.right_weight ?? null,
              left_reps: set?.left_reps ?? null,
              right_reps: set?.right_reps ?? null,
              left_rir: set?.left_rir ?? null,
              right_rir: set?.right_rir ?? null,
            }))
          : [],
      };
    });
  };

  const ensureSharedWorkoutData = useCallback(
    async (force: boolean) => {
      if (!post.show_workout_details || !post.workout_id) {
        setSharedWorkoutLoaded(false);
        return null;
      }

      if (!force && sharedWorkoutLoaded && workoutDetails.length > 0) {
        return workoutDetails;
      }

      try {
        setWorkoutDetailsLoading(true);
        const { data, error } = await supabase
          .from("workout_exercises")
          .select(
            `
              id,
              order_index,
              exercise_id,
              exercise:exercises!workout_exercises_exercise_id_fkey(id,name,muscle_group,is_unilateral,image_url),
              sets:sets(id,set_no,reps,weight,unit,rpe,rir,is_warmup,is_unilateral,left_weight,right_weight,left_reps,right_reps,left_rir,right_rir)
            `
          )
          .eq("workout_id", post.workout_id)
          .order("order_index", { ascending: true })
          .order("set_no", { ascending: true, foreignTable: "sets" });

        if (error) throw error;

        const fetched = Array.isArray(data) ? normalizeSharedDetails(data) : [];
        const existing = post.shared_workout_details?.length
          ? normalizeSharedDetails(post.shared_workout_details)
          : [];

        const mergedMap = new Map<string, any>();
        existing.forEach((item, idx) => {
          const key = String(item.id ?? `${post.id}-existing-${idx}`);
          mergedMap.set(key, item);
        });
        fetched.forEach((item, idx) => {
          const key = String(item.id ?? `${post.id}-fetched-${idx}`);
          mergedMap.set(key, item);
        });

        const mergedDetails = Array.from(mergedMap.values()).sort(
          (a, b) => (a.order_index ?? 0) - (b.order_index ?? 0)
        );

        const summary = summariseWorkoutDetails(mergedDetails);

        setWorkoutDetails(mergedDetails);
        setWorkoutSummary(summary);
        setSharedWorkoutLoaded(true);
        return mergedDetails;
      } catch (error) {
        console.error("Failed to load shared workout payload:", error);
        setWorkoutDetails([]);
        setWorkoutSummary({ exercises: 0, sets: 0, totalVolume: 0 });
        setSharedWorkoutLoaded(false);
        return null;
      } finally {
        setWorkoutDetailsLoading(false);
      }
    },
    [post.id, post.show_workout_details, post.workout_id, sharedWorkoutLoaded, workoutDetails.length, post.shared_workout_details]
  );

  useEffect(() => {
    loadLikes();
    loadComments();

    if (post.shared_workout_details && post.shared_workout_details.length > 0) {
      const normalized = normalizeSharedDetails(post.shared_workout_details);
      setWorkoutDetails(normalized);
      setWorkoutSummary(
        post.shared_workout_summary ?? summariseWorkoutDetails(normalized)
      );
      setSharedWorkoutLoaded(true);
      setWorkoutDetailsLoading(false);
    } else if (post.show_workout_details && post.workout_id) {
      void ensureSharedWorkoutData(false);
    } else {
      setWorkoutSummary({ exercises: 0, sets: 0, totalVolume: 0 });
      setWorkoutDetails([]);
      setSharedWorkoutLoaded(false);
    }
  }, [
    post.id,
    post.show_workout_details,
    post.workout_id,
    post.shared_workout_details,
    post.shared_workout_summary,
    ensureSharedWorkoutData,
    loadComments,
  ]);

  useEffect(() => {
    if (!focusedCommentId) {
      pendingFocusCommentId.current = null;
      hasRequestedCommentReload.current = false;
      return;
    }

    pendingFocusCommentId.current = focusedCommentId;
    hasRequestedCommentReload.current = false;
    setShowComments(true);
  }, [focusedCommentId]);

  useEffect(() => {
    const pendingId = pendingFocusCommentId.current;
    if (!pendingId) return;

    const commentExists = comments.some((comment) => String(comment.id) === pendingId);

    if (!commentExists) {
      if (!hasRequestedCommentReload.current) {
        hasRequestedCommentReload.current = true;
        void loadComments();
      } else {
        onCommentFocusHandled?.();
        pendingFocusCommentId.current = null;
        hasRequestedCommentReload.current = false;
      }
      return;
    }

    const element = document.getElementById(`comment-${pendingId}`);
    if (!element) return;

    const scrollTimeout = window.setTimeout(() => {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      onCommentFocusHandled?.();
      pendingFocusCommentId.current = null;
      hasRequestedCommentReload.current = false;
    }, 50);

    return () => {
      window.clearTimeout(scrollTimeout);
    };
  }, [comments, focusedCommentId, loadComments, onCommentFocusHandled]);

  useEffect(() => {
    const handlePostPublished = (event: Event) => {
      const detail = (event as CustomEvent)?.detail ?? {};
      const publishedPostId = detail.postId ?? detail.post?.id ?? null;
      const publishedWorkoutId = detail.workoutId ?? detail.post?.workout_id ?? null;

      if (
        publishedPostId &&
        (publishedPostId === post.id ||
          (post.workout_id && publishedWorkoutId === post.workout_id))
      ) {
        void ensureSharedWorkoutData(true);
      }
    };

    window.addEventListener("post:published", handlePostPublished as EventListener);
    return () => {
      window.removeEventListener("post:published", handlePostPublished as EventListener);
    };
  }, [post.id, post.workout_id, ensureSharedWorkoutData]);

  const handleLike = async () => {
    triggerHaptic();
    const previousLiked = liked;
    const previousLikeCount = likeCount;
    const nextLiked = !previousLiked;
    const nextLikeCount = Math.max(previousLikeCount + (nextLiked ? 1 : -1), 0);

    setLiked(nextLiked);
    setLikeCount(nextLikeCount);
    broadcastPostUpdate({ liked: nextLiked, likeCount: nextLikeCount });

    try {
      if (!nextLiked) {
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
      setLiked(previousLiked);
      setLikeCount(previousLikeCount);
      broadcastPostUpdate({ liked: previousLiked, likeCount: previousLikeCount });
      toast({
        title: "Error",
        description: "Failed to update like",
        variant: "destructive",
      });
    }
  };

  const handleComment = async () => {
    triggerHaptic();
    // Validate comment input
    const validation = commentSchema.safeParse(commentText);
    if (!validation.success) {
      toast({
        title: "Invalid comment",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    const previousCount = commentCount;
    const previousHasCommented = hasCommented;

    try {
      // Optimistic UI update
      const tempId = `temp-${Date.now()}`;
      const optimistic = {
        id: tempId,
        post_id: post.id,
        user_id: currentUserId,
        content: validation.data,
        created_at: new Date().toISOString(),
        public_profiles: { username: currentUserName || "You" },
      } as any;

      setShowComments(true);
      setComments((prev) => [...prev, optimistic]);
      setCommentText("");
      const nextCount = previousCount + 1;
      setCommentCount(nextCount);
      setHasCommented(true);
      broadcastPostUpdate({ commentCount: nextCount });

      const { error } = await supabase
        .from("comments" as any)
        .insert({
          post_id: post.id,
          user_id: currentUserId,
          content: validation.data,
        });

      if (error) throw error;

      // Sync with backend
      await loadComments();
      toast({ title: "Comment added" });
    } catch (error: any) {
      // Revert optimistic comment
      setComments((prev) => prev.filter((c: any) => !String(c.id).startsWith("temp-")));
      setCommentCount(previousCount);
      broadcastPostUpdate({ commentCount: previousCount });
      setHasCommented(previousHasCommented);
      toast({
        title: "Error",
        description: "Failed to add comment",
        variant: "destructive",
      });
    }
  };

  const handleToggleComments = () => {
    setShowComments(!showComments);
  };

  const handleToggleWorkoutDetails = async () => {
    triggerHaptic();
    if (!post.show_workout_details) {
      toast({
        title: "Workout details hidden",
        description: "The author chose to keep this workout private.",
      });
      return;
    }

    const isExpanding = !showWorkoutDetails;

    if (isExpanding && (!sharedWorkoutLoaded || workoutDetails.length === 0)) {
      const details = await ensureSharedWorkoutData(true);
      if (!details || details.length === 0) {
        toast({
          title: "No workout details",
          description: "We couldn't find any shared details for this workout.",
        });
      }
    }

    setShowWorkoutDetails((prev) => !prev);

    // Reset photo carousel index and scroll position when expanding
    if (isExpanding) {
      setCurrentImageIndex(0);
      // Reset carousel scroll position
      setTimeout(() => {
        if (carouselRef.current) {
          carouselRef.current.scrollLeft = 0;
        }
      }, 50);
    }

    // Auto-scroll to top of post when expanding
    if (isExpanding) {
      setTimeout(() => {
        postCardRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'start',
        });
      }, 100);
    }
  };

  const handleEditPost = async () => {
    const validation = postEditSchema.safeParse({
      title: editTitle,
      caption: editCaption,
    });

    if (!validation.success) {
      toast({
        title: "Invalid input",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from("posts")
        .update({
          title: validation.data.title,
          caption: validation.data.caption || null,
          image_urls: editImageUrls.length > 0 ? editImageUrls : null,
        })
        .eq("id", post.id);

      if (error) throw error;

      // Update local state
      post.title = validation.data.title;
      post.caption = validation.data.caption || null;
      post.image_urls = editImageUrls.length > 0 ? editImageUrls : null;
      setIsEditing(false);

      toast({
        title: "Post updated",
        description: "Your post has been updated successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error",
        description: "Failed to update post",
        variant: "destructive",
      });
    }
  };

  const handleCancelEdit = () => {
    setEditTitle(post.title);
    setEditCaption(post.caption || "");
    setEditImageUrls(post.image_urls || []);
    setIsEditing(false);
  };

  const handleDeletePost = async () => {
    try {
      const { data, error } = await supabase.functions.invoke<{
        success?: boolean;
        updatedPrs?: Array<{
          exercise_id: string;
          reps: number;
          weight: number;
          unit: "kg" | "lb";
          est_1rm: number | null;
          achieved_at: string;
          exercise_name?: string | null;
        }>;
        summary?: Record<string, any>;
        error?: string;
      }>("delete-post", {
        body: { postId: post.id },
      });

      if (error || data?.success === false) {
        throw new Error(
          error?.message ||
            data?.error ||
            "Failed to delete post",
        );
      }

      const updatedPrs = data?.updatedPrs ?? [];
      const prSummary = data?.summary ?? {};

      try {
        if (typeof window !== "undefined" && post.user_id && post.workout_id) {
          const deletedKey = "weightstone:deleted-workouts:v1";
          const rawDeleted = window.localStorage.getItem(deletedKey);
          const parsedDeleted = rawDeleted ? JSON.parse(rawDeleted) : {};
          const userDeleted =
            parsedDeleted && typeof parsedDeleted === "object" && parsedDeleted !== null
              ? parsedDeleted[post.user_id]
              : undefined;
          const nextUserDeleted =
            userDeleted && typeof userDeleted === "object"
              ? { ...userDeleted, [post.workout_id]: new Date().toISOString() }
              : { [post.workout_id]: new Date().toISOString() };
          const nextDeleted = {
            ...(parsedDeleted && typeof parsedDeleted === "object" ? parsedDeleted : {}),
            [post.user_id]: nextUserDeleted,
          };
          window.localStorage.setItem(deletedKey, JSON.stringify(nextDeleted));
        }
    } catch (metaError) {
      if (import.meta.env.DEV) console.warn("Failed to record deleted workout metadata");
      }

      try {
        if (typeof window !== "undefined" && post.user_id && post.workout_id) {
          const cacheKey = "weightstone:workout-session-cache:v1";
          const rawCache = window.localStorage.getItem(cacheKey);
          if (rawCache) {
            const parsed = JSON.parse(rawCache);
            if (parsed && typeof parsed === "object" && parsed !== null) {
              const userCache = parsed[post.user_id];
              if (userCache && typeof userCache === "object") {
                if (userCache[post.workout_id]) {
                  delete userCache[post.workout_id];
                  const nextCache =
                    Object.keys(userCache).length > 0
                      ? { ...parsed, [post.user_id]: userCache }
                      : Object.keys(parsed).reduce(
                          (acc: Record<string, unknown>, key: string) => {
                            if (key !== post.user_id) {
                              acc[key] = parsed[key];
                            }
                            return acc;
                          },
                          {}
                        );
                  if (Object.keys(nextCache).length === 0) {
                    window.localStorage.removeItem(cacheKey);
                  } else {
                    window.localStorage.setItem(cacheKey, JSON.stringify(nextCache));
                  }
                }
              }
            }
          }
        }
    } catch (cacheError) {
      if (import.meta.env.DEV) console.warn("Failed to clear workout session cache after post delete");
      }

      window.dispatchEvent(
        new CustomEvent("post:deleted", {
          detail: { postId: post.id, workoutId: post.workout_id },
        })
      );
      window.dispatchEvent(
        new CustomEvent("post:deleted:confirmed", {
          detail: {
            postId: post.id,
            workoutId: post.workout_id,
            updatedPrs,
            summary: prSummary,
          },
        })
      );
      window.dispatchEvent(
        new CustomEvent("pr:updated", {
          detail: {
            userId: post.user_id,
            prs: updatedPrs,
            summary: prSummary,
          },
        })
      );

      toast({
        title: "Post deleted",
        description: "Your post, workout data, and associated PRs have been deleted successfully",
      });

      if (onPostDeleted) {
        onPostDeleted();
      }
    } catch (error: any) {
      console.error("Failed to delete post:", error);
      window.dispatchEvent(
        new CustomEvent("post:delete:failed", {
          detail: { postId: post.id, workoutId: post.workout_id },
        })
      );
      toast({
        title: "Error",
        description: error?.message || "Failed to delete post",
        variant: "destructive",
      });
    }
  };

  const sessionMetricsArray: SessionMetrics[] = Array.isArray(post.session_metrics)
    ? (post.session_metrics.filter(Boolean) as SessionMetrics[])
    : post.session_metrics
    ? ([post.session_metrics] as SessionMetrics[])
    : [];
  const metrics: SessionMetrics | null =
    sessionMetricsArray.length > 0 ? (sessionMetricsArray[0] as SessionMetrics) : null;
  const sleepScore = parseNumericMetric(metrics?.sleep);
  const energyScore = parseNumericMetric(metrics?.mood);
  const sorenessAreaRaw = typeof metrics?.soreness_area === "string" ? metrics.soreness_area : null;
  const normalizedSorenessValue =
    typeof sorenessAreaRaw === "string" && sorenessAreaRaw.length > 0
      ? sorenessAreaRaw.toLowerCase()
      : null;
  const derivedPreWorkoutValue = derivePreWorkoutValue(metrics, {
    sleepScore,
    energyScore,
    normalizedSoreness: normalizedSorenessValue,
  });
  const preWorkoutStatus =
    derivedPreWorkoutValue === true ? "Yes" : derivedPreWorkoutValue === false ? "No" : null;

  const sorenessTag = (() => {
    if (!sorenessAreaRaw) return null;
    const mapping: Record<string, { icon: string; label: string }> = {
      none: { icon: "🌱", label: "Feeling fresh" },
      upper: { icon: "💪", label: "Upper body sore" },
      lower: { icon: "🦵", label: "Lower body sore" },
      full: { icon: "🔥", label: "Full body sore" },
    };
    const mapped = mapping[sorenessAreaRaw.toLowerCase()] ?? null;
    if (mapped) return mapped;
    const normalized =
      sorenessAreaRaw.length > 0
        ? sorenessAreaRaw.charAt(0).toUpperCase() + sorenessAreaRaw.slice(1)
        : "Body status";
    return { icon: "🩹", label: normalized };
  })();

  const hasSessionCheckIn = sessionMetricsArray.length > 0;
  const isOwnPost = post.user_id === currentUserId;

  const handleTogglePrivacy = async () => {
    if (!isOwnPost || privacyUpdating) return;
    const nextValue = !isPrivate;
    try {
      setPrivacyUpdating(true);
      const { error } = await supabase
        .from("posts")
        .update({ is_private: nextValue })
        .eq("id", post.id);

      if (error) throw error;

      setIsPrivate(nextValue);
      toast({
        title: nextValue ? "Post set to private" : "Post made public",
        description: nextValue
          ? "Only you can see this post now."
          : "Your post is visible to everyone.",
      });

      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("post:privacy-changed", {
            detail: { postId: post.id, isPrivate: nextValue },
          })
        );
      }
    } catch (error: any) {
      toast({
        title: "Privacy update failed",
        description: error?.message || "Unable to update post visibility",
        variant: "destructive",
      });
    } finally {
      setPrivacyUpdating(false);
    }
  };

  return (
    <Card ref={postCardRef} className={cn("mb-4 rounded-2xl border-2 shadow-lg transition-transform duration-100", !isSwiping && !showWorkoutDetails && "active:scale-[0.98]")} style={{ boxShadow: '0 20px 50px -5px hsl(var(--shadow-color-primary) / 0.5), 0 12px 25px -8px hsl(var(--shadow-color-secondary) / 0.4), 0 6px 15px -3px hsl(var(--shadow-color-primary) / 0.35), 0 0 0 1px hsl(var(--shadow-color-primary) / 0.15)' }}>
      <CardHeader>
        <div className="flex items-start sm:items-center gap-3">
          <Avatar
            className="cursor-pointer hover:opacity-80 transition-opacity"
            onClick={() => post.user_id !== currentUserId && navigate(`/user/${post.user_id}`)}
          >
            {post.public_profiles?.avatar_url && (
              <AvatarImage
                src={post.public_profiles.avatar_url}
                alt={post.public_profiles?.username || "User"}
                loading="lazy"
                cacheKey={post.user_id}
              />
            )}
            <AvatarFallback className="bg-primary text-primary-foreground">{post.public_profiles?.username?.[0] || "U"}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p
              className="font-semibold cursor-pointer hover:underline"
              onClick={() => post.user_id !== currentUserId && navigate(`/user/${post.user_id}`)}
            >
              {capitalizeUsername(post.public_profiles?.username) || "Unknown User"}
            </p>
            {isPrivate && (
              <Badge variant="secondary" className="w-max mt-1">
                Private
              </Badge>
            )}
            <p className="text-sm text-muted-foreground">
              {formatDistanceToNow(new Date(post.created_at), { addSuffix: true })}
            </p>
          </div>
          {isOwnPost && !isEditing && (
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={handleTogglePrivacy}
                className="h-8 w-8"
                disabled={privacyUpdating}
                title={isPrivate ? "Make post public" : "Make post private"}
              >
                {isPrivate ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsEditing(true)}
                className="h-8 w-8"
              >
                <Pencil className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isEditing ? (
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium mb-1 block">Title</label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Post title"
                maxLength={200}
                className="text-base"
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">Caption</label>
              <Textarea
                value={editCaption}
                onChange={(e) => setEditCaption(e.target.value)}
                placeholder="Add a caption... (optional)"
                maxLength={500}
                className="min-h-[80px]"
              />
            </div>
            <PostImageUpload
              postId={post.id}
              userId={post.user_id}
              existingImages={editImageUrls}
              onImagesChange={setEditImageUrls}
            />
            <div className="flex gap-2">
              <Button onClick={handleEditPost} size="sm">
                <Check className="h-4 w-4 mr-1" />
                Save
              </Button>
              <Button onClick={handleCancelEdit} variant="outline" size="sm">
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
              <Button 
                onClick={() => setShowDeleteDialog(true)} 
                variant="destructive" 
                size="sm"
                className="ml-auto"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                Delete
              </Button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="font-bold text-lg">{post.title}</h3>
            {post.caption && <p className="text-muted-foreground mt-1">{post.caption}</p>}
          </div>
        )}

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
          {showWorkoutDetails && (
            <div className="mt-4 space-y-3 border-t pt-3 animate-in fade-in slide-in-from-top-2 duration-200">
              {hasSessionCheckIn && (
                <PreWorkoutCheckInReview
                  metrics={metrics}
                  summary={{ sleepScore, energyScore, preWorkoutStatus, sorenessTag }}
                />
              )}
              {workoutDetailsLoading ? (
                <p className="text-xs text-muted-foreground">Loading workout details…</p>
              ) : workoutDetails.length === 0 ? (
                <p className="text-xs text-muted-foreground">No exercises logged for this workout.</p>
              ) : (
                workoutDetails.map((exercise: any, idx: number) => {
                  const exerciseInfo =
                    exercise.exercises ??
                    exercise.exercise ??
                    (exercise.exercise?.name ? exercise.exercise : null);
                  const rawExerciseName =
                    exercise.display_name ??
                    exerciseInfo?.name ??
                    exercise.exercise_name ??
                    exercise.exerciseTitle ??
                    exercise?.name ??
                    `Exercise ${idx + 1}`;
                  // Remove any existing "(Unilateral)" suffix to prevent duplication
                  const exerciseName = rawExerciseName.replace(/\s*\(Unilateral\)\s*$/i, '').trim();
                  const muscleGroup =
                    exerciseInfo?.muscle_group ??
                    exercise.exercise_muscle_group ??
                    exercise?.muscle_group ??
                    null;
                  const exerciseKey =
                    exercise.id ??
                    exerciseInfo?.id ??
                    exercise.exercise_id ??
                    exercise.workout_exercise_id ??
                    `${post.id}-exercise-${idx}`;
                  // Check if the exercise was actually performed unilaterally by checking the sets
                  const sets = exercise.sets ?? [];
                  const exerciseIsUnilateral = sets.some((set: any) =>
                    set.is_unilateral === true ||
                    (set.left_weight !== undefined && set.left_weight !== null) ||
                    (set.right_weight !== undefined && set.right_weight !== null) ||
                    (set.left_reps !== undefined && set.left_reps !== null) ||
                    (set.right_reps !== undefined && set.right_reps !== null) ||
                    // Also check camelCase versions for cached/local data
                    (set.leftWeight !== undefined && set.leftWeight !== null) ||
                    (set.rightWeight !== undefined && set.rightWeight !== null) ||
                    (set.leftReps !== undefined && set.leftReps !== null) ||
                    (set.rightReps !== undefined && set.rightReps !== null)
                  );
                  const imageUrl =
                    exerciseInfo?.image_url ??
                    exercise.exercise?.image_url ??
                    exercise.exercises?.image_url ??
                    exercise?.image_url ??
                    null;

                  return (
                    <div key={exerciseKey} className="space-y-2">
                      <div className="flex items-center gap-3">
                        {imageUrl && (
                          <div className="w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden flex-shrink-0 bg-muted">
                            <img
                              src={imageUrl}
                              alt={exerciseName}
                              className="w-full h-full object-cover"
                              loading="lazy"
                            />
                          </div>
                        )}
                        <div className="flex-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
                          <div className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                              {idx + 1}
                            </span>
                            <span className="leading-tight">
                              {exerciseName}
                              {exerciseIsUnilateral && <span className="text-muted-foreground font-normal text-sm"> (Unilateral)</span>}
                            </span>
                          </div>
                          {muscleGroup && (
                            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              {muscleGroup}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        {(exercise.sets ?? []).map((set: any, setIndex: number) => {
                          const setNumber =
                            typeof set?.set_no === "number" && set.set_no > 0
                              ? set.set_no
                              : setIndex + 1;
                          const setKey = `${setNumber}-${set?.id ?? `temp-${setIndex}`}`;
                          const unitLabel = set?.unit ?? "";
                          const normalizedWeight = set?.weight ?? "-";
                          const leftWeight = set?.left_weight ?? null;
                          const rightWeight = set?.right_weight ?? null;
                          const leftReps = set?.left_reps ?? null;
                          const rightReps = set?.right_reps ?? null;
                          const hasSideData = [
                            leftWeight,
                            rightWeight,
                            leftReps,
                            rightReps,
                            set?.left_rir,
                            set?.right_rir,
                          ].some((value) => value !== null && value !== undefined && value !== "");
                          const shouldShowUnilateral =
                            (Boolean(set?.is_unilateral) || exerciseIsUnilateral) && hasSideData;

                          const renderSideBlock = (
                            sideLabel: string,
                            weightValue: any,
                            repsValue: any,
                            _rirValue: any,
                          ) => (
                            <div className="flex flex-col rounded-lg border border-muted/60 bg-background/70 px-3 py-2 min-w-[140px]">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                {sideLabel}
                              </div>
                              <div className="mt-1 text-sm font-semibold text-foreground">
                                {formatNumericValue(weightValue)} {unitLabel || ""} × {formatNumericValue(repsValue, { integer: true })} reps
                              </div>
                            </div>
                          );

                          return (
                            <div
                              key={setKey}
                              className="text-xs flex flex-col gap-2 text-muted-foreground"
                            >
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center rounded-full border border-foreground/40 bg-foreground/10 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-foreground">
                                  Set {setNumber}
                                </span>
                                {set?.is_warmup && <span className="text-muted-foreground">Warm-up</span>}
                                {set?.rpe && <span>RPE {set.rpe}</span>}
                              </div>
                              {shouldShowUnilateral ? (
                                <div className="flex flex-col sm:flex-row gap-2">
                                  {renderSideBlock("Left", leftWeight, leftReps, set?.left_rir)}
                                  {renderSideBlock("Right", rightWeight, rightReps, set?.right_rir)}
                                </div>
                              ) : (
                                <div className="flex flex-col sm:flex-row gap-2">
                                  {renderSideBlock("Total", normalizedWeight, set?.reps, set?.rir)}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Post Images - Horizontal Scrollable Carousel */}
          {post.image_urls && post.image_urls.length > 0 && showWorkoutDetails && (
            <div className="mt-4 pt-4 border-t">
              {post.image_urls.length > 1 && (
                <div className="flex items-center justify-center mb-2">
                  <span className="text-xs font-medium text-muted-foreground bg-muted px-3 py-1 rounded-full">
                    Photos {currentImageIndex + 1} / {post.image_urls.length}
                  </span>
                </div>
              )}
              <div
                ref={carouselRef}
                className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-2"
                style={{ touchAction: 'pan-x' }}
                onTouchStart={(e) => {
                  e.stopPropagation();
                  touchStartX.current = e.touches[0].clientX;
                  touchStartY.current = e.touches[0].clientY;
                  // Set swiping true immediately to prevent Card active state
                  setIsSwiping(true);
                }}
                onTouchMove={(e) => {
                  e.stopPropagation();
                  const deltaX = Math.abs(e.touches[0].clientX - touchStartX.current);
                  const deltaY = Math.abs(e.touches[0].clientY - touchStartY.current);
                  // Keep swiping true during movement
                  if (deltaX > 10 && deltaX > deltaY) {
                    setIsSwiping(true);
                  }
                }}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  // Reset swiping state after a short delay to prevent click
                  setTimeout(() => setIsSwiping(false), 100);
                }}
                onScroll={(e) => {
                  const container = e.currentTarget;
                  const scrollLeft = container.scrollLeft;
                  const itemWidth = 280 + 12; // image width + gap
                  const index = Math.round(scrollLeft / itemWidth);
                  setCurrentImageIndex(Math.min(index, post.image_urls!.length - 1));
                }}
              >
                {post.image_urls.map((url, index) => (
                  <div
                    key={index}
                    className="relative flex-shrink-0 w-[280px] aspect-square rounded-lg overflow-hidden bg-muted cursor-pointer hover:opacity-90 transition-opacity snap-start"
                    onClick={() => {
                      setLightboxImageIndex(index);
                      setLightboxOpen(true);
                    }}
                  >
                    {/* PERFORMANCE: Optimized post images with Supabase transforms and lazy loading
                        IMPACT: ~60% smaller file sizes (800px width vs original), async decoding prevents blocking
                        WHY: Feed images don't need full resolution, reducing bandwidth and parse time */}
                    <img
                      src={getOptimizedPostImage(url, 'medium') || url}
                      alt={`Post image ${index + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>
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
          <Button
            variant="ghost"
            size="sm"
            onClick={handleToggleComments}
            className={cn(
              "transition-colors",
              hasCommented ? "text-black dark:text-white" : "text-muted-foreground"
            )}
          >
            <MessageCircle className={cn("h-4 w-4 mr-1", hasCommented && "fill-current")} />
            {commentCount}
          </Button>
        </div>

        {showComments && (
          <div className="space-y-3 pt-3 border-t animate-in fade-in duration-150">
            <div className="flex gap-2 mb-3">
              <Textarea
                placeholder="Add a comment..."
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                className="min-h-[60px]"
                maxLength={500}
              />
              <Button onClick={handleComment} size="sm" disabled={!commentText.trim()}>
                Post
              </Button>
            </div>
            {comments.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No comments yet. Be the first to comment!
              </p>
            ) : (
              <div className="space-y-3">
                {comments.map((comment) => (
                  <div
                    key={comment.id}
                    id={`comment-${comment.id}`}
                    className="flex gap-2 scroll-mt-24"
                  >
                    <Avatar
                      className="h-8 w-8 cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => comment.user_id !== currentUserId && navigate(`/user/${comment.user_id}`)}
                    >
                      {comment.public_profiles?.avatar_url && (
                        <AvatarImage
                          src={comment.public_profiles.avatar_url}
                          alt={comment.public_profiles?.username || "User"}
                          loading="lazy"
                          cacheKey={comment.user_id}
                        />
                      )}
                      <AvatarFallback className="text-xs">
                        {comment.public_profiles?.username?.[0] || "U"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 bg-muted rounded-lg p-3">
                      <p
                        className="font-semibold text-sm cursor-pointer hover:underline"
                        onClick={() => comment.user_id !== currentUserId && navigate(`/user/${comment.user_id}`)}
                      >
                        {capitalizeUsername(comment.public_profiles?.username) || "Unknown"}
                      </p>
                      <p className="text-sm mt-1">{comment.content}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {formatDistanceToNow(new Date(comment.created_at), { addSuffix: true })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Post</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this post? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeletePost} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Image Lightbox */}
      <Dialog open={lightboxOpen} onOpenChange={setLightboxOpen}>
        <DialogContent className="max-w-[95vw] max-h-[95vh] p-0 overflow-hidden bg-black border-0">
          <div
            className="relative w-full h-full flex overflow-x-auto snap-x snap-mandatory scrollbar-hide"
            style={{ scrollBehavior: 'smooth' }}
            onScroll={(e) => {
              if (!post.image_urls || post.image_urls.length <= 1) return;
              const container = e.currentTarget;
              const scrollLeft = container.scrollLeft;
              const itemWidth = container.clientWidth;
              const index = Math.round(scrollLeft / itemWidth);
              setLightboxImageIndex(index);
            }}
          >
            <button
              onClick={() => setLightboxOpen(false)}
              className="absolute top-4 right-4 z-50 p-2 rounded-full bg-black/50 text-white hover:bg-black/70 transition-colors"
            >
              <X className="h-6 w-6" />
            </button>
            {post.image_urls && post.image_urls.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/70 text-white text-sm">
                {lightboxImageIndex + 1} / {post.image_urls.length}
              </div>
            )}
            {post.image_urls?.map((url, index) => (
              <div
                key={index}
                className="flex-shrink-0 w-full h-full flex items-center justify-center snap-start"
              >
                {/* PERFORMANCE: Lightbox uses larger images (1200px) but still optimized via Supabase
                    IMPACT: Full-screen quality maintained while avoiding multi-MB original files
                    WHY: User expects high quality in lightbox, but 1200px is sufficient for most displays */}
                <img
                  src={getOptimizedPostImage(url, 'large') || url}
                  alt={`Post image ${index + 1}`}
                  className="max-w-full max-h-[95vh] object-contain"
                  decoding="async"
                />
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
});

export default PostCard;
