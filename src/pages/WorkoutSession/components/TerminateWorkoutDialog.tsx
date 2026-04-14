/**
 * TerminateWorkoutDialog.tsx
 *
 * Confirmation dialog for canceling/terminating an active workout.
 * Displays warning about permanent deletion of workout data.
 *
 * Why Separate Component:
 * - Reusable confirmation pattern
 * - Can be lazy-loaded (rarely used)
 * - Easier to test in isolation
 */

import { memo } from "react";
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

export interface TerminateWorkoutDialogProps {
  /** Whether dialog is open */
  open: boolean;
  /** Called when open state changes */
  onOpenChange: (open: boolean) => void;
  /** Called when user confirms termination */
  onConfirm: () => void;
}

/**
 * TerminateWorkoutDialog component.
 *
 * Memoized to prevent re-renders during workout operations.
 * Only re-renders when open state or callbacks change.
 *
 * Why memo: Dialog is static content, no need to re-render frequently
 * Performance: Reduces render cycles when hidden
 */
export const TerminateWorkoutDialog = memo<TerminateWorkoutDialogProps>(
  ({ open, onOpenChange, onConfirm }) => {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent className="w-[min(88vw,360px)] max-w-sm rounded-3xl border border-muted bg-background/95 px-6 py-5 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Workout?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this workout and all its data. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep Workout</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Cancel Workout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    );
  }
);

TerminateWorkoutDialog.displayName = "TerminateWorkoutDialog";
