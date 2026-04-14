/**
 * OfflineIndicator.tsx
 *
 * Displays an offline mode indicator badge in the workout session header.
 * Only visible when in offline mode (network disconnected or debug mode enabled).
 *
 * Features:
 * - Small orange badge with WifiOff icon
 * - Tooltip on hover showing "Offline Mode"
 * - Click to show explanation dialog
 * - Auto-hides when online
 */

import { useState } from "react";
import { WifiOff } from "lucide-react";
import { useNetworkStore } from "@/lib/network";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export const OfflineIndicator = () => {
  const [showDialog, setShowDialog] = useState(false);

  // Subscribe to network store for reactive updates
  const { isOnline, debugOfflineMode } = useNetworkStore();

  // Only show indicator when TRULY offline (not just slow connection)
  const isOffline = debugOfflineMode || !isOnline;

  // Don't render anything if we're online
  if (!isOffline) {
    return null;
  }

  return (
    <>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowDialog(true)}
              className="flex items-center justify-center h-7 w-7 rounded-full bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 hover:bg-orange-200 dark:hover:bg-orange-900 transition-colors"
              aria-label="Offline mode active"
            >
              <WifiOff className="h-4 w-4" />
            </button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Offline Mode</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent
          showClose={false}
          className="rounded-3xl"
          onClick={() => setShowDialog(false)}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <WifiOff className="h-5 w-5 text-orange-600" />
              Offline Mode Active
            </DialogTitle>
            <DialogDescription className="text-left space-y-2 pt-2">
              <p>
                You're currently working in offline mode. All your workout data is being saved
                locally on your device.
              </p>
              <p>
                <strong>What this means:</strong>
              </p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li>Your workout progress is automatically saved locally</li>
                <li>Exercise images are loaded from your device cache</li>
                <li>All changes will sync when you're back online</li>
              </ul>
              <p className="text-sm text-muted-foreground mt-4">
                You can continue your workout as normal. Everything will sync automatically when
                your connection is restored.
              </p>
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
};
