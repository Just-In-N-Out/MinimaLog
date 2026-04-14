import { useExerciseImage } from "@/hooks/useExerciseImage";
import { useRef } from "react";
import { ImageIcon } from "lucide-react";

interface ExerciseImageProps {
  exerciseId: string | null | undefined;
  imageUrl: string | null | undefined;
  exerciseName: string;
  className?: string;
  size?: "sm" | "md" | "lg";
  loading?: "lazy" | "eager";
  crossOrigin?: "" | "anonymous" | "use-credentials";
  disableAutoCache?: boolean;
}

const sizeClasses = {
  sm: "w-10 h-10",
  md: "w-16 h-16",
  lg: "w-20 h-20 sm:w-24 sm:h-24",
};

const iconSizeClasses = {
  sm: "w-4 h-4",
  md: "w-6 h-6",
  lg: "w-8 h-8",
};

/**
 * Exercise image component with automatic filesystem caching for offline support
 * Shows placeholder on slow connections when image not cached
 */
export const ExerciseImage = ({
  exerciseId,
  imageUrl,
  exerciseName,
  className = "",
  size = "md",
  loading = "lazy",
  crossOrigin,
  disableAutoCache = true,
}: ExerciseImageProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const { src, isCached, isLoading } = useExerciseImage(
    exerciseId,
    imageUrl,
    disableAutoCache,
    exerciseName
  );

  // Only use src from hook - don't fallback to imageUrl
  // This allows the hook to control when network URLs are shown based on connection quality
  const displaySrc = src;
  const handleError = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget;
    if (img.src.endsWith("/placeholder.svg")) return;
    img.src = "/placeholder.svg";
  };

  return (
    <div
      ref={containerRef}
      className={`${sizeClasses[size]} rounded-lg overflow-hidden flex-shrink-0 bg-muted ${className} flex items-center justify-center`}
    >
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={exerciseName}
          className="w-full h-full object-cover"
          loading={loading}
          crossOrigin={
            // Only use crossOrigin for HTTP/HTTPS URLs
            // Local capacitor:// and file:// URLs fail CORS checks on iOS
            displaySrc?.startsWith('http://') || displaySrc?.startsWith('https://')
              ? crossOrigin
              : undefined
          }
          onError={handleError}
        />
      ) : (
        // Show placeholder icon when no image available (slow connection or not cached)
        <ImageIcon className={`${iconSizeClasses[size]} text-muted-foreground/40`} />
      )}
    </div>
  );
};
