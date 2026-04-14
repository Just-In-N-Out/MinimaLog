import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Home as HomeIcon, History, LineChart, User, Sparkles } from "lucide-react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";
import { useEffect, useState, useRef, useLayoutEffect } from "react";

interface BottomNavProps {
  currentIndex?: number;
}

export const BottomNav = ({ currentIndex = 2 }: BottomNavProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isDark, setIsDark] = useState(false);
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [isAnimating, setIsAnimating] = useState(true); // True when should use CSS transition (tapping), false when swiping
  const navRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    const checkDarkMode = () => {
      setIsDark(document.documentElement.classList.contains('dark'));
    };
    checkDarkMode();

    const observer = new MutationObserver(checkDarkMode);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    return () => observer.disconnect();
  }, []);

  // Update indicator position when currentIndex changes - interpolate smoothly between positions
  useLayoutEffect(() => {
    const navContainer = navRef.current;
    if (!navContainer) return;

    const index = currentIndex ?? 2;
    const floorIndex = Math.floor(index);
    const ceilIndex = Math.ceil(index);
    const fraction = index - floorIndex;

    // Detect if we're swiping (fractional) or at rest (whole number)
    // Use a small threshold to account for floating point precision
    const isSwiping = fraction > 0.01 && fraction < 0.99;
    setIsAnimating(!isSwiping);

    const floorButton = buttonRefs.current[floorIndex];
    const ceilButton = buttonRefs.current[ceilIndex];

    if (!floorButton) return;

    const navRect = navContainer.getBoundingClientRect();
    const floorRect = floorButton.getBoundingClientRect();

    // If we're exactly on an index or ceil doesn't exist, use floor position
    if (fraction === 0 || !ceilButton || floorIndex === ceilIndex) {
      setIndicatorStyle({
        left: floorRect.left - navRect.left - 4,
        width: floorRect.width + 8,
      });
    } else {
      // Interpolate between floor and ceil positions
      const ceilRect = ceilButton.getBoundingClientRect();

      const floorLeft = floorRect.left - navRect.left - 4;
      const ceilLeft = ceilRect.left - navRect.left - 4;
      const floorWidth = floorRect.width + 8;
      const ceilWidth = ceilRect.width + 8;

      setIndicatorStyle({
        left: floorLeft + (ceilLeft - floorLeft) * fraction,
        width: floorWidth + (ceilWidth - floorWidth) * fraction,
      });
    }
  }, [currentIndex, location.pathname]);

  const triggerHaptic = () => {
    if (Capacitor.isNativePlatform()) {
      Haptics.impact({ style: ImpactStyle.Heavy }).catch(() => {});
    }
  };

  const navItems = [
    { path: "/history", icon: History, label: "History" },
    { path: "/progress", icon: LineChart, label: "Progress" },
    { path: "/", icon: HomeIcon, label: "Home" },
    { path: "/ai-help", icon: Sparkles, label: "AI Help" },
    { path: "/profile", icon: User, label: "Profile" },
  ];

  // Calculate which items should be highlighted during swipe
  const getItemOpacity = (index: number) => {
    const distance = Math.abs((currentIndex ?? 0) - index);

    if (distance < 0.05) {
      return 1;
    }

    if (distance < 1) {
      return 1 - distance;
    }

    return 0;
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 px-4 pb-2"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 8px)' }}
    >
      <div
        ref={navRef}
        className="mx-auto flex justify-evenly items-center py-2 px-1 rounded-[28px] relative overflow-hidden max-w-[340px]"
        style={{
          background: isDark
            ? 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.02) 100%)'
            : 'linear-gradient(135deg, rgba(80,80,90,0.25) 0%, rgba(80,80,90,0.18) 50%, rgba(80,80,90,0.12) 100%)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          boxShadow: isDark
            ? `
              0 8px 32px rgba(0,0,0,0.4),
              inset 0 1px 1px rgba(255,255,255,0.1),
              inset 0 -1px 1px rgba(0,0,0,0.2)
            `
            : `
              0 8px 32px rgba(0,0,0,0.1),
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
          className="absolute inset-0 rounded-[28px] pointer-events-none"
          style={{
            background: isDark
              ? 'linear-gradient(180deg, rgba(255,255,255,0.08) 0%, transparent 40%)'
              : 'linear-gradient(180deg, rgba(255,255,255,0.2) 0%, transparent 40%)',
          }}
        />

        {/* Sliding liquid glass indicator */}
        <div
          className="absolute top-1 bottom-1 rounded-[18px] pointer-events-none overflow-hidden"
          style={{
            left: indicatorStyle.left,
            width: indicatorStyle.width,
            // Only animate when tapping nav items, not during swipe gestures
            transition: isAnimating
              ? 'left 0.4s cubic-bezier(0.34, 1.56, 0.64, 1), width 0.3s ease-out'
              : 'none',
            background: isDark
              ? 'linear-gradient(135deg, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0.08) 100%)'
              : 'linear-gradient(135deg, rgba(200,200,210,0.6) 0%, rgba(180,180,190,0.5) 100%)',
            backdropFilter: 'blur(20px) saturate(180%)',
            WebkitBackdropFilter: 'blur(20px) saturate(180%)',
            boxShadow: isDark
              ? `
                0 4px 16px rgba(0,0,0,0.3),
                inset 0 1px 1px rgba(255,255,255,0.2),
                inset 0 -1px 1px rgba(0,0,0,0.1)
              `
              : `
                0 4px 16px rgba(0,0,0,0.12),
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
            className="absolute inset-0 rounded-[18px]"
            style={{
              background: isDark
                ? 'linear-gradient(180deg, rgba(255,255,255,0.12) 0%, transparent 50%)'
                : 'linear-gradient(180deg, rgba(255,255,255,0.4) 0%, transparent 50%)',
            }}
          />
        </div>
        {navItems.map((item, index) => {
          const Icon = item.icon;
          const opacity = getItemOpacity(index);
          const shouldHighlight = opacity > 0.5;

          return (
            <Button
              key={item.path}
              ref={(el) => { buttonRefs.current[index] = el; }}
              variant="ghost"
              onClick={() => {
                triggerHaptic();
                navigate(item.path);
              }}
              className="flex flex-col items-center gap-1 text-xs hover:bg-transparent min-h-[48px] px-1 relative z-10"
            >
              <div className="p-2 rounded-full transition-all duration-300">
                <Icon
                  className={`h-5 w-5 transition-colors duration-300 ${
                    shouldHighlight
                      ? isDark ? 'text-white' : 'text-black'
                      : isDark ? 'text-white/40' : 'text-black/40'
                  }`}
                />
              </div>
              <span
                className={`transition-all duration-300 text-[11px] ${
                  shouldHighlight
                    ? isDark ? 'text-white font-semibold' : 'text-black font-semibold'
                    : isDark ? 'text-white/40 font-medium' : 'text-black/40 font-medium'
                }`}
              >
                {item.label}
              </span>
            </Button>
          );
        })}
      </div>
    </nav>
  );
};

