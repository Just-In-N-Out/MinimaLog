import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseSession } from "@/lib/session";
import { ChevronLeft, TrendingUp, Share2, Camera, FileText, Loader2, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Label } from "recharts";
import { format } from "date-fns";
import { convertWeight } from "@/lib/conversions";
import { useToast } from "@/hooks/use-toast";
import { Capacitor } from "@capacitor/core";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

interface WorkoutData {
  date: string;
  timestamp: number;
  maxWeight: number | null;
  maxReps: number | null;
  volume: number | null;
  maxWeightLeft?: number | null;
  maxWeightRight?: number | null;
  maxRepsLeft?: number | null;
  maxRepsRight?: number | null;
  volumeLeft?: number | null;
  volumeRight?: number | null;
}

interface Exercise {
  id: string;
  name: string;
  equipment?: string;
  muscle_group?: string;
}

type ShareAction = "png" | "pdf" | "camera";

const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.src = dataUrl;
  });

const MAX_EXPORT_DIMENSION = 8000;

const optimizeImageSize = (
  baseDataUrl: string,
  image: HTMLImageElement
): { dataUrl: string; width: number; height: number } => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const largestSide = Math.max(width, height);

  if (typeof document === "undefined" || largestSide <= MAX_EXPORT_DIMENSION) {
    return { dataUrl: baseDataUrl, width, height };
  }

  const scale = MAX_EXPORT_DIMENSION / largestSide;
  const targetWidth = Math.round(width * scale);
  const targetHeight = Math.round(height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    return { dataUrl: baseDataUrl, width, height };
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, targetWidth, targetHeight);

  return {
    dataUrl: canvas.toDataURL("image/png"),
    width: targetWidth,
    height: targetHeight,
  };
};

const convertToJpegDataUrl = async (dataUrl: string, quality = 1.0) => {
  if (typeof document === "undefined") return dataUrl;

  const image = await loadImageFromDataUrl(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const context = canvas.getContext("2d");

  if (!context) {
    return dataUrl;
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  return canvas.toDataURL("image/jpeg", quality);
};

const captureNodeToImage = async (
  node: HTMLElement
): Promise<{ dataUrl: string; width: number; height: number }> => {
  const pixelRatio =
    typeof window !== "undefined" && window.devicePixelRatio
      ? window.devicePixelRatio * 3.5
      : 3.5;

  const backgroundColor =
    typeof window !== "undefined"
      ? getComputedStyle(document.body).backgroundColor || "#ffffff"
      : "#ffffff";

  const rawDataUrl = await toPng(node, {
    cacheBust: true,
    pixelRatio,
    backgroundColor,
  });

  const image = await loadImageFromDataUrl(rawDataUrl);
  return optimizeImageSize(rawDataUrl, image);
};

const extractBase64Payload = (dataUrl: string): string => {
  const segments = dataUrl.split(",");
  if (segments.length < 2) {
    throw new Error("Invalid data URL format");
  }
  return segments[1] ?? "";
};

const downloadDataUrl = (dataUrl: string, fileName: string) => {
  if (typeof document === "undefined") return;
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

const tryWebShareFile = async (
  dataUrl: string,
  fileName: string,
  mimeType: string,
  title: string,
  text: string
): Promise<boolean> => {
  if (typeof navigator === "undefined" || typeof window === "undefined" || !navigator.share) {
    return false;
  }

  try {
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: mimeType });

    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      return false;
    }

    await navigator.share({
      files: [file],
      title,
      text,
    });

    return true;
  } catch (error) {
    console.error("Failed to share via Web Share API", error);
    return false;
  }
};

const shareNativeBase64 = async (
  base64Data: string,
  fileName: string,
  shareText: string
): Promise<string> => {
  try {
    const targetPath = `exports/${fileName}`;

    await Filesystem.writeFile({
      path: targetPath,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });

    const canShare = Share.canShare ? await Share.canShare() : { value: true };
    if (!canShare?.value) {
      throw new Error("Sharing is not available on this device.");
    }

    let fileUri = targetPath;

    if (Filesystem.getUri) {
      const { uri } = await Filesystem.getUri({
        path: targetPath,
        directory: Directory.Cache,
      });
      if (uri) {
        fileUri = uri;
      }
    }

    await Share.share({
      title: "Progress Chart",
      text: shareText,
      url: fileUri,
    });

    return targetPath;
  } catch (error: any) {
    // Fallback for simulator or when native share is not available
    if (error?.message?.includes("not implemented") || error?.code === "UNIMPLEMENTED") {
      throw new Error("Native sharing is not available in simulator. Please test on a real device or use browser download.");
    }
    throw error;
  }
};

const ExerciseProgressDetail = () => {
  const { exerciseId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [exerciseInfo, setExerciseInfo] = useState<Exercise | null>(null);
  const [workoutExercisesData, setWorkoutExercisesData] = useState<any[]>([]);
  const [activeShare, setActiveShare] = useState<ShareAction | null>(null);
  const shareContentRef = useRef<HTMLDivElement>(null);

  // Fetch all data
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      const session = await getSupabaseSession();
      if (!session?.user) {
        navigate("/auth");
        return;
      }

      const userId = session.user.id;

      // Get user's preferred unit
      const { data: profile } = await supabase
        .from('profiles')
        .select('unit_default')
        .eq('id', userId)
        .single();

      if (profile?.unit_default) {
        setUnit(profile.unit_default === 'lb' ? 'lb' : 'kg');
      }

      // Fetch exercise info
      if (exerciseId) {
        const { data: exercise, error: exerciseError } = await supabase
          .from('exercises')
          .select('id, name, equipment, muscle_group, is_unilateral')
          .eq('id', exerciseId)
          .single();

        if (exerciseError) {
          console.error('Error fetching exercise:', exerciseError);
          setErrorMessage('Failed to load exercise');
          setLoading(false);
          return;
        }

        setExerciseInfo(exercise);

        // Fetch all workout_exercises for this exercise
        // Note: Can't order by joined table fields directly, will sort in memory
        const { data: workoutExercises, error: weError } = await supabase
          .from('workout_exercises')
          .select(`
            id,
            workout_id,
            exercise_id,
            workouts!inner(
              id,
              started_at,
              ended_at,
              user_id
            ),
            sets(
              id,
              set_no,
              weight,
              reps,
              rir,
              unit,
              is_warmup,
              is_unilateral,
              left_weight,
              right_weight,
              left_reps,
              right_reps,
              created_at
            )
          `)
          .eq('exercise_id', exerciseId)
          .eq('workouts.user_id', userId)
          .not('workouts.ended_at', 'is', null)
          .limit(100);

        console.log('Workout exercises query result:', {
          data: workoutExercises,
          error: weError,
          exerciseId,
          userId,
          count: workoutExercises?.length || 0
        });

        if (weError) {
          console.error('Error fetching workout exercises:', weError);
        }

        setWorkoutExercisesData(workoutExercises || []);
      }

      setLoading(false);
    } catch (error) {
      console.error('Error loading data:', error);
      setErrorMessage(error instanceof Error ? error.message : 'Failed to load data');
      setLoading(false);
    }
  }, [exerciseId, navigate]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleShare = useCallback(
    async (action: ShareAction) => {
      if (!shareContentRef.current) {
        toast({
          title: "Share unavailable",
          description: "The progress charts are still loading. Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }

      if (typeof window === "undefined") {
        toast({
          title: "Share unavailable",
          description: "Sharing is only supported in the app or browser.",
          variant: "destructive",
        });
        return;
      }

      setActiveShare(action);

      try {
        const node = shareContentRef.current;
        // Show export-only content during capture
        node.setAttribute('data-exporting', 'true');
        const { dataUrl, width, height } = await captureNodeToImage(node);
        // Hide export-only content after capture
        node.removeAttribute('data-exporting');
        const fileBaseName = `${exerciseInfo?.name.replace(/\s+/g, "-")}-progress-${format(new Date(), "yyyy-MM-dd")}`;
        const shareLabel = `${exerciseInfo?.name} Progress`;
        const isNative = Capacitor.isNativePlatform();

        if (action === "png") {
          if (isNative) {
            const base64 = extractBase64Payload(dataUrl);
            await shareNativeBase64(base64, `${fileBaseName}.png`, shareLabel);
            toast({
              title: "Share sheet opened",
              description: "Choose an app to send your progress chart.",
            });
          } else {
            const shared = await tryWebShareFile(
              dataUrl,
              `${fileBaseName}.png`,
              "image/png",
              "Progress Chart",
              shareLabel
            );

            if (!shared) {
              downloadDataUrl(dataUrl, `${fileBaseName}.png`);
              toast({
                title: "PNG download started",
                description: "Check your downloads to share it anywhere.",
              });
            } else {
              toast({
                title: "Share sheet opened",
                description: "Send your progress anywhere via the browser share menu.",
              });
            }
          }
        } else if (action === "pdf") {
          const orientation = width >= height ? "landscape" : "portrait";
          const pdf = new jsPDF({
            orientation,
            unit: "px",
            format: [width, height],
            compress: true,
          });
          const optimizedPdfImage = await convertToJpegDataUrl(dataUrl);
          pdf.addImage(optimizedPdfImage, "JPEG", 0, 0, width, height);

          if (isNative) {
            const pdfBase64 = extractBase64Payload(pdf.output("datauristring"));
            await shareNativeBase64(pdfBase64, `${fileBaseName}.pdf`, shareLabel);
            toast({
              title: "Share sheet opened",
              description: "Send the PDF version of your progress.",
            });
          } else {
            pdf.save(`${fileBaseName}.pdf`);
            toast({
              title: "PDF download started",
              description: "Your progress PDF is ready to share.",
            });
          }
        } else if (action === "camera") {
          if (!isNative) {
            toast({
              title: "Open on mobile",
              description: "Saving to the camera roll is only available in the mobile app.",
            });
            return;
          }

          const base64 = extractBase64Payload(dataUrl);
          await shareNativeBase64(
            base64,
            `${fileBaseName}.png`,
            `${shareLabel} — choose Save Image to add it to your camera roll.`
          );
          toast({
            title: "Share sheet opened",
            description: "Tap Save Image to add it to your camera roll.",
          });
        }
      } catch (error) {
        console.error("Failed to share progress", error);
        toast({
          title: "Share failed",
          description:
            error instanceof Error
              ? error.message
              : "We couldn't prepare your progress export. Please try again.",
          variant: "destructive",
        });
      } finally {
        setActiveShare(null);
      }
    },
    [toast, exerciseInfo]
  );

  const sharedDotProps = {
    r: 4,
    strokeWidth: 2,
    stroke: "hsl(var(--foreground))",
    fill: "hsl(var(--foreground))",
  };
  const sharedActiveDotProps = {
    r: 5,
    strokeWidth: 2,
    stroke: "hsl(var(--foreground))",
    fill: "hsl(var(--foreground))",
  };

  // Process historical workout data into chart data points
  const { isUnilateralExercise, chartData } = useMemo(() => {
    // Check if ANY sets in the workout history were actually performed unilaterally
    const hasUnilateralSets = (workoutExercisesData || []).some((we) =>
      (we.sets || []).some((set) => set.is_unilateral)
    );
    const isUnilateral = hasUnilateralSets;

    console.log('Processing chart data:', {
      workoutExercisesDataLength: workoutExercisesData?.length || 0,
      isUnilateral,
      hasUnilateralSets,
      exerciseInfo
    });

    if (!workoutExercisesData || workoutExercisesData.length === 0) {
      console.log('No workout exercises data found');
      return { isUnilateralExercise: isUnilateral, chartData: [] };
    }

    const toNumber = (value: unknown): number | null => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const convertValue = (value: number | null, setUnit: "kg" | "lb" | null): number | null => {
      if (value === null || value === undefined) return null;
      const fromUnit = setUnit ?? unit;
      return fromUnit === unit ? value : convertWeight(value, fromUnit, unit);
    };

    // Group by workout_id
    const workoutMap = new Map<string, typeof workoutExercisesData>();
    for (const we of workoutExercisesData) {
      const workoutId = we.workout_id;
      const existing = workoutMap.get(workoutId) || [];
      existing.push(we);
      workoutMap.set(workoutId, existing);
    }

    // Calculate stats per workout
    const chartDataPoints: WorkoutData[] = [];

    for (const [workoutId, workoutExercises] of workoutMap.entries()) {
      const workout = workoutExercises[0]?.workouts;
      if (!workout?.ended_at) continue;

      // Collect all sets from this workout
      const allSets = workoutExercises.flatMap((we) => we.sets ?? []);
      const workingSets = allSets.filter((set) => !set.is_warmup);
      const targetSets = workingSets.length > 0 ? workingSets : allSets;

      if (targetSets.length === 0) continue;

      let maxWeight: number | null = null;
      let maxReps: number | null = null;
      let totalVolume = 0;
      let maxWeightLeft: number | null = null;
      let maxWeightRight: number | null = null;
      let maxRepsLeft: number | null = null;
      let maxRepsRight: number | null = null;
      let totalVolumeLeft = 0;
      let totalVolumeRight = 0;

      for (const set of targetSets) {
        const convertedWeight = convertValue(toNumber(set.weight), set.unit as "kg" | "lb" | null);
        const convertedLeft = convertValue(toNumber(set.left_weight), set.unit as "kg" | "lb" | null);
        const convertedRight = convertValue(toNumber(set.right_weight), set.unit as "kg" | "lb" | null);
        const reps = toNumber(set.reps);
        const leftReps = toNumber(set.left_reps);
        const rightReps = toNumber(set.right_reps);

        // Calculate max weight
        const weightCandidates = [convertedWeight, convertedLeft, convertedRight].filter(
          (value): value is number => value !== null
        );
        if (weightCandidates.length) {
          const candidateMax = Math.max(...weightCandidates);
          if (maxWeight === null || candidateMax > maxWeight) {
            maxWeight = candidateMax;
          }
        }

        // Calculate max reps
        const repsCandidates = [reps, leftReps, rightReps].filter(
          (value): value is number => value !== null
        );
        if (repsCandidates.length) {
          const candidateMax = Math.max(...repsCandidates);
          if (maxReps === null || candidateMax > maxReps) {
            maxReps = candidateMax;
          }
        }

        // Calculate volume (unilateral vs bilateral)
        if (isUnilateral && set.is_unilateral) {
          if (convertedLeft !== null && leftReps !== null) {
            const contribution = convertedLeft * leftReps;
            totalVolumeLeft += contribution;
            totalVolume += contribution;
            if (maxWeightLeft === null || convertedLeft > maxWeightLeft) {
              maxWeightLeft = convertedLeft;
            }
            if (maxRepsLeft === null || leftReps > maxRepsLeft) {
              maxRepsLeft = leftReps;
            }
          }
          if (convertedRight !== null && rightReps !== null) {
            const contribution = convertedRight * rightReps;
            totalVolumeRight += contribution;
            totalVolume += contribution;
            if (maxWeightRight === null || convertedRight > maxWeightRight) {
              maxWeightRight = convertedRight;
            }
            if (maxRepsRight === null || rightReps > maxRepsRight) {
              maxRepsRight = rightReps;
            }
          }
        } else if (convertedWeight !== null && reps !== null) {
          totalVolume += convertedWeight * reps;
        }
      }

      const workoutDate = new Date(workout.ended_at);
      chartDataPoints.push({
        date: format(workoutDate, "MMM dd"),
        timestamp: workoutDate.getTime(),
        maxWeight: maxWeight !== null ? Number(maxWeight.toFixed(2)) : null,
        maxReps: maxReps !== null ? Number(maxReps.toFixed(0)) : null,
        volume: Number(totalVolume.toFixed(2)),
        maxWeightLeft: maxWeightLeft !== null ? Number(maxWeightLeft.toFixed(2)) : null,
        maxWeightRight: maxWeightRight !== null ? Number(maxWeightRight.toFixed(2)) : null,
        maxRepsLeft: maxRepsLeft !== null ? Number(maxRepsLeft.toFixed(0)) : null,
        maxRepsRight: maxRepsRight !== null ? Number(maxRepsRight.toFixed(0)) : null,
        volumeLeft: totalVolumeLeft > 0 ? Number(totalVolumeLeft.toFixed(2)) : null,
        volumeRight: totalVolumeRight > 0 ? Number(totalVolumeRight.toFixed(2)) : null,
      });
    }

    // Sort by timestamp ascending (oldest to newest for chart)
    const sortedChartData = chartDataPoints.sort((a, b) => {
      return a.timestamp - b.timestamp;
    });

    console.log('Generated chart data:', {
      pointsCount: sortedChartData.length,
      data: sortedChartData
    });

    return {
      isUnilateralExercise: isUnilateral,
      chartData: sortedChartData,
    };
  }, [workoutExercisesData, unit, exerciseInfo]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
        <TrendingUp className="h-8 w-8 animate-pulse" />
        <p className="text-sm text-muted-foreground">Loading progress...</p>
      </div>
    );
  }

  if (!exerciseInfo) {
    return (
      <div className="min-h-screen bg-background p-4">
        <Button
          variant="ghost"
          onClick={() => navigate("/progress")}
          className="mb-4"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <p className="text-muted-foreground">Exercise not found</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background overflow-y-auto" style={{
      paddingTop: 'max(env(safe-area-inset-top, 0px) + 1rem, 2.5rem)',
      paddingBottom: 'max(env(safe-area-inset-bottom, 0px) + 1.5rem, 1.5rem)'
    }}>
      <div className="container max-w-4xl mx-auto px-4 space-y-6">
        <div className="flex items-center gap-4 pt-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/progress")}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{exerciseInfo.name}</h1>
            {(exerciseInfo.equipment || exerciseInfo.muscle_group) && (
              <p className="text-sm text-muted-foreground">
                {[exerciseInfo.equipment, exerciseInfo.muscle_group].filter(Boolean).join(" • ")}
              </p>
            )}
          </div>
          {chartData.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-10 w-10"
                  aria-label="Share progress"
                  disabled={activeShare !== null}
                >
                  {activeShare ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Share2 className="h-5 w-5" />
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>Share progress</DropdownMenuLabel>
                <DropdownMenuItem disabled={activeShare !== null} onSelect={() => handleShare("png")}>
                  <ImageIcon className="mr-2 h-4 w-4" />
                  Send as PNG
                </DropdownMenuItem>
                <DropdownMenuItem disabled={activeShare !== null} onSelect={() => handleShare("pdf")}>
                  <FileText className="mr-2 h-4 w-4" />
                  Send as PDF
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={activeShare !== null}
                  onSelect={() => handleShare("camera")}
                >
                  <Camera className="mr-2 h-4 w-4" />
                  Save to camera roll
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {errorMessage && (
          <Card className="border-destructive/40 bg-destructive/10">
            <div className="p-4 text-sm text-destructive-foreground">{errorMessage}</div>
          </Card>
        )}

        {chartData.length === 0 ? (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">No workout data available for this exercise</p>
          </Card>
        ) : (
          <div ref={shareContentRef} className="space-y-6">
            <div className="text-center space-y-1">
              <h2 className="text-2xl font-bold tracking-tight export-only">{exerciseInfo.name}</h2>
              <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground export-only">
                Download Minimalog
              </p>
            </div>
            <Card className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Max Weight Progress</h2>
              {isUnilateralExercise ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Left Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value={`Weight (${unit})`}
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                            color: "hsl(var(--foreground))",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="maxWeightLeft"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={sharedDotProps}
                          activeDot={sharedActiveDotProps}
                          name={`Left Max (${unit})`}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Right Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value={`Weight (${unit})`}
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                            color: "hsl(var(--foreground))",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="maxWeightRight"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={2}
                          dot={{ ...sharedDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          activeDot={{ ...sharedActiveDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          name={`Right Max (${unit})`}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <ResponsiveContainer width="100%" height={300} minWidth={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                      />
                      <YAxis
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                        domain={['auto', 'auto']}
                        allowDataOverflow={false}
                      >
                        <Label
                          value={`Weight (${unit})`}
                          angle={-90}
                          position="left"
                          fill="hsl(var(--muted-foreground))"
                          dx={12}
                          dy={0}
                        />
                      </YAxis>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                          color: "hsl(var(--foreground))",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="maxWeight"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--primary))", r: 4 }}
                        activeDot={{ fill: "hsl(var(--primary))", stroke: "hsl(var(--background))", strokeWidth: 2, r: 6 }}
                        name={`Max Weight (${unit})`}
                        connectNulls={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Max Reps Progress</h2>
              {isUnilateralExercise ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Left Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value="Reps"
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                            color: "hsl(var(--foreground))",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="maxRepsLeft"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={sharedDotProps}
                          activeDot={sharedActiveDotProps}
                          name="Left Reps"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Right Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value="Reps"
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="maxRepsRight"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={2}
                          dot={{ ...sharedDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          activeDot={{ ...sharedActiveDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          name="Right Reps"
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <ResponsiveContainer width="100%" height={300} minWidth={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                        <Label
                          value="Reps"
                          angle={-90}
                          position="left"
                          fill="hsl(var(--muted-foreground))"
                          dx={12}
                          dy={0}
                        />
                      </YAxis>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="maxReps"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--primary))", r: 4 }}
                        name="Max Reps"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>

            <Card className="p-4 sm:p-6">
              <h2 className="text-lg font-semibold mb-4">Volume Progress</h2>
              {isUnilateralExercise ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Left Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value={`Volume (${unit})`}
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="volumeLeft"
                          stroke="hsl(var(--primary))"
                          strokeWidth={2}
                          dot={sharedDotProps}
                          activeDot={sharedActiveDotProps}
                          name={`Left Volume (${unit})`}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="w-full overflow-x-auto">
                    <div className="text-sm font-medium text-muted-foreground mb-2">Right Side</div>
                    <ResponsiveContainer width="100%" height={260} minWidth={260}>
                      <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                        <XAxis
                          dataKey="date"
                          stroke="hsl(var(--muted-foreground))"
                          tick={{ fill: "hsl(var(--muted-foreground))" }}
                        />
                        <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                          <Label
                            value={`Volume (${unit})`}
                            angle={-90}
                            position="left"
                            fill="hsl(var(--muted-foreground))"
                            dx={12}
                            dy={0}
                          />
                        </YAxis>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "hsl(var(--card))",
                            border: "1px solid hsl(var(--border))",
                            borderRadius: "var(--radius)",
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="volumeRight"
                          stroke="hsl(var(--foreground))"
                          strokeWidth={2}
                          dot={{ ...sharedDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          activeDot={{ ...sharedActiveDotProps, fill: "hsl(var(--foreground))", stroke: "hsl(var(--foreground))" }}
                          name={`Right Volume (${unit})`}
                          connectNulls={false}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <div className="w-full overflow-x-auto">
                  <ResponsiveContainer width="100%" height={300} minWidth={300}>
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis
                        dataKey="date"
                        stroke="hsl(var(--muted-foreground))"
                        tick={{ fill: "hsl(var(--muted-foreground))" }}
                      />
                      <YAxis stroke="hsl(var(--muted-foreground))" tick={{ fill: "hsl(var(--muted-foreground))" }}>
                        <Label
                          value={`Volume (${unit})`}
                          angle={-90}
                          position="left"
                          fill="hsl(var(--muted-foreground))"
                          dx={12}
                          dy={0}
                        />
                      </YAxis>
                      <Tooltip
                        contentStyle={{
                          backgroundColor: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: "var(--radius)",
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="volume"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={{ fill: "hsl(var(--primary))", r: 4 }}
                        name={`Total Volume (${unit})`}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExerciseProgressDetail;
