import { useEffect, useState, ReactNode } from "react";

interface LiquidGlassHeaderProps {
  children: ReactNode;
  className?: string;
}

export const LiquidGlassHeader = ({ children, className = "" }: LiquidGlassHeaderProps) => {
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

  return (
    <header
      className="z-10 flex-shrink-0 absolute top-0 left-0 right-0"
      style={{ paddingTop: 'calc(env(safe-area-inset-top) + 8px)' }}
    >
      <div
        className="mx-4 mb-2 px-5 py-3.5 flex items-center rounded-[28px] relative overflow-hidden"
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
        {/* Content */}
        <div className={`relative z-10 flex items-center w-full gap-4 ${className}`}>
          {children}
        </div>
      </div>
    </header>
  );
};
