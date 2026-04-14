import { useDarkMode } from "@/hooks/useDarkMode";

interface GrainOverlayProps {
  opacity?: number;
  className?: string;
}

export function GrainOverlay({
  opacity,
  className = "",
}: GrainOverlayProps) {
  const isDark = useDarkMode();

  // Default opacity based on theme
  const defaultOpacity = isDark ? 0.15 : 0.08;
  const finalOpacity = opacity ?? defaultOpacity;

  return (
    <>
      {/* SVG filter definition */}
      <svg className="absolute w-0 h-0" aria-hidden="true">
        <defs>
          <filter id="grain-filter">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.8"
              numOctaves="4"
              stitchTiles="stitch"
              result="noise"
            />
            <feColorMatrix
              type="saturate"
              values="0"
              in="noise"
              result="mono"
            />
            <feBlend
              in="SourceGraphic"
              in2="mono"
              mode="multiply"
            />
          </filter>
        </defs>
      </svg>

      {/* Grain overlay using CSS noise */}
      <div
        className={`absolute inset-0 pointer-events-none ${className}`}
        style={{
          opacity: finalOpacity,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 400 400' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '200px 200px',
          mixBlendMode: isDark ? 'overlay' : 'multiply',
        }}
      />

      {/* Secondary fine grain layer */}
      <div
        className={`absolute inset-0 pointer-events-none ${className}`}
        style={{
          opacity: finalOpacity * 0.5,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='fineNoise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.5' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23fineNoise)'/%3E%3C/svg%3E")`,
          backgroundRepeat: 'repeat',
          backgroundSize: '100px 100px',
          mixBlendMode: isDark ? 'soft-light' : 'overlay',
        }}
      />
    </>
  );
}
