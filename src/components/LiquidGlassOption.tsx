import { ReactNode, useCallback } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { useDarkMode } from "@/hooks/useDarkMode";

interface LiquidGlassOptionProps {
  children: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
  disabled?: boolean;
  index?: number;
}

const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Medium }).catch(() => {});
  }
};

export function LiquidGlassOption({
  children,
  selected = false,
  onClick,
  className = "",
  disabled = false,
}: LiquidGlassOptionProps) {
  const isDark = useDarkMode();

  const handleClick = useCallback(() => {
    if (disabled) return;
    triggerHaptic();
    onClick?.();
  }, [disabled, onClick]);

  const boxShadow = selected
    ? isDark
      ? '0 2px 8px rgba(0,0,0,0.3)'
      : '0 2px 8px rgba(0,0,0,0.1)'
    : isDark
      ? '0 1px 4px rgba(0,0,0,0.2)'
      : '0 1px 4px rgba(0,0,0,0.05)';

  const borderColor = selected
    ? isDark
      ? 'rgba(255,255,255,0.3)'
      : 'rgba(0,0,0,0.2)'
    : isDark
      ? 'rgba(255,255,255,0.1)'
      : 'rgba(0,0,0,0.08)';

  const backgroundColor = selected
    ? isDark
      ? 'rgba(255,255,255,0.15)'
      : 'rgb(235, 235, 240)'
    : isDark
      ? 'rgba(255,255,255,0.08)'
      : 'rgb(245, 245, 248)';

  return (
    <div
      className={`rounded-2xl cursor-pointer transition-all duration-200 active:scale-[0.98] ${className}`}
      onClick={handleClick}
      style={{
        background: backgroundColor,
        boxShadow,
        border: `1px solid ${borderColor}`,
      }}
    >
      <div className="p-5">
        {children}
      </div>
    </div>
  );
}
