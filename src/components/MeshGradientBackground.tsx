import { ReactNode, useMemo } from "react";
import { motion } from "framer-motion";
import { useDarkMode } from "@/hooks/useDarkMode";

interface MeshGradientBackgroundProps {
  children: ReactNode;
  progress?: number; // 0-100, shifts colors based on progress
  className?: string;
}

export function MeshGradientBackground({
  children,
  progress = 0,
  className = "",
}: MeshGradientBackgroundProps) {
  const isDark = useDarkMode();

  // Color palettes that shift based on progress
  const colors = useMemo(() => {
    const progressPhase = progress / 100;

    if (isDark) {
      // Dark mode: Deep purples, blues, teals
      return {
        color1: `rgba(${88 + progressPhase * 30}, ${28 + progressPhase * 20}, ${135 + progressPhase * 20}, 0.6)`, // Purple
        color2: `rgba(${59 - progressPhase * 20}, ${130 + progressPhase * 30}, ${246 - progressPhase * 50}, 0.5)`, // Blue
        color3: `rgba(${20 + progressPhase * 30}, ${184 + progressPhase * 13}, ${166 + progressPhase * 30}, 0.4)`, // Teal
        color4: `rgba(${168 - progressPhase * 50}, ${85 + progressPhase * 30}, ${247 - progressPhase * 50}, 0.3)`, // Violet
        base: 'rgb(9, 9, 11)', // zinc-950
      };
    } else {
      // Light mode: Soft pastels, whites, light blues
      return {
        color1: `rgba(${219 + progressPhase * 20}, ${234 - progressPhase * 20}, ${254 - progressPhase * 30}, 0.8)`, // Light blue
        color2: `rgba(${243 - progressPhase * 30}, ${232 + progressPhase * 10}, ${255 - progressPhase * 20}, 0.7)`, // Lavender
        color3: `rgba(${236 + progressPhase * 10}, ${254 - progressPhase * 30}, ${255 - progressPhase * 20}, 0.6)`, // Cyan tint
        color4: `rgba(${254 - progressPhase * 20}, ${249 - progressPhase * 20}, ${195 + progressPhase * 30}, 0.5)`, // Yellow tint
        base: 'rgb(250, 250, 250)', // neutral-50
      };
    }
  }, [isDark, progress]);

  return (
    <div
      className={`relative overflow-hidden ${className}`}
      style={{ backgroundColor: colors.base }}
    >
      {/* Animated gradient orbs */}
      <div className="absolute inset-0 overflow-hidden">
        {/* Orb 1 - Top left, slow drift */}
        <motion.div
          className="absolute w-[800px] h-[800px] rounded-full blur-3xl"
          animate={{
            x: ["-20%", "10%", "-20%"],
            y: ["-30%", "-10%", "-30%"],
            scale: [1, 1.2, 1],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          style={{
            background: `radial-gradient(circle, ${colors.color1} 0%, transparent 70%)`,
            left: "-10%",
            top: "-20%",
          }}
        />

        {/* Orb 2 - Center right, medium drift */}
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full blur-3xl"
          animate={{
            x: ["10%", "-10%", "10%"],
            y: ["0%", "20%", "0%"],
            scale: [1.1, 0.9, 1.1],
          }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2,
          }}
          style={{
            background: `radial-gradient(circle, ${colors.color2} 0%, transparent 70%)`,
            right: "-5%",
            top: "20%",
          }}
        />

        {/* Orb 3 - Bottom center, slow pulse */}
        <motion.div
          className="absolute w-[700px] h-[700px] rounded-full blur-3xl"
          animate={{
            x: ["-10%", "15%", "-10%"],
            y: ["10%", "-5%", "10%"],
            scale: [0.9, 1.1, 0.9],
          }}
          transition={{
            duration: 18,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 5,
          }}
          style={{
            background: `radial-gradient(circle, ${colors.color3} 0%, transparent 70%)`,
            left: "20%",
            bottom: "-10%",
          }}
        />

        {/* Orb 4 - Top right accent */}
        <motion.div
          className="absolute w-[400px] h-[400px] rounded-full blur-3xl"
          animate={{
            x: ["5%", "-15%", "5%"],
            y: ["-5%", "10%", "-5%"],
            opacity: [0.5, 0.8, 0.5],
          }}
          transition={{
            duration: 12,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 3,
          }}
          style={{
            background: `radial-gradient(circle, ${colors.color4} 0%, transparent 70%)`,
            right: "10%",
            top: "5%",
          }}
        />

        {/* Orb 5 - Center accent, faster pulse */}
        <motion.div
          className="absolute w-[500px] h-[500px] rounded-full blur-3xl"
          animate={{
            scale: [1, 1.3, 1],
            opacity: [0.3, 0.6, 0.3],
          }}
          transition={{
            duration: 8,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 1,
          }}
          style={{
            background: `radial-gradient(circle, ${colors.color1} 0%, transparent 70%)`,
            left: "40%",
            top: "40%",
            transform: "translate(-50%, -50%)",
          }}
        />

        {/* Subtle mesh overlay for texture */}
        <div
          className="absolute inset-0"
          style={{
            background: isDark
              ? `
                radial-gradient(at 40% 20%, ${colors.color2} 0px, transparent 50%),
                radial-gradient(at 80% 0%, ${colors.color4} 0px, transparent 50%),
                radial-gradient(at 0% 50%, ${colors.color1} 0px, transparent 50%),
                radial-gradient(at 80% 50%, ${colors.color3} 0px, transparent 50%),
                radial-gradient(at 0% 100%, ${colors.color2} 0px, transparent 50%),
                radial-gradient(at 80% 100%, ${colors.color1} 0px, transparent 50%)
              `
              : `
                radial-gradient(at 40% 20%, ${colors.color1} 0px, transparent 50%),
                radial-gradient(at 80% 0%, ${colors.color3} 0px, transparent 50%),
                radial-gradient(at 0% 50%, ${colors.color2} 0px, transparent 50%),
                radial-gradient(at 80% 50%, ${colors.color4} 0px, transparent 50%),
                radial-gradient(at 0% 100%, ${colors.color1} 0px, transparent 50%),
                radial-gradient(at 80% 100%, ${colors.color2} 0px, transparent 50%)
              `,
            opacity: 0.5,
          }}
        />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {children}
      </div>
    </div>
  );
}
