import { useEffect, useRef } from "react";
import { syncOfflineData, syncPendingPosts } from "@/lib/sync/syncEngine";
import { getSupabaseSession, getCachedUserId } from "@/lib/session";
import { useToast } from "@/hooks/use-toast";
import { processPendingImageDownloads } from "@/lib/cache/exerciseImageFilesystemCache";

/**
 * Simplified background sync manager - runs on mount
 * Network detection removed for TestFlight compatibility
 */
export const BackgroundSyncManager = () => {
  const { toast } = useToast();
  const isSyncingRef = useRef(false);
  const hasRunInitialSync = useRef(false);

  useEffect(() => {
    // Only run once on mount
    if (hasRunInitialSync.current) return;
    hasRunInitialSync.current = true;

    let cancelled = false;

    const runSync = async () => {
      if (isSyncingRef.current) return;
      isSyncingRef.current = true;
      try {
        const session = await getSupabaseSession();
        const userId = session?.user?.id ?? (await getCachedUserId());
        if (!userId) return;

        // Run image downloads in parallel with data+posts sync (hybrid parallelization)
        const [{ result, postCount }, imageResult] = await Promise.all([
          (async () => {
            const result = await syncOfflineData(userId);
            const postCount = await syncPendingPosts(userId);
            return { result, postCount };
          })(),
          processPendingImageDownloads()
        ]);

        if (!cancelled && (result.success > 0 || postCount > 0 || imageResult.success > 0)) {
          const descriptionParts = [];
          if (result.success > 0) {
            descriptionParts.push(`${result.success} workout updates`);
          }
          if (postCount > 0) {
            descriptionParts.push(`${postCount} post${postCount === 1 ? "" : "s"}`);
          }
          if (imageResult.success > 0) {
            descriptionParts.push(`${imageResult.success} image cache updates`);
          }
          toast({
            title: "Synced",
            description: descriptionParts.join(" & ") || "Offline data synced",
          });
        }
      } catch (error: any) {
        if (!cancelled) {
          console.error('[BackgroundSync] Sync failed:', error);
          // Silent fail - don't show toast for initial sync failures
        }
      } finally {
        isSyncingRef.current = false;
      }
    };

    runSync();

    return () => {
      cancelled = true;
    };
  }, [toast]);

  return null;
};
