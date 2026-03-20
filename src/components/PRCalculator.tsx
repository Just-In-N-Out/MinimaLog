import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Calculator } from "lucide-react";

const PRCalculator = () => {
  const [weight, setWeight] = useState("");
  const [reps, setReps] = useState("");
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [result, setResult] = useState<number | null>(null);

  const calculate1RM = () => {
    const w = parseFloat(weight);
    const r = parseInt(reps);

    if (!w || !r || r < 1 || r > 12) return;

    // Epley formula: 1RM = weight × (1 + reps / 30)
    const estimated1RM = w * (1 + r / 30);
    setResult(estimated1RM);
  };

  return (
    <Card className="border-2">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          1RM Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label htmlFor="calc-weight">Weight</Label>
            <Input
              id="calc-weight"
              type="number"
              step="0.5"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              placeholder="70"
              className="h-12 text-lg"
            />
          </div>
          <div>
            <Label htmlFor="calc-reps">Reps</Label>
            <Input
              id="calc-reps"
              type="number"
              value={reps}
              onChange={(e) => setReps(e.target.value)}
              placeholder="8"
              className="h-12 text-lg"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant={unit === "kg" ? "default" : "outline"}
            onClick={() => setUnit("kg")}
            className="flex-1"
          >
            kg
          </Button>
          <Button
            variant={unit === "lb" ? "default" : "outline"}
            onClick={() => setUnit("lb")}
            className="flex-1"
          >
            lb
          </Button>
        </div>

        <Button onClick={calculate1RM} className="w-full h-12">
          Calculate
        </Button>

        {result && (
          <div className="bg-primary/10 rounded-lg p-4 text-center">
            <p className="text-sm text-muted-foreground mb-1">Estimated 1RM</p>
            <p className="text-3xl font-bold">
              {result.toFixed(1)} {unit}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Using Epley Formula
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default PRCalculator;
