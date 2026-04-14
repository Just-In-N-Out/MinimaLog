import { Lock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FeatureLockProps {
  featureName: string;
  onUpgrade: () => void;
  description?: string;
  className?: string;
  showLockIcon?: boolean;
}

/**
 * FeatureLock Component
 *
 * Displays a blur overlay with lock icon for premium-only features
 *
 * Usage:
 * <div className="relative">
 *   <FeatureLock
 *     featureName="Advanced Analytics"
 *     onUpgrade={() => setShowPaywall(true)}
 *   />
 *   <div className="opacity-30 pointer-events-none">
 *     {/* Your locked content here *\/}
 *   </div>
 * </div>
 */
export function FeatureLock({
  featureName,
  onUpgrade,
  description,
  className,
  showLockIcon = true
}: FeatureLockProps) {
  return (
    <div className={cn(
      "absolute inset-0 backdrop-blur-sm bg-background/80 z-10 flex flex-col items-center justify-center p-6 rounded-lg",
      className
    )}>
      <div className="flex flex-col items-center text-center max-w-xs">
        {showLockIcon && (
          <div className="bg-primary/10 p-4 rounded-full mb-4">
            <Lock className="h-8 w-8 text-primary" />
          </div>
        )}

        <Sparkles className="h-5 w-5 text-yellow-500 mb-2" />

        <h3 className="font-semibold text-lg mb-1">Premium Feature</h3>

        <p className="text-sm text-muted-foreground mb-1">
          Unlock <span className="font-semibold text-foreground">{featureName}</span>
        </p>

        {description && (
          <p className="text-xs text-muted-foreground mb-4">
            {description}
          </p>
        )}

        <Button onClick={onUpgrade} size="sm" className="mt-2">
          <Sparkles className="mr-2 h-4 w-4" />
          Upgrade to Premium
        </Button>
      </div>
    </div>
  );
}

/**
 * Inline feature lock for smaller spaces (like list items)
 */
interface InlineFeatureLockProps {
  onUpgrade: () => void;
  className?: string;
}

export function InlineFeatureLock({ onUpgrade, className }: InlineFeatureLockProps) {
  return (
    <button
      onClick={onUpgrade}
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground hover:text-primary transition-colors",
        className
      )}
    >
      <Lock className="h-4 w-4" />
      <span className="font-medium">Premium</span>
    </button>
  );
}
