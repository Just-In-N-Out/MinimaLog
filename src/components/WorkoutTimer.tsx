import { useState, useEffect } from "react";
import { Timer } from "lucide-react";

interface WorkoutTimerProps {
  startedAt: string;
  className?: string;
}

export const WorkoutTimer = ({ startedAt, className = "" }: WorkoutTimerProps) => {
  const [elapsed, setElapsed] = useState("");

  useEffect(() => {
    const updateTimer = () => {
      const start = new Date(startedAt).getTime();
      const now = new Date().getTime();
      const diff = now - start;

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      const formatted = `${hours.toString().padStart(2, "0")}:${minutes
        .toString()
        .padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;

      setElapsed(formatted);
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Timer className="h-5 w-5" />
      <span className="font-mono text-lg font-semibold">{elapsed}</span>
    </div>
  );
};
