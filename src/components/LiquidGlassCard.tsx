import { ReactNode } from "react";
import { useDarkMode } from "@/hooks/useDarkMode";

interface LiquidGlassCardProps {
  children: ReactNode;
  className?: string;
}

export function LiquidGlassCard({
  children,
  className = "",
}: LiquidGlassCardProps) {
  const isDark = useDarkMode();

  return (
    <div
      className={`relative overflow-hidden rounded-3xl ${className}`}
      style={{
        background: isDark
          ? 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 100%)'
          : 'linear-gradient(135deg, rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.7) 100%)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        boxShadow: isDark
          ? '0 4px 24px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.1)'
          : '0 4px 24px rgba(0,0,0,0.08), inset 0 1px 2px rgba(255,255,255,0.8)',
        border: isDark
          ? '1px solid rgba(255,255,255,0.1)'
          : '1px solid rgba(255,255,255,0.5)',
      }}
    >
      {/* Top light refraction */}
      <div
        className="absolute inset-x-0 top-0 h-px pointer-events-none"
        style={{
          background: isDark
            ? 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.2) 50%, transparent 100%)'
            : 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)',
        }}
      />

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
