import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";

import { cn } from "@/lib/utils";
import {
  getCachedAvatarEntry,
  saveAvatarToCache,
} from "@/lib/cache/avatarCache";

type AvatarLoadingStatus = "idle" | "loading" | "loaded" | "error";

const Avatar = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Root>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Root
    ref={ref}
    className={cn("relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full", className)}
    {...props}
  />
));
Avatar.displayName = AvatarPrimitive.Root.displayName;

interface AvatarImageProps extends React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Image> {
  cacheKey?: string;
  disableCache?: boolean;
  onLoadingStatusChange?: (status: AvatarLoadingStatus) => void;
}

const AvatarImage = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Image>,
  AvatarImageProps
>(
  (
    { className, src, cacheKey, disableCache = false, onLoadingStatusChange, ...restProps },
    ref
  ) => {
    // Use cacheKey if provided, otherwise use the src URL
    const effectiveCacheKey = cacheKey || src;

    // Handle load status changes - cache on successful load
    const handleLoadingStatusChange = React.useCallback(
      (status: AvatarLoadingStatus) => {
        onLoadingStatusChange?.(status);

        // On successful load, cache for next time (background, non-blocking)
        if (status === "loaded" && !disableCache && effectiveCacheKey && src) {
          void (async () => {
            try {
              // Check if already cached
              const existing = await getCachedAvatarEntry(effectiveCacheKey);
              if (existing) return; // Already cached

              // Fetch and cache in background
              const response = await fetch(src);
              if (response.ok) {
                const blob = await response.blob();
                await saveAvatarToCache(effectiveCacheKey, src, blob);
                if (import.meta.env.DEV) {
                  console.log("[AvatarImage] Cached for next time:", effectiveCacheKey);
                }
              }
            } catch (error) {
              // Silent fail - caching is optimization only
            }
          })();
        }
      },
      [onLoadingStatusChange, src, disableCache, effectiveCacheKey]
    );

    // Simple: just use the src directly, cache in background
    return (
      <AvatarPrimitive.Image
        ref={ref}
        src={src}
        className={cn("aspect-square h-full w-full", className)}
        onLoadingStatusChange={handleLoadingStatusChange}
        {...restProps}
      />
    );
  }
);
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef<
  React.ElementRef<typeof AvatarPrimitive.Fallback>,
  React.ComponentPropsWithoutRef<typeof AvatarPrimitive.Fallback>
>(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn("flex h-full w-full items-center justify-center rounded-full bg-muted", className)}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
