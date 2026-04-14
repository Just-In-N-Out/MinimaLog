import { useEffect, useRef, useState } from "react";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

interface WheelPickerProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  unit?: string;
  formatValue?: (value: number) => string;
}

const triggerHaptic = () => {
  if (Capacitor.isNativePlatform()) {
    Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  }
};

export const WheelPicker = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = "",
  formatValue = (v) => v.toFixed(step < 1 ? 1 : 0),
}: WheelPickerProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const lastValueRef = useRef(value);
  const startYRef = useRef(0);
  const startValueRef = useRef(value);

  // Generate array of values
  const values = [];
  for (let v = min; v <= max; v += step) {
    values.push(v);
  }

  const itemHeight = 50; // Height of each item in pixels
  const visibleItems = 5; // Number of visible items

  const getIndexFromValue = (val: number) => {
    return values.findIndex((v) => Math.abs(v - val) < step / 2);
  };

  const getValueFromIndex = (index: number) => {
    return values[Math.max(0, Math.min(values.length - 1, index))];
  };

  const currentIndex = getIndexFromValue(value);

  const handleScroll = (clientY: number) => {
    const deltaY = startYRef.current - clientY;
    const itemsMoved = Math.round(deltaY / itemHeight);
    const newIndex = Math.max(
      0,
      Math.min(values.length - 1, getIndexFromValue(startValueRef.current) + itemsMoved)
    );
    const newValue = getValueFromIndex(newIndex);

    if (newValue !== lastValueRef.current) {
      triggerHaptic();
      lastValueRef.current = newValue;
      onChange(newValue);
    }
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setIsDragging(true);
    startYRef.current = e.touches[0].clientY;
    startValueRef.current = value;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    handleScroll(e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    startYRef.current = e.clientY;
    startValueRef.current = value;
  };

  const handleMouseMove = (e: MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    handleScroll(e.clientY);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging]);

  return (
    <div className="relative w-full max-w-xs mx-auto">
      {/* Selection indicator */}
      <div
        className="absolute left-0 right-0 pointer-events-none z-10 border-y-2 border-primary/50 bg-primary/5"
        style={{
          top: `${itemHeight * Math.floor(visibleItems / 2)}px`,
          height: `${itemHeight}px`,
        }}
      />

      {/* Wheel container */}
      <div
        ref={containerRef}
        className="relative overflow-hidden select-none"
        style={{ height: `${itemHeight * visibleItems}px` }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
      >
        {/* Gradient overlays for fade effect */}
        <div className="absolute top-0 left-0 right-0 h-20 bg-gradient-to-b from-background to-transparent pointer-events-none z-10" />
        <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent pointer-events-none z-10" />

        {/* Values */}
        <div
          className="transition-transform"
          style={{
            transform: `translateY(${itemHeight * (Math.floor(visibleItems / 2) - currentIndex)}px)`,
            transitionDuration: isDragging ? "0ms" : "200ms",
          }}
        >
          {values.map((val, index) => {
            const distance = Math.abs(index - currentIndex);
            const opacity = Math.max(0.2, 1 - distance * 0.3);
            const scale = Math.max(0.7, 1 - distance * 0.15);

            return (
              <div
                key={val}
                className="flex items-center justify-center font-semibold cursor-pointer"
                style={{
                  height: `${itemHeight}px`,
                  opacity,
                  transform: `scale(${scale})`,
                  transition: isDragging ? "none" : "all 200ms",
                }}
                onClick={() => {
                  triggerHaptic();
                  onChange(val);
                }}
              >
                <span className="text-3xl">
                  {formatValue(val)} {unit}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
