import { useEffect, useRef } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { useDarkMode } from "@/hooks/useDarkMode";

interface LiquidGlassProgressBarProps {
  progress: number; // 0-100
  className?: string;
}

const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }
};

export function LiquidGlassProgressBar({
  progress,
  className = "",
}: LiquidGlassProgressBarProps) {
  const isDark = useDarkMode();
  const lastMilestoneRef = useRef(0);

  // Haptic feedback on milestones
  useEffect(() => {
    const milestones = [25, 50, 75, 100];
    for (const milestone of milestones) {
      if (progress >= milestone && lastMilestoneRef.current < milestone) {
        triggerHaptic();
        lastMilestoneRef.current = milestone;
        break;
      }
    }
    if (progress < lastMilestoneRef.current) {
      lastMilestoneRef.current = Math.floor(progress / 25) * 25;
    }
  }, [progress]);

  return (
    <div className={`relative ${className}`}>
      {/* CSS for flowing animation */}
      <style>{`
        @keyframes liquidFlow {
          0% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
          100% {
            background-position: 0% 50%;
          }
        }
        @keyframes shimmer {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(200%);
          }
        }
      `}</style>

      {/* Glass container */}
      <div
        className="relative h-8 rounded-full overflow-hidden"
        style={{
          background: isDark
            ? 'rgba(255,255,255,0.08)'
            : 'rgba(0,0,0,0.06)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          boxShadow: isDark
            ? 'inset 0 2px 4px rgba(0,0,0,0.3), inset 0 -1px 2px rgba(255,255,255,0.1)'
            : 'inset 0 2px 4px rgba(0,0,0,0.1), inset 0 -1px 2px rgba(255,255,255,0.5)',
          border: isDark
            ? '1px solid rgba(255,255,255,0.12)'
            : '1px solid rgba(0,0,0,0.08)',
        }}
      >
        {/* Progress fill with flowing liquid effect */}
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out overflow-hidden"
          style={{
            width: `${progress}%`,
            background: isDark
              ? 'linear-gradient(90deg, rgba(255,255,255,0.35), rgba(200,200,210,0.45), rgba(255,255,255,0.35), rgba(180,180,190,0.4), rgba(255,255,255,0.35))'
              : 'linear-gradient(90deg, rgba(140,140,150,0.5), rgba(100,100,110,0.6), rgba(140,140,150,0.5), rgba(120,120,130,0.55), rgba(140,140,150,0.5))',
            backgroundSize: '200% 100%',
            animation: 'liquidFlow 3s ease-in-out infinite',
          }}
        >
          {/* Shimmer/shine moving across */}
          <div
            className="absolute inset-0"
            style={{
              background: isDark
                ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.4) 50%, transparent 100%)'
                : 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
              animation: 'shimmer 2s ease-in-out infinite',
            }}
          />

          {/* Top highlight for glass depth */}
          <div
            className="absolute inset-x-0 top-0 h-1/2 rounded-t-full"
            style={{
              background: 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 100%)',
            }}
          />

          {/* Bottom shadow for glass depth */}
          <div
            className="absolute inset-x-0 bottom-0 h-1/3 rounded-b-full"
            style={{
              background: isDark
                ? 'linear-gradient(0deg, rgba(0,0,0,0.2) 0%, transparent 100%)'
                : 'linear-gradient(0deg, rgba(0,0,0,0.1) 0%, transparent 100%)',
            }}
          />
        </div>

        {/* Percentage inside the bar */}
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
        >
          <span
            className="text-sm font-bold tracking-wide"
            style={{
              color: isDark ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.7)',
              textShadow: isDark
                ? '0 1px 2px rgba(0,0,0,0.5)'
                : '0 1px 2px rgba(255,255,255,0.8)',
            }}
          >
            {Math.round(progress)}%
          </span>
        </div>

        {/* Inner highlight on container */}
        <div
          className="absolute inset-x-0 top-0 h-px rounded-full pointer-events-none"
          style={{
            background: isDark
              ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)'
              : 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.5) 50%, transparent 100%)',
          }}
        />
      </div>
    </div>
  );
}
