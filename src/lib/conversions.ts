// Weight conversion utilities

export const kgToLb = (kg: number): number => {
  return kg * 2.20462;
};

export const lbToKg = (lb: number): number => {
  return lb / 2.20462;
};

export const convertWeight = (weight: number, from: "kg" | "lb", to: "kg" | "lb"): number => {
  if (from === to) return weight;
  return from === "kg" ? kgToLb(weight) : lbToKg(weight);
};

// Estimated 1RM formulas
export const calculate1RM = (weight: number, reps: number, formula: "epley" | "brzycki" = "epley"): number => {
  if (reps === 1) return weight;
  
  if (formula === "epley") {
    // Epley Formula: 1RM = weight * (1 + reps/30)
    return weight * (1 + reps / 30);
  } else {
    // Brzycki Formula: 1RM = weight * (36 / (37 - reps))
    return weight * (36 / (37 - reps));
  }
};
