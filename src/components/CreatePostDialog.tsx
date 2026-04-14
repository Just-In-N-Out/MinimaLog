import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession, getCachedUserId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { PostImageUpload } from "@/components/PostImageUpload";
import { shouldUseOfflineMode } from "@/lib/network";
import { getDB } from "@/lib/db/indexedDB";
import { stopLiveActivity } from "@/lib/liveActivity";

const postSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  caption: z.string().trim().max(1000, "Caption must be less than 1000 characters").optional(),
});

interface CreatePostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string;
  // workoutExercises?: any[]; // TODO: Re-enable when shared_workout_details column is added to posts table
  beforeShare?: () => Promise<void>;
  onSuccess: () => void;
}

export default function CreatePostDialog({
  open,
  onOpenChange,
  workoutId,
  // workoutExercises, // TODO: Re-enable when shared_workout_details column is added
  beforeShare,
  onSuccess,
}: CreatePostDialogProps) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const showWorkoutDetails = true; // Always show workout details
  const [loading, setLoading] = useState(false);
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imageFiles, setImageFiles] = useState<File[]>([]);
  const [userId, setUserId] = useState<string>("");

  // Get userId on component mount
  useEffect(() => {
    const resolveUserId = async () => {
      const session = await getSupabaseSession();
      if (session?.user?.id) {
        setUserId(session.user.id);
        return;
      }

      const cachedId = await getCachedUserId();
      if (cachedId) {
        setUserId(cachedId);
      }
    };

    void resolveUserId();
  }, []);

  const resetForm = () => {
    setTitle("");
    setCaption("");
    setImageUrls([]);
    setImageFiles([]);
  };


  const handleSubmit = async () => {
    const validation = postSchema.safeParse({
      title,
      caption: caption || undefined,
    });

    if (!validation.success) {
      toast({
        title: "Invalid input",
        description: validation.error.errors[0].message,
        variant: "destructive",
      });
      return;
    }
  
    setLoading(true);
    try {
      const useOffline = shouldUseOfflineMode();

      try {
        await stopLiveActivity();
      } catch (error) {
        if (import.meta.env.DEV) {
          console.warn("[CreatePostDialog] Failed to stop live activity before posting:", error);
        }
      }

      if (beforeShare) {
        await beforeShare();
      }
  
      const session = await getSupabaseSession();
      const supabaseUser = session?.user ?? null;
      const accessToken = session?.access_token ?? null;
      let resolvedUserId = supabaseUser?.id || userId || null;
  
      if (!resolvedUserId && useOffline) {
        resolvedUserId = (await getCachedUserId()) || null;
      }
  
      if (!resolvedUserId) {
        throw new Error("Not authenticated");
      }
  
      if (!workoutId) throw new Error("Workout ID is required");
  
      const queueOfflinePost = async (reason: string) => {
        console.log(`[CreatePost] Queueing post offline (${reason})`);
  
        const imageBlobs: Blob[] = imageFiles.length
          ? imageFiles.map((file) => file.slice(0, file.size, file.type))
          : [];
  
        const tempPostId = `temp-post-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  
        const db = await getDB();
        await db.put("pendingPosts", {
          id: tempPostId,
          userId: resolvedUserId,
          workoutId,
          title: validation.data.title,
          caption: validation.data.caption || "",
          imageBlobs,
          isPrivate: false,
          showWorkoutDetails,
          createdAt: new Date().toISOString(),
          synced: false,
        });
  
        toast({
          title: "Post queued",
          description: "We'll publish this automatically once you're back online.",
        });
  
        resetForm();
        onOpenChange(false);
        onSuccess();
      };
  
      if (useOffline || !accessToken) {
        await queueOfflinePost(useOffline ? "offline-mode" : "missing-access-token");
        return;
      }
  
      let workoutSynced = true;
      try {
        const { data: workoutExists, error: checkError } = await supabase
          .from("workouts")
          .select("id")
          .eq("id", workoutId)
          .single();
  
        workoutSynced = Boolean(workoutExists) && !checkError;
      } catch (error) {
        workoutSynced = false;
      }
  
      if (!workoutSynced) {
        await queueOfflinePost("workout-not-synced");
        return;
      }
  
      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Note: shared_workout_details would be ideal here to snapshot the current state,
      // but the column doesn't exist in the posts table yet.
      // The post card will fetch from the database, which should now have correct data
      // after handleCompleteWorkout() is called in beforeShare

      const postData = {
        user_id: resolvedUserId,
        workout_id: workoutId,
        title: validation.data.title,
        caption: validation.data.caption || null,
        show_workout_details: showWorkoutDetails,
      };
  
      console.log("Creating post with data:", postData);
  
      const response = await fetch(`${supabaseUrl}/rest/v1/posts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
          Prefer: "return=representation",
        },
        body: JSON.stringify(postData),
      });
  
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("Post creation error:", errorData);
        const errorMessage =
          errorData?.message || errorData?.hint || errorData?.details || "Failed to create post";
        throw new Error(errorMessage);
      }
  
      const responseData = await response.json();
      const postId = responseData?.[0]?.id;
  
      if (imageFiles.length > 0 && postId) {
        const uploadedUrls: string[] = [];
  
        for (const file of imageFiles) {
          const base64Data = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const result = reader.result as string;
              const base64 = result.split(",")[1];
              resolve(base64);
            };
            reader.onerror = () => reject(new Error("Failed to read file"));
            reader.readAsDataURL(file);
          });
  
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const uploadBlob = new Blob([byteArray], { type: "image/jpeg" });
  
          const timestamp = Date.now();
          const randomSuffix = Math.random().toString(36).substring(2, 9);
          const fileName = `${resolvedUserId}/${postId}/${timestamp}-${randomSuffix}.jpeg`;
  
          const { error: uploadError } = await supabase.storage
            .from("post-images")
            .upload(fileName, uploadBlob, {
              contentType: "image/jpeg",
              upsert: false,
            });
  
          if (uploadError) {
            console.error("Upload error:", uploadError);
            throw uploadError;
          }
  
          const publicUrl = `${supabaseUrl}/storage/v1/object/public/post-images/${fileName}`;
          uploadedUrls.push(publicUrl);
        }
  
        if (uploadedUrls.length > 0) {
          const { error: updateError } = await supabase
            .from("posts")
            .update({ image_urls: uploadedUrls })
            .eq("id", postId);
  
          if (updateError) {
            console.error("Failed to update post with image URLs:", updateError);
          }
        }
      }
  
      toast({
        title: "Post created!",
        description: "Your workout has been shared",
      });
  
      setTimeout(() => {
        window.dispatchEvent(
          new CustomEvent("post:created", {
            detail: { postId, workoutId },
          })
        );
      }, 100);
  
      resetForm();
      onOpenChange(false);
      onSuccess();
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create post",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showClose={false}
        className="w-[calc(100vw-3rem)] max-w-sm sm:w-auto sm:max-w-md border-[3px] border-foreground/30 shadow-lg shadow-black/5 rounded-[28px] max-h-[90vh] flex flex-col"
      >
        <DialogHeader>
          <DialogTitle>Share Your Workout</DialogTitle>
          <DialogDescription>
            Let your friends know about your training session
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-2 overflow-y-auto flex-1 pr-2 -mr-2">
          <div className="space-y-2 px-1">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Leg Day Smashed!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="pl-4 w-[calc(100%-0.5rem)]"
            />
          </div>
          <div className="space-y-2 px-1">
            <Label htmlFor="caption">Caption (optional)</Label>
            <Textarea
              id="caption"
              placeholder="Feeling strong today..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
              className="w-[calc(100%-0.5rem)]"
            />
          </div>
          <PostImageUpload
            userId={userId}
            existingImages={imageUrls}
            onImagesChange={setImageUrls}
            onFilesChange={setImageFiles}
          />
          <div className="flex gap-2 justify-end">
            <Button onClick={handleSubmit} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Share
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
