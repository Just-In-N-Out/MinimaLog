import { Crown, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SubscriptionBadgeProps {
  variant?: 'default' | 'compact' | 'icon';
  className?: string;
  showTrial?: boolean;
}

/**
 * SubscriptionBadge Component
 *
 * Displays a premium badge for premium users
 *
 * Usage:
 * <SubscriptionBadge /> // Default badge with "Premium" text
 * <SubscriptionBadge variant="compact" /> // Smaller badge
 * <SubscriptionBadge variant="icon" /> // Icon only
 * <SubscriptionBadge showTrial /> // Shows "Trial" instead if in trial period
 */
export function SubscriptionBadge({
  variant = 'default',
  className,
  showTrial = false,
}: SubscriptionBadgeProps) {
  if (variant === 'icon') {
    return (
      <div
        className={cn(
          "inline-flex items-center justify-center p-1 rounded-full bg-gradient-to-r from-yellow-400 to-yellow-600",
          className
        )}
      >
        <Crown className="h-3 w-3 text-white" />
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gradient-to-r from-yellow-400 to-yellow-600 text-white",
          className
        )}
      >
        <Crown className="h-3 w-3" />
        {showTrial ? 'Trial' : 'Pro'}
      </span>
    );
  }

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-semibold bg-gradient-to-r from-yellow-400 via-yellow-500 to-yellow-600 text-white shadow-md",
        className
      )}
    >
      <Crown className="h-4 w-4" />
      <span>{showTrial ? 'Premium Trial' : 'Premium'}</span>
      <Sparkles className="h-3 w-3" />
    </div>
  );
}

/**
 * FreeBadge Component
 *
 * Displays a "Free" badge for free tier users
 */
interface FreeBadgeProps {
  className?: string;
}

export function FreeBadge({ className }: FreeBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
        className
      )}
    >
      Free
    </span>
  );
}
