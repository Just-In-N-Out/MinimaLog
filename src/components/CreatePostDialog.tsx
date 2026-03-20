import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { z } from "zod";

const postSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(200, "Title must be less than 200 characters"),
  caption: z.string().trim().max(1000, "Caption must be less than 1000 characters").optional(),
});

interface CreatePostDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workoutId: string;
  onSuccess: () => void;
}

export default function CreatePostDialog({
  open,
  onOpenChange,
  workoutId,
  onSuccess,
}: CreatePostDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [showWorkoutDetails, setShowWorkoutDetails] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    // Validate input
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

    if (!user) return;
    setLoading(true);
    try {

      const { error } = await supabase.from("posts" as any).insert({
        user_id: user.id,
        workout_id: workoutId,
        title: validation.data.title,
        caption: validation.data.caption || null,
        show_workout_details: showWorkoutDetails,
      });

      if (error) throw error;

      toast({
        title: "Post created!",
        description: "Your workout has been shared",
      });

      setTitle("");
      setCaption("");
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Share Your Workout</DialogTitle>
          <DialogDescription>
            Let your friends know about your training session
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Leg Day Smashed!"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="caption">Caption (optional)</Label>
            <Textarea
              id="caption"
              placeholder="Feeling strong today..."
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              rows={3}
            />
          </div>
          <div className="flex items-center justify-between space-x-2">
            <div className="space-y-0.5">
              <Label htmlFor="show-details">Show workout details</Label>
              <p className="text-sm text-muted-foreground">
                Allow others to see your exercises, sets, and weights
              </p>
            </div>
            <Switch
              id="show-details"
              checked={showWorkoutDetails}
              onCheckedChange={setShowWorkoutDetails}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Skip
            </Button>
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
