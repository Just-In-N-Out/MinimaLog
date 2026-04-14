import { useEffect, useRef } from "react";
import Picker from "react-mobile-picker";
import { Haptics, ImpactStyle } from "@capacitor/haptics";
import { Capacitor } from "@capacitor/core";

interface SmoothWheelPickerProps {
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

export const SmoothWheelPicker = ({
  value,
  min,
  max,
  step = 1,
  onChange,
  unit = "",
  formatValue = (v) => v.toFixed(step < 1 ? 1 : 0),
}: SmoothWheelPickerProps) => {
  const lastValueRef = useRef(value);

  // Generate array of values
  const values: number[] = [];
  for (let v = min; v <= max; v += step) {
    values.push(Math.round(v * 10) / 10); // Round to 1 decimal place
  }

  // Convert values to strings for the picker
  const valueMap: { [key: string]: string } = {};
  values.forEach((v) => {
    const key = v.toString();
    valueMap[key] = `${formatValue(v)} ${unit}`;
  });

  // Find current selection
  const currentKey = value.toString();

  const handleChange = (newValue: { value: string }) => {
    const newNum = parseFloat(newValue.value);
    if (newNum !== lastValueRef.current) {
      triggerHaptic();
      lastValueRef.current = newNum;
      onChange(newNum);
    }
  };

  return (
    <div className="w-full max-w-xs mx-auto">
      <Picker
        value={{ value: currentKey }}
        onChange={handleChange}
        wheelMode="normal"
        height={250}
        itemHeight={50}
      >
        <Picker.Column name="value">
          {Object.entries(valueMap).map(([key, displayValue]) => (
            <Picker.Item key={key} value={key}>
              {({ selected }) => (
                <div
                  className={`flex items-center justify-center h-[50px] text-2xl font-semibold transition-all ${
                    selected
                      ? "text-foreground scale-110"
                      : "text-muted-foreground scale-90 opacity-50"
                  }`}
                >
                  {displayValue}
                </div>
              )}
            </Picker.Item>
          ))}
        </Picker.Column>
      </Picker>
    </div>
  );
};
