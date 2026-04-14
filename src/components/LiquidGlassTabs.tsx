import { useEffect, useState } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

interface Tab {
  id: string;
  label: string;
}

interface LiquidGlassTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
  className?: string;
}

const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
  }
};

export const LiquidGlassTabs = ({ tabs, activeTab, onTabChange, className = "" }: LiquidGlassTabsProps) => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Calculate indicator position using CSS calc based on tab count and active index
  const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
  const tabCount = tabs.length;
  const indicatorWidthPercent = 100 / tabCount;
  const indicatorLeftPercent = activeIndex * indicatorWidthPercent;

  return (
    <div
      className={`flex gap-1 rounded-3xl p-1.5 relative overflow-hidden ${className}`}
      style={{
        background: isDark
          ? 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.02) 100%)'
          : 'linear-gradient(135deg, rgba(80,80,90,0.25) 0%, rgba(80,80,90,0.18) 50%, rgba(80,80,90,0.12) 100%)',
        backdropFilter: 'blur(40px) saturate(180%)',
        WebkitBackdropFilter: 'blur(40px) saturate(180%)',
        boxShadow: isDark
          ? `
            0 4px 16px rgba(0,0,0,0.3),
            inset 0 1px 1px rgba(255,255,255,0.1),
            inset 0 -1px 1px rgba(0,0,0,0.15)
          `
          : `
            0 4px 16px rgba(0,0,0,0.1),
            inset 0 1px 1px rgba(255,255,255,0.3),
            inset 0 -1px 1px rgba(0,0,0,0.1)
          `,
        border: isDark
          ? '1px solid rgba(255,255,255,0.1)'
          : '1px solid rgba(0,0,0,0.08)',
      }}
    >
      {/* Light refraction highlight */}
      <div
        className="absolute inset-0 rounded-3xl pointer-events-none"
        style={{
          background: isDark
            ? 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, transparent 40%)'
            : 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 40%)',
        }}
      />

      {/* Sliding liquid glass indicator */}
      <div
        className="absolute top-1.5 bottom-1.5 rounded-2xl pointer-events-none overflow-hidden"
        style={{
          left: `calc(${indicatorLeftPercent}% + 2px)`,
          width: `calc(${indicatorWidthPercent}% - 4px)`,
          transition: 'left 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          background: isDark
            ? 'linear-gradient(135deg, rgba(255,255,255,0.18) 0%, rgba(255,255,255,0.1) 100%)'
            : 'linear-gradient(135deg, rgba(200,200,210,0.6) 0%, rgba(180,180,190,0.5) 100%)',
          backdropFilter: 'blur(20px) saturate(180%)',
          WebkitBackdropFilter: 'blur(20px) saturate(180%)',
          boxShadow: isDark
            ? `
              0 2px 12px rgba(0,0,0,0.2),
              inset 0 1px 1px rgba(255,255,255,0.2),
              inset 0 -1px 1px rgba(0,0,0,0.1)
            `
            : `
              0 2px 12px rgba(0,0,0,0.12),
              inset 0 1px 1px rgba(255,255,255,0.5),
              inset 0 -1px 1px rgba(0,0,0,0.08)
            `,
          border: isDark
            ? '1px solid rgba(255,255,255,0.15)'
            : '1px solid rgba(255,255,255,0.3)',
        }}
      >
        {/* Inner glow for liquid effect */}
        <div
          className="absolute inset-0 rounded-2xl"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(255,255,255,0.15) 0%, transparent 50%)'
              : 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 50%)',
          }}
        />
      </div>

      {/* Tab buttons */}
      {tabs.map((tab, index) => {
        const isActive = tab.id === activeTab;

        return (
          <button
            key={tab.id}
            onClick={() => {
              triggerHaptic();
              onTabChange(tab.id);
            }}
            className="flex-1 rounded-2xl text-base font-bold py-2.5 px-4 transition-colors duration-300 relative z-10"
            style={{
              color: isActive
                ? isDark ? 'rgba(255,255,255,0.95)' : 'rgba(0,0,0,0.9)'
                : isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)',
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};
