import { useEffect, useState } from 'react';
import { useNetworkStore } from '@/lib/network';
import { getPendingOperationCount } from '@/lib/db/operationQueue';
import { syncOfflineData, syncPendingPosts } from '@/lib/sync/syncEngine';
import { getDB } from '@/lib/db/indexedDB';
import { WifiOff, CloudOff, RefreshCw, Check, Wifi, Info } from 'lucide-react';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { vLog } from './VisualDebugLogger';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';

interface SyncStatusIndicatorProps {
  userId: string;
  className?: string;
}

export const SyncStatusIndicator = ({ userId, className }: SyncStatusIndicatorProps) => {
  const isOnline = useNetworkStore((state) => state.isOnline);
  const isHighQuality = useNetworkStore((state) => state.isHighQuality);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const { toast } = useToast();

  // Poll for pending operations and posts count
  useEffect(() => {
    const checkPending = async () => {
      try {
        // Get pending operations count
        const operationsCount = await getPendingOperationCount(userId);

        // Get pending posts count
        let postsCount = 0;
        try {
          const db = await getDB();
          const pendingPosts = await db.getAllFromIndex('pendingPosts', 'by-user-synced', [userId, false]);
          postsCount = pendingPosts.length;
        } catch (error) {
          console.error('[SyncStatus] Failed to check pending posts:', error);
        }

        // Total pending items
        const totalPending = operationsCount + postsCount;
        setPendingCount(totalPending);

        if (totalPending > 0) {
          console.log('[SyncStatus] Pending items:', { operations: operationsCount, posts: postsCount, total: totalPending });
        }
      } catch (error) {
        console.error('[SyncStatus] Failed to check pending count:', error);
      }
    };

    checkPending();
    const interval = setInterval(checkPending, 5000); // Check every 5s

    return () => clearInterval(interval);
  }, [userId]);

  // Auto-sync when coming online
  useEffect(() => {
    if (isOnline && isHighQuality && pendingCount > 0 && !syncing) {
      vLog.info('Sync', 'Auto-sync triggered (connection restored)', { pendingCount });
      handleSync();
    }
  }, [isOnline, isHighQuality, pendingCount]);

  // Listen for sync-complete events
  useEffect(() => {
    const handleSyncComplete = (event: any) => {
      const result = event.detail;

      if (result.success > 0) {
        toast({
          title: 'Sync complete',
          description: `${result.success} operations synced successfully`,
        });
      }

      if (result.failed > 0) {
        toast({
          title: 'Sync partially failed',
          description: `${result.failed} operations failed to sync`,
          variant: 'destructive',
        });
      }

      setPendingCount(0);
    };

    window.addEventListener('sync-complete', handleSyncComplete as EventListener);
    return () => window.removeEventListener('sync-complete', handleSyncComplete as EventListener);
  }, [toast]);

  const handleSync = async () => {
    setSyncing(true);
    vLog.info('Sync', 'Starting sync...', { userId });
    try {
      // First sync workout operations (workouts, exercises, sets)
      vLog.info('Sync', 'Syncing workout operations...', {});
      const result = await syncOfflineData(userId);
      vLog.success('Sync', `✓ Workout operations synced`, { success: result.success, failed: result.failed });

      // Then sync pending posts (after workouts are synced to ensure dependencies exist)
      let postsSynced = 0;
      try {
        vLog.info('Sync', 'Syncing pending posts...', {});
        postsSynced = await syncPendingPosts(userId);
        vLog.success('Sync', `✓ Posts synced`, { count: postsSynced });
        console.log('[SyncStatus] Synced pending posts:', postsSynced);
      } catch (postError) {
        vLog.error('Sync', 'Failed to sync posts', postError);
        console.error('[SyncStatus] Failed to sync pending posts:', postError);
        // Don't fail the entire sync if posts fail
      }

      // Show appropriate toast based on what was synced
      if (postsSynced > 0) {
        toast({
          title: 'Sync complete',
          description: `${result.success} operations and ${postsSynced} ${postsSynced === 1 ? 'post' : 'posts'} synced. ${result.failed > 0 ? `${result.failed} failed.` : ''}`,
          variant: result.failed > 0 ? 'destructive' : 'default',
        });
      } else if (result.success > 0 || result.failed > 0) {
        toast({
          title: 'Sync complete',
          description: `${result.success} operations synced. ${result.failed} failed.`,
          variant: result.failed > 0 ? 'destructive' : 'default',
        });
      }

      vLog.success('Sync', '✓ All sync operations complete', { postsSynced, operations: result.success });
      setPendingCount(0);
    } catch (error: any) {
      vLog.error('Sync', 'Sync failed', error);
      console.error('[SyncStatus] Sync failed:', error);
      toast({
        title: 'Sync failed',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
      vLog.info('Sync', 'Sync process ended', {});
    }
  };

  // All synced and online
  if (isOnline && pendingCount === 0) {
    return (
      <div className={cn('flex items-center gap-2 text-green-600 text-sm', className)}>
        <Check className="h-4 w-4" />
        <span className="hidden sm:inline">Synced</span>
      </div>
    );
  }

  // Offline - only show when truly no connection
  if (!isOnline) {
    return (
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'flex items-center gap-2 text-orange-500 text-sm cursor-pointer hover:text-orange-600 transition-colors',
              className
            )}
          >
            <WifiOff className="h-4 w-4" />
            <span className="hidden sm:inline">Offline</span>
            {pendingCount > 0 && (
              <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-80" side="bottom" align="end">
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <WifiOff className="h-5 w-5 text-orange-500 mt-0.5 flex-shrink-0" />
              <div>
                <h4 className="font-semibold text-sm mb-1">You're Offline</h4>
                <p className="text-sm text-muted-foreground">
                  No internet connection detected. Don't worry - you can still use the app!
                </p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">What you can do offline:</p>
              <ul className="space-y-1 ml-4 list-disc">
                <li>Start and complete workouts</li>
                <li>Add, edit, and delete sets</li>
                <li>Create workout posts</li>
                <li>View cached templates and history</li>
              </ul>
            </div>

            {pendingCount > 0 && (
              <div className="pt-2 border-t">
                <div className="flex items-center gap-2 text-sm">
                  <Info className="h-4 w-4 text-orange-500" />
                  <span className="font-medium">
                    {pendingCount} {pendingCount === 1 ? 'item' : 'items'} waiting to sync
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 ml-6">
                  Your changes will automatically sync when you're back online
                </p>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    );
  }

  // Online with pending operations
  if (pendingCount > 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleSync}
        disabled={syncing}
        className={cn('flex items-center gap-2', className)}
      >
        {syncing ? (
          <>
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Syncing...</span>
          </>
        ) : (
          <>
            <CloudOff className="h-4 w-4" />
            <span>Sync {pendingCount}</span>
          </>
        )}
      </Button>
    );
  }

  return null;
};
