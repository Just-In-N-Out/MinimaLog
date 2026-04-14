import { useState, useEffect, startTransition } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell, Heart, MessageCircle, UserPlus, CheckCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

interface Notification {
  id: string;
  type: "like" | "comment" | "follow" | "follow_request" | "follow_accepted";
  actor_id: string;
  post_id: string | null;
  comment_id: string | null;
  read: boolean;
  resolved?: boolean;
  created_at: string;
  actor_name?: string;
  actor_avatar_url?: string | null;
  request_resolution?: "accepted" | "declined";
}

interface NotificationsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
}

export const NotificationsDialog = ({ open, onOpenChange, userId }: NotificationsDialogProps) => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const [requestProcessing, setRequestProcessing] = useState<Record<string, "accept" | "decline">>({});

  useEffect(() => {
    if (!open) {
      // Reset state when dialog closes
      setNotifications([]);
      setLoading(false);
      return;
    }

    // Show loading immediately when dialog opens
    setLoading(true);

    // Fire-and-forget mark as read (non-blocking)
    supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .then(() => {
        console.log("Notifications marked as read");
      })
      .catch((error) => {
        console.error("Failed to mark notifications as read:", error);
      });

    // Load notifications with startTransition to keep UI responsive
    // Use setTimeout to ensure dialog renders first
    setTimeout(() => {
      startTransition(() => {
        loadNotifications();
      });
    }, 0);
  }, [open, userId]);

  const loadNotifications = async () => {
    try {
      setLoading(true);

      // Fetch only the most recent 20 notifications for fast initial load
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .or("type.neq.follow_request,resolved.eq.false")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) throw error;
      if (!data || data.length === 0) {
        setNotifications([]);
        setLoading(false);
        return;
      }

      // Parallel fetch for actor names and follow statuses (much faster than sequential)
      const actorIds = [...new Set(data.map((n: any) => n.actor_id))];
      const followRequestNotifications = data.filter((n: any) => n.type === "follow_request");

      const [profilesResult, followsResult] = await Promise.all([
        supabase
          .from("public_profiles")
          .select("id, username, avatar_url")
          .in("id", actorIds),
        followRequestNotifications.length > 0
          ? supabase
              .from("follows")
              .select("follower_id, following_id, status")
              .eq("following_id", userId)
              .in("follower_id", followRequestNotifications.map((n: any) => n.actor_id))
          : Promise.resolve({ data: null }),
      ]);

      const profileMap = new Map(
        profilesResult.data?.map((p: any) => [p.id, { username: p.username, avatar_url: p.avatar_url }]) || []
      );
      const followStatuses = new Map();

      followsResult.data?.forEach((f: any) => {
        followStatuses.set(f.follower_id, f.status);
      });

      const enrichedNotifications = data.map((n: any) => {
        const actorProfile = profileMap.get(n.actor_id);
        const notification: Notification = {
          ...n,
          actor_name: actorProfile?.username || "Someone",
          actor_avatar_url: actorProfile?.avatar_url || null,
        };

        // For follow_request notifications, mark them as resolved based on current follow status
        if (n.type === "follow_request") {
          const status = followStatuses.get(n.actor_id);
          if (status === "accepted") {
            notification.request_resolution = "accepted";
          } else if (status === "rejected") {
            notification.request_resolution = "declined";
          }
          // If status is "pending" or no status, don't set request_resolution (will show action buttons)
        }

        return notification;
      });

      setNotifications(enrichedNotifications);
    } catch (error) {
      console.error("Failed to load notifications:", error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (notificationId: string) => {
    try {
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("id", notificationId);

      setNotifications(
        notifications.map((n) =>
          n.id === notificationId ? { ...n, read: true } : n
        )
      );
    } catch (error) {
      console.error("Failed to mark notification as read:", error);
    }
  };

  const handleFollowRequestAction = async (
    notification: Notification,
    action: "accept" | "decline"
  ) => {
    setRequestProcessing((prev) => ({ ...prev, [notification.id]: action }));

    try {
      console.log(`[Follow Request] ${action}ing request from`, notification.actor_id, "to", userId);

      if (action === "accept") {
        // First, check if the follow exists
        const { data: existingFollow, error: checkError } = await supabase
          .from("follows")
          .select("*")
          .eq("follower_id", notification.actor_id)
          .eq("following_id", userId)
          .maybeSingle();

        console.log("[Follow Request] Existing follow check:", { existingFollow, checkError });

        if (!existingFollow) {
          console.error("[Follow Request] No follow record found!");
          throw new Error("Follow record not found. It may have been deleted.");
        }

        if (existingFollow.status === "accepted") {
          console.warn("[Follow Request] Already accepted!");
          toast({ title: "Already accepted", description: "This request was already processed." });
          return;
        }

        // Now update it
        const { error, data } = await supabase
          .from("follows")
          .update({ status: "accepted" })
          .eq("follower_id", notification.actor_id)
          .eq("following_id", userId)
          .eq("status", "pending")
          .select();

        console.log("[Follow Request] Update result:", { data, error, updatedRows: data?.length });
        if (error) throw error;

        if (!data || data.length === 0) {
          console.error("[Follow Request] No rows updated - follow may not exist or already accepted");
          throw new Error("Follow request not found or already processed");
        }

        toast({ title: "Request accepted" });

        // Broadcast event so Profile page can refresh follower count
        window.dispatchEvent(
          new CustomEvent("follow-request-accepted", {
            detail: { follower_id: notification.actor_id, following_id: userId },
          })
        );
      } else {
        // Update status to rejected instead of deleting
        const { error } = await supabase
          .from("follows")
          .update({ status: "rejected" })
          .eq("follower_id", notification.actor_id)
          .eq("following_id", userId)
          .eq("status", "pending");
        if (error) throw error;
        toast({ title: "Request declined" });
      }

      // Mark as read and resolved in the database
      const { error: updateError } = await supabase
        .from("notifications")
        .update({ read: true, resolved: true })
        .eq("id", notification.id);

      if (updateError) {
        console.error("Failed to mark notification as resolved:", updateError);
        throw updateError;
      }

      // Update local state to hide the notification
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id
            ? {
                ...n,
                read: true,
                resolved: true,
                request_resolution: action === "accept" ? "accepted" : "declined",
              }
            : n
        )
      );
    } catch (error) {
      console.error("Failed to process follow request:", error);

      // Still update the UI optimistically even if there was an error
      // This handles cases where the operation succeeded but we got a network error
      setNotifications((prev) =>
        prev.map((n) =>
          n.id === notification.id
            ? {
                ...n,
                read: true,
                resolved: true,
                request_resolution: action === "accept" ? "accepted" : "declined",
              }
            : n
        )
      );

      toast({
        title: "Action may have failed",
        description: "The request was processed but there was an error. Please refresh to verify.",
        variant: "destructive",
      });
    } finally {
      setRequestProcessing((prev) => {
        const next = { ...prev };
        delete next[notification.id];
        return next;
      });
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    await markAsRead(notification.id);
    
    onOpenChange(false);

    if (
      notification.type === "follow" ||
      notification.type === "follow_request" ||
      notification.type === "follow_accepted"
    ) {
      navigate(`/user/${notification.actor_id}`);
      return;
    }

    if (!notification.post_id) return;

    if (notification.type === "comment" && notification.comment_id) {
      navigate(`/?postId=${notification.post_id}&commentId=${notification.comment_id}`);
      return;
    }

    navigate(`/?postId=${notification.post_id}`);
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "like":
        return <Heart className="h-5 w-5 text-red-500" />;
      case "comment":
        return <MessageCircle className="h-5 w-5 text-blue-500" />;
      case "follow":
        return <UserPlus className="h-5 w-5 text-green-500" />;
      case "follow_request":
        return <UserPlus className="h-5 w-5 text-amber-500" />;
      case "follow_accepted":
        return <CheckCircle className="h-5 w-5 text-emerald-500" />;
      default:
        return <Bell className="h-5 w-5" />;
    }
  };

  const getNotificationText = (notification: Notification) => {
    switch (notification.type) {
      case "like":
        return "liked your workout";
      case "comment":
        return "commented on your workout";
      case "follow":
        return "started following you";
      case "follow_request":
        return "requested to follow you";
      case "follow_accepted":
        return "accepted your follow request";
      default:
        return "interacted with you";
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[85vw] max-w-xs sm:max-w-sm rounded-3xl border border-primary/20 shadow-xl bg-background/95 backdrop-blur" showClose={false}>
        <DialogHeader>
          <DialogTitle>Notifications</DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] sm:max-h-[75vh] pr-4">
          {loading ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-lg">
                  <div className="h-10 w-10 rounded-full bg-muted/50 animate-pulse flex-shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-4 bg-muted/50 rounded animate-pulse w-3/4" />
                    <div className="h-3 bg-muted/50 rounded animate-pulse w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Bell className="h-12 w-12 mx-auto mb-2 opacity-50" />
              <p>No notifications yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  onClick={() => handleNotificationClick(notification)}
                  className={`flex items-start gap-3 p-3 rounded-lg cursor-pointer hover:bg-muted/50 transition-colors ${
                    !notification.read ? "bg-muted/30" : ""
                  }`}
                >
                  <Avatar className="h-10 w-10 flex-shrink-0">
                    {notification.actor_avatar_url && (
                      <AvatarImage
                        src={notification.actor_avatar_url}
                        alt={notification.actor_name || "User"}
                        loading="lazy"
                        cacheKey={notification.actor_id}
                      />
                    )}
                    <AvatarFallback className="bg-muted">
                      {getNotificationIcon(notification.type)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    {(() => {
                      const processing = requestProcessing[notification.id];
                      return (
                        <>
                    <p className="text-sm">
                      <span 
                        className="font-semibold hover:underline cursor-pointer"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenChange(false);
                          navigate(`/user/${notification.actor_id}`);
                        }}
                      >
                        {notification.actor_name}
                      </span>{" "}
                      {getNotificationText(notification)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {formatDistanceToNow(new Date(notification.created_at), {
                        addSuffix: true,
                      })}
                    </p>
                    {notification.type === "follow_request" && (
                      <div className="mt-3 space-y-2">
                        {!notification.request_resolution ? (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1"
                              disabled={Boolean(processing)}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFollowRequestAction(notification, "accept");
                              }}
                            >
                              {processing === "accept" ? "Accepting..." : "Accept"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              disabled={Boolean(processing)}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFollowRequestAction(notification, "decline");
                              }}
                            >
                              {processing === "decline" ? "Declining..." : "Decline"}
                            </Button>
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {notification.request_resolution === "accepted"
                              ? "You accepted this request"
                              : "You declined this request"}
                          </p>
                        )}
                      </div>
                    )}
                        </>
                      );
                    })()}
                  </div>
                  {!notification.read && (
                    <div className="h-2 w-2 rounded-full bg-primary flex-shrink-0 mt-2" />
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
};
