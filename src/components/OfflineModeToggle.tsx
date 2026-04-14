import { useNetworkStore } from '@/lib/network';
import { Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { getSupabaseSession } from '@/lib/session';
import { syncOfflineData, syncPendingPosts } from '@/lib/sync/syncEngine';
import { useCallback, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { vLog } from '@/components/VisualDebugLogger';

/**
 * Debug toggle for testing offline mode
 * Shows in development mode OR on mobile devices (for TestFlight testing)
 */
export const OfflineModeToggle = () => {
  console.log('[OfflineModeToggle] Component rendered');

  // Show in development OR on mobile platforms (iOS/Android for TestFlight)
  const isMobile = Capacitor.isNativePlatform();
  if (!import.meta.env.DEV && !isMobile) {
    return null;
  }

  const { debugOfflineMode, isOnline, connectionType, isHighQuality, setDebugOfflineMode } = useNetworkStore();
  const { toast } = useToast();

  console.log('[OfflineModeToggle] State:', { debugOfflineMode, isOnline, connectionType, isHighQuality });

  // Log network status on mount and when it changes
  useEffect(() => {
    vLog.info('OfflineModeToggle', 'Network status', {
      debugOfflineMode,
      isOnline,
      connectionType,
      isHighQuality,
      platform: isMobile ? 'mobile' : 'web'
    });
  }, [debugOfflineMode, isOnline, connectionType, isHighQuality, isMobile]);

  const handleToggle = useCallback(async () => {
    console.log('[Debug] Toggle button clicked!');
    vLog.info('OfflineModeToggle', '🔘 Toggle button clicked', {});

    const wasOffline = debugOfflineMode;
    const willBeOffline = !debugOfflineMode;

    console.log('[Debug] State transition:', { wasOffline, willBeOffline });
    setDebugOfflineMode(willBeOffline);

    vLog.success('OfflineModeToggle', willBeOffline ? '🔴 OFFLINE MODE ENABLED' : '🟢 ONLINE MODE ENABLED', {
      wasOffline,
      willBeOffline
    });

    console.log('[Debug] Offline mode:', willBeOffline ? 'ENABLED' : 'DISABLED');

    // If switching from offline to online, trigger manual sync
    if (wasOffline && !willBeOffline) {
      console.log('[Debug] Switching to online mode, triggering manual sync...');

      try {
        const session = await getSupabaseSession();
        const userId = session?.user?.id;

        if (!userId) {
          console.warn('[Debug] No user session, skipping sync');
          return;
        }

        // Sync workout data first
        const result = await syncOfflineData(userId);
        console.log('[Debug] Sync result:', result);

        // Then sync pending posts (after workouts are synced)
        if (result.success > 0 || result.failed === 0) {
          const postsSynced = await syncPendingPosts(userId);
          console.log(`[Debug] Synced ${postsSynced} pending posts`);

          if (postsSynced > 0) {
            toast({
              title: 'Sync complete',
              description: `Synced ${result.success} operations and ${postsSynced} posts`,
            });
          } else if (result.success > 0) {
            toast({
              title: 'Sync complete',
              description: `Synced ${result.success} operations`,
            });
          }
        }

        if (result.failed > 0) {
          toast({
            title: 'Sync partially failed',
            description: `${result.success} succeeded, ${result.failed} failed`,
            variant: 'destructive',
          });
        }
      } catch (error: any) {
        console.error('[Debug] Manual sync failed:', error);
        toast({
          title: 'Sync failed',
          description: error.message || 'Failed to sync offline data',
          variant: 'destructive',
        });
      }
    }
  }, [debugOfflineMode, setDebugOfflineMode, toast]);

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-2">
      {/* Status indicator */}
      <div className="text-xs font-mono bg-black/80 text-white px-2 py-1 rounded">
        {debugOfflineMode ? '🔴 OFFLINE (Debug)' : isOnline ? '🟢 ONLINE' : '🟡 OFFLINE (Auto)'}
      </div>

      {/* Toggle button */}
      <Button
        type="button"
        onClick={handleToggle}
        size="icon"
        variant={debugOfflineMode ? "destructive" : "default"}
        className="h-12 w-12 rounded-full shadow-lg"
        title={debugOfflineMode ? "Disable debug offline mode" : "Enable debug offline mode"}
      >
        {debugOfflineMode ? (
          <WifiOff className="h-6 w-6" />
        ) : (
          <Wifi className="h-6 w-6" />
        )}
      </Button>
    </div>
  );
};
