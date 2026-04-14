import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ArrowLeft, Camera, Dumbbell, FileText, Loader2, Share2, Image as ImageIcon } from "lucide-react";
import { format } from "date-fns";
import { convertWeight } from "@/lib/conversions";
import { fetchLastCompletedSets } from "@/lib/history";
import { getSupabaseSession } from "@/lib/session";
import { Capacitor } from "@capacitor/core";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { ExerciseImage } from "@/components/ExerciseImage";

interface Exercise {
  id: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  image_url: string | null;
}

interface Set {
  id: string;
  set_no: number;
  weight: number | null;
  unit: "kg" | "lb";
  reps: number | null;
  rpe: number | null;
  rir: number | null;
  is_warmup: boolean;
  notes: string | null;
  is_unilateral: boolean;
  left_weight: number | null;
  right_weight: number | null;
  left_reps: number | null;
  right_reps: number | null;
  left_rir: number | null;
  right_rir: number | null;
  left_notes: string | null;
  right_notes: string | null;
}

interface WorkoutExercise {
  id: string;
  exercise: Exercise;
  sets: Set[];
  lastSessionSets?: PreviousSetSnapshot[];
  lastSessionDate?: string | null;
}

interface SessionMetrics {
  bodyweight: number | null;
  bodyweight_unit: "kg" | "lb" | null;
  sleep: number | null;
  mood: number | null;
  preworkout: boolean | null;
  soreness_area: string | null;
}

type WeightUnit = "kg" | "lb";

const parseMetricNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const resolveWeightUnit = (value: unknown): WeightUnit | null => {
  if (value === "kg" || value === "lb") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "kg" || normalized === "lb") {
      return normalized as WeightUnit;
    }
  }
  return null;
};

const formatMetricNumber = (value: number | null): string | null => {
  if (value === null) return null;
  if (!Number.isFinite(value)) return null;
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
};

const formatSorenessLabel = (value: string | null): string | null => {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  const mapping: Record<string, string> = {
    none: "Feeling fresh",
    upper: "Upper body",
    lower: "Lower body",
    full: "Full body",
  };
  if (mapping[normalized]) {
    return mapping[normalized];
  }
  return value;
};

const normalizeNameValue = (value: unknown): string => {
  return typeof value === "string" ? value.trim() : "";
};

interface PreviousSetSnapshot {
  weight: number | null;
  reps: number | null;
  rir?: number | null;
  isWarmup?: boolean;
  unit?: WeightUnit | null;
  isUnilateral?: boolean;
  leftWeight?: number | null;
  rightWeight?: number | null;
  leftReps?: number | null;
  rightReps?: number | null;
  leftRir?: number | null;
  rightRir?: number | null;
}

type ShareAction = "png" | "pdf" | "camera";

const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = (error) => reject(error);
    image.src = dataUrl;
  });

const MAX_EXPORT_DIMENSION = 12000;
const MAX_PDF_DIMENSION = 10000; // jsPDF limit is 14,400, use 10,000 for good quality while ensuring no cut-off

const optimizeImageSize = (
  baseDataUrl: string,
  image: HTMLImageElement
): { dataUrl: string; width: number; height: number } => {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;

  // Check if image exceeds PDF limits
  if (width <= MAX_PDF_DIMENSION && height <= MAX_PDF_DIMENSION) {
    // Image is within limits, return as-is
    return { dataUrl: baseDataUrl, width, height };
  }

  console.log('[optimizeImageSize] Image exceeds PDF limits, scaling down from', width, 'x', height);

  // Calculate scale factor to fit within limits while maintaining aspect ratio
  const scaleFactor = Math.min(
    MAX_PDF_DIMENSION / width,
    MAX_PDF_DIMENSION / height
  );

  const newWidth = Math.floor(width * scaleFactor);
  const newHeight = Math.floor(height * scaleFactor);

  console.log('[optimizeImageSize] Scaling to:', newWidth, 'x', newHeight, 'with factor:', scaleFactor.toFixed(4));

  // Create canvas and scale down the image
  const canvas = document.createElement('canvas');
  canvas.width = newWidth;
  canvas.height = newHeight;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.warn('[optimizeImageSize] Could not get canvas context, returning original');
    return { dataUrl: baseDataUrl, width, height };
  }

  // Use high quality scaling
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  // Draw the scaled image
  ctx.drawImage(image, 0, 0, newWidth, newHeight);

  // Convert back to data URL
  const scaledDataUrl = canvas.toDataURL('image/png');
  console.log('[optimizeImageSize] Scaling complete, new size:', newWidth, 'x', newHeight);

  return { dataUrl: scaledDataUrl, width: newWidth, height: newHeight };
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

// Helper function to convert external images to data URLs to avoid CORS issues
const convertExternalImagesToDataUrls = async (node: HTMLElement): Promise<void> => {
  console.log('[convertExternalImagesToDataUrls] Starting conversion...');

  // Find all exercise images (any external URL starting with http/https, not data: URLs)
  const allImages = node.querySelectorAll<HTMLImageElement>('img');
  const externalImages = Array.from(allImages).filter(img =>
    img.src &&
    (img.src.startsWith('http://') || img.src.startsWith('https://')) &&
    !img.src.startsWith('data:')
  );

  console.log('[convertExternalImagesToDataUrls] Found', externalImages.length, 'external images out of', allImages.length, 'total images');
  if (externalImages.length > 0) {
    console.log('[convertExternalImagesToDataUrls] Image URLs to convert:', externalImages.map(img => img.src));
  }

  if (externalImages.length === 0) {
    return;
  }

  // Convert each image to a data URL
  await Promise.all(
    Array.from(externalImages).map(async (img) => {
      try {
        const originalSrc = img.src;
        console.log('[convertExternalImagesToDataUrls] Converting:', originalSrc);

        // Check if image is already loaded
        if (!img.complete || img.naturalWidth === 0) {
          console.warn('[convertExternalImagesToDataUrls] Image not loaded or broken:', originalSrc);
          throw new Error('Image not loaded');
        }

        // Ensure crossOrigin is set for CORS-enabled canvas drawing
        if (!img.crossOrigin) {
          console.log('[convertExternalImagesToDataUrls] Setting crossOrigin and reloading image');
          img.crossOrigin = 'anonymous';

          // Reload the image with crossOrigin set
          const reloadPromise = new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            // Trigger reload by reassigning src
            const tempSrc = img.src;
            img.src = '';
            img.src = tempSrc;
          });

          await reloadPromise;
          console.log('[convertExternalImagesToDataUrls] Image reloaded with CORS');

          // Wait a bit for image to be fully decoded
          await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Verify image is actually loaded with data
        if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
          throw new Error(`Image not properly loaded: complete=${img.complete}, naturalWidth=${img.naturalWidth}, naturalHeight=${img.naturalHeight}`);
        }

        console.log('[convertExternalImagesToDataUrls] Image dimensions:', img.naturalWidth, 'x', img.naturalHeight);

        // Use canvas to draw the already-loaded image and convert to data URL
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d', { willReadFrequently: false });

        if (!ctx) {
          throw new Error('Could not get canvas context');
        }

        // Clear canvas first
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw the image onto the canvas
        ctx.drawImage(img, 0, 0);

        // Verify something was drawn (check if canvas is not blank)
        const imageData = ctx.getImageData(0, 0, Math.min(10, canvas.width), Math.min(10, canvas.height));
        const hasData = imageData.data.some(pixel => pixel !== 0);
        if (!hasData) {
          console.warn('[convertExternalImagesToDataUrls] Canvas appears to be blank after drawing');
        }

        // Convert canvas to data URL
        const dataUrl = canvas.toDataURL('image/png');

        // Replace the src with the data URL
        img.src = dataUrl;
        console.log('[convertExternalImagesToDataUrls] Converted successfully using canvas');
      } catch (error) {
        console.warn('[convertExternalImagesToDataUrls] Failed to convert image:', error);
        console.warn('[convertExternalImagesToDataUrls] Image details:', {
          src: img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        });

        // Show placeholder if conversion fails
        const canvas = document.createElement('canvas');
        canvas.width = 80;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Draw a gray placeholder
          ctx.fillStyle = '#e5e7eb';
          ctx.fillRect(0, 0, 80, 80);
          ctx.fillStyle = '#9ca3af';
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Image', 40, 35);
          ctx.fillText('unavailable', 40, 50);
          img.src = canvas.toDataURL('image/png');
        }
        console.log('[convertExternalImagesToDataUrls] Placeholder applied for failed image');
      }
    })
  );

  console.log('[convertExternalImagesToDataUrls] Conversion complete');
};

const captureNodeToImage = async (
  node: HTMLElement,
  useLowerQuality = false
): Promise<{ dataUrl: string; width: number; height: number }> => {
  console.log('[captureNodeToImage] Starting capture, useLowerQuality:', useLowerQuality);

  // Calculate dynamic pixel ratio based on content height to ensure we stay within PDF limits
  const MAX_PDF_DIMENSION = 10000;
  const nodeHeight = node.scrollHeight || node.clientHeight;
  const nodeWidth = node.scrollWidth || node.clientWidth;

  console.log('[captureNodeToImage] Node dimensions:', nodeWidth, 'x', nodeHeight);

  // Calculate the maximum pixel ratio that keeps us under the limit
  const maxRatioForHeight = MAX_PDF_DIMENSION / nodeHeight;
  const maxRatioForWidth = MAX_PDF_DIMENSION / nodeWidth;
  const calculatedRatio = Math.min(maxRatioForHeight, maxRatioForWidth);

  // Use calculated ratio directly to ensure we never exceed limit, with cap at 3 for very small content
  const pixelRatio = Math.min(3, calculatedRatio);

  console.log('[captureNodeToImage] Calculated pixel ratio:', calculatedRatio.toFixed(2));
  console.log('[captureNodeToImage] Using pixel ratio:', pixelRatio.toFixed(2));
  console.log('[captureNodeToImage] Expected capture size:', Math.floor(nodeWidth * pixelRatio), 'x', Math.floor(nodeHeight * pixelRatio));

  const backgroundColor =
    typeof window !== "undefined"
      ? getComputedStyle(document.body).backgroundColor || "#ffffff"
      : "#ffffff";

  console.log('[captureNodeToImage] Calling toPng...');
  console.log('[captureNodeToImage] Node details:', {
    tagName: node.tagName,
    childCount: node.children.length,
    hasContent: node.textContent ? node.textContent.length : 0
  });

  let rawDataUrl: string;
  try {
    rawDataUrl = await toPng(node, {
      cacheBust: false, // Disable cache busting - images already have crossOrigin set
      pixelRatio,
      backgroundColor,
      skipAutoScale: false,
      filter: (domNode: HTMLElement) => {
        // Skip elements that might cause issues
        if (domNode.tagName === 'SCRIPT') return false;
        if (domNode.tagName === 'LINK') return false;
        if (domNode.classList?.contains('no-capture')) return false;
        return true;
      }
    });
  } catch (toPngError) {
    console.error('[captureNodeToImage] toPng failed:', toPngError);
    console.error('[captureNodeToImage] Trying with lower quality settings...');
    // Fallback: try with much lower pixel ratio
    rawDataUrl = await toPng(node, {
      cacheBust: true,
      pixelRatio: 2,
      backgroundColor,
      skipAutoScale: true
    });
  }
  console.log('[captureNodeToImage] toPng completed, data URL length:', rawDataUrl.length);

  console.log('[captureNodeToImage] Loading image...');
  const image = await loadImageFromDataUrl(rawDataUrl);
  console.log('[captureNodeToImage] Image loaded, size:', image.width, 'x', image.height);

  const result = optimizeImageSize(rawDataUrl, image);
  console.log('[captureNodeToImage] Optimization complete, final size:', result.width, 'x', result.height);
  return result;
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
    console.log('[shareNativeBase64] Starting with fileName:', fileName);
    console.log('[shareNativeBase64] Base64 data length:', base64Data.length);

    const targetPath = `exports/${fileName}`;
    console.log('[shareNativeBase64] Target path:', targetPath);

    console.log('[shareNativeBase64] Writing file to cache...');
    await Filesystem.writeFile({
      path: targetPath,
      data: base64Data,
      directory: Directory.Cache,
      recursive: true,
    });
    console.log('[shareNativeBase64] File written successfully');

    console.log('[shareNativeBase64] Checking if sharing is available...');
    const canShare = Share.canShare ? await Share.canShare() : { value: true };
    console.log('[shareNativeBase64] Can share:', canShare?.value);

    if (!canShare?.value) {
      throw new Error("Sharing is not available on this device.");
    }

    let fileUri = targetPath;
    console.log('[shareNativeBase64] Initial fileUri:', fileUri);

    if (Filesystem.getUri) {
      console.log('[shareNativeBase64] Getting URI from filesystem...');
      const { uri } = await Filesystem.getUri({
        path: targetPath,
        directory: Directory.Cache,
      });
      console.log('[shareNativeBase64] URI retrieved:', uri);
      if (uri) {
        fileUri = uri;
      }
    }

    console.log('[shareNativeBase64] Final fileUri:', fileUri);
    console.log('[shareNativeBase64] Calling Share.share...');

    await Share.share({
      title: "Workout Summary",
      text: shareText,
      url: fileUri,
    });

    console.log('[shareNativeBase64] Share.share completed successfully');
    return targetPath;
  } catch (error: any) {
    console.error('[shareNativeBase64] Error occurred:', error);
    console.error('[shareNativeBase64] Error message:', error?.message);
    console.error('[shareNativeBase64] Error code:', error?.code);

    // Fallback for simulator or when native share is not available
    if (error?.message?.includes("not implemented") || error?.code === "UNIMPLEMENTED") {
      throw new Error("Native sharing is not available in simulator. Please test on a real device or use browser download.");
    }
    throw error;
  }
};

const WorkoutDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isPremium, isLoading: subscriptionLoading } = useSubscription();
  const [loading, setLoading] = useState(true);
  const [workout, setWorkout] = useState<any>(null);
  const [exercises, setExercises] = useState<WorkoutExercise[]>([]);
  const [metrics, setMetrics] = useState<SessionMetrics | null>(null);
  const [preferredUnit, setPreferredUnit] = useState<WeightUnit>("kg");
  const [activeShare, setActiveShare] = useState<ShareAction | null>(null);
  const [userName, setUserName] = useState("");
  const shareContentRef = useRef<HTMLDivElement>(null);

  // Block access for non-premium users
  useEffect(() => {
    if (!subscriptionLoading && !isPremium) {
      navigate("/history");
      toast({
        title: "Premium feature",
        description: "Upgrade to view workout details",
      });
    }
  }, [isPremium, subscriptionLoading, navigate, toast]);
  const sorenessLabel = formatSorenessLabel(metrics?.soreness_area ?? null);
  const preSessionEntries = metrics
    ? [
        metrics.bodyweight !== null
          ? (() => {
              const formatted = formatMetricNumber(metrics.bodyweight);
              if (!formatted) return null;
              const unit = metrics.bodyweight_unit ?? preferredUnit;
              return {
                key: "bodyweight",
                label: "Bodyweight",
                value: `${formatted} ${unit}`,
              };
            })()
          : null,
        metrics.sleep !== null
          ? (() => {
              const formatted = formatMetricNumber(metrics.sleep);
              if (!formatted) return null;
              return {
                key: "sleep",
                label: "Sleep",
                value: `${formatted}/5`,
              };
            })()
          : null,
        metrics.mood !== null
          ? (() => {
              const formatted = formatMetricNumber(metrics.mood);
              if (!formatted) return null;
              return {
                key: "energy",
                label: "Energy",
                value: `${formatted}/5`,
              };
            })()
          : null,
        typeof metrics.preworkout === "boolean"
          ? {
              key: "preworkout",
              label: "Pre-workout",
              value: metrics.preworkout ? "Yes" : "No",
            }
          : null,
        sorenessLabel
          ? {
              key: "soreness",
              label: "Soreness",
              value: sorenessLabel,
            }
          : null,
      ].filter(Boolean) as Array<{ key: string; label: string; value: string }>
    : [];
  const hasPreSessionMetrics = preSessionEntries.length > 0;
  const trimmedUserName = userName.trim();
  const workoutOwnerHeading = trimmedUserName
    ? `${trimmedUserName}${/[sS]$/.test(trimmedUserName) ? "'" : "'s"} workout`
    : "Your workout";

  useEffect(() => {
    loadWorkoutDetail();
  }, [id]);

  const loadWorkoutDetail = async () => {
    try {
      // Load workout
      const { data: workoutData, error: workoutError } = await supabase
        .from("workouts")
        .select("*")
        .eq("id", id)
        .single();

      if (workoutError) throw workoutError;
      setWorkout(workoutData);

      // Load session metrics
      const { data: metricsData } = await supabase
        .from("session_metrics")
        .select("*")
        .eq("workout_id", id)
        .single();

      const sanitizedMetrics: SessionMetrics | null = metricsData
        ? {
            bodyweight: parseMetricNumber(metricsData.bodyweight),
            bodyweight_unit: resolveWeightUnit(metricsData.bodyweight_unit),
            sleep: parseMetricNumber(metricsData.sleep),
            mood: parseMetricNumber(metricsData.mood),
            preworkout:
              typeof metricsData.preworkout === "boolean"
                ? metricsData.preworkout
                : typeof metricsData.preworkout === "number"
                ? Boolean(metricsData.preworkout)
                : null,
            soreness_area:
              typeof metricsData.soreness_area === "string" &&
              metricsData.soreness_area.trim().length > 0
                ? metricsData.soreness_area
                : null,
          }
        : null;

      setMetrics(sanitizedMetrics);

      const session = await getSupabaseSession();
      const user = session?.user;

      if (user) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("unit_default, full_name, name, username")
          .eq("id", user.id)
          .maybeSingle();
        const unitPreference: WeightUnit = profile?.unit_default === "lb" ? "lb" : "kg";
        setPreferredUnit(unitPreference);
        const profileName =
          normalizeNameValue(profile?.full_name) ||
          normalizeNameValue(profile?.name) ||
          normalizeNameValue(profile?.username);
        const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
        const metadataName =
          normalizeNameValue(metadata["full_name"]) ||
          normalizeNameValue(metadata["name"]);
        const fallbackEmail = normalizeNameValue(user.email ? user.email.split("@")[0] : "");
        const resolvedName = profileName || metadataName || fallbackEmail;
        setUserName(resolvedName);
      }

      const fetchLastSessionForExercise = async (
        exerciseId: string,
        isUnilateral: boolean = false
      ): Promise<{ sets: PreviousSetSnapshot[]; startedAt: string | null }> => {
        if (!session?.user) {
          return { sets: [], startedAt: null };
        }

        const beforeDate =
          workoutData?.started_at ??
          workoutData?.created_at ??
          null;

        console.log('🔍 [WorkoutDetail] Fetching last session:', {
          currentWorkoutId: id,
          exerciseId,
          beforeDate,
          workoutData_started_at: workoutData?.started_at,
          workoutData_ended_at: workoutData?.ended_at,
          workoutData_created_at: workoutData?.created_at,
          isUnilateral
        });

        const snapshot = await fetchLastCompletedSets({
          supabase,
          userId: session.user.id,
          exerciseId,
          beforeDate,
          context: "workout_detail",
          // Don't filter by variant - show any previous data for this exercise
          // even if the exercise was switched from bilateral to unilateral or vice versa
          variant: undefined,
          excludeWorkoutId: id as string, // Exclude current workout to get true "previous" data
        });

        console.log('🔍 [WorkoutDetail] Received snapshot:', {
          currentWorkoutId: id,
          exerciseId,
          returnedWorkoutId: snapshot.workoutId,
          setsCount: snapshot.sets.length,
          firstSetWeight: snapshot.sets[0]?.weight,
          firstSetReps: snapshot.sets[0]?.reps,
          endedAt: snapshot.endedAt
        });

        if (!snapshot.sets.length) {
          return { sets: [], startedAt: null };
        }

        const previousSets: PreviousSetSnapshot[] = snapshot.sets.map((set) => ({
          weight: set.weight,
          reps: set.reps,
          rir: set.rir,
          isWarmup: set.isWarmup,
          unit: set.unit,
          isUnilateral: set.isUnilateral,
          leftWeight: set.leftWeight,
          rightWeight: set.rightWeight,
          leftReps: set.leftReps,
          rightReps: set.rightReps,
          leftRir: set.leftRir,
          rightRir: set.rightRir,
        }));

        return {
          sets: previousSets,
          startedAt: snapshot.endedAt,
        };
      };

      // Load exercises and sets
      const { data: workoutExs, error: exError } = await supabase
        .from("workout_exercises")
        .select(`
          id,
          exercise_id,
          order_index,
          exercise:exercises!workout_exercises_exercise_id_fkey (
            id,
            name,
            equipment,
            muscle_group,
            is_unilateral,
            image_url
          )
        `)
        .eq("workout_id", id)
        .order("order_index");

      if (exError) throw exError;

      // Log exercise data for debugging image URLs
      const exerciseImageDebug = workoutExs?.map(we => ({
        id: we.id,
        name: we.exercise?.name,
        image_url: we.exercise?.image_url,
        has_image: !!we.exercise?.image_url,
        image_url_type: typeof we.exercise?.image_url,
        image_url_length: we.exercise?.image_url?.length || 0
      }));
      console.log('[WorkoutDetail] Loaded exercises with image data:', exerciseImageDebug);

      const missingImages = exerciseImageDebug?.filter(e => !e.has_image);
      if (missingImages && missingImages.length > 0) {
        console.warn('[WorkoutDetail] Exercises missing image_url:', missingImages);
      }

      const exercisesWithSets = await Promise.all(
        (workoutExs || []).map(async (we: any) => {
          const { data: sets } = await supabase
            .from("sets")
            .select("*")
            .eq("workout_exercise_id", we.id)
            .order("set_no");

          const previousSnapshot = await fetchLastSessionForExercise(we.exercise_id, we.exercise?.is_unilateral ?? false);

          const toNumber = (value: unknown): number | null => {
            if (value === null || value === undefined) return null;
            if (typeof value === "number") {
              return Number.isFinite(value) ? value : null;
            }
            const parsed = Number(value);
            return Number.isFinite(parsed) ? parsed : null;
          };

          const normalizedSets: Set[] = (sets || []).map((set: any) => ({
            id: set.id,
            set_no: set.set_no,
            weight: toNumber(set.weight),
            unit: set.unit === "lb" ? "lb" : "kg",
            reps: toNumber(set.reps),
            rpe: toNumber(set.rpe),
            rir: toNumber(set.rir),
            is_warmup: Boolean(set.is_warmup),
            notes: set.notes ?? null,
            is_unilateral: Boolean(set.is_unilateral),
            left_weight: toNumber(set.left_weight),
            right_weight: toNumber(set.right_weight),
            left_reps: toNumber(set.left_reps),
            right_reps: toNumber(set.right_reps),
            left_rir: toNumber(set.left_rir),
            right_rir: toNumber(set.right_rir),
            left_notes: set.left_notes ?? null,
            right_notes: set.right_notes ?? null,
          }));

          return {
            ...we,
            exercise: we.exercise,
            sets: normalizedSets,
            lastSessionSets: previousSnapshot.sets,
            lastSessionDate: previousSnapshot.startedAt,
          };
        })
      );

      // Try to restore lastSessionSets from IndexedDB cache to preserve comparison data
      // This is especially important for historical workouts where the database fetch might fail
      let finalExercises = exercisesWithSets;
      try {
        const { getDB } = await import('@/lib/db/indexedDB');
        const db = await getDB();

        // First, try to query workout_history store for previous workout data
        finalExercises = await Promise.all(
          exercisesWithSets.map(async (dbEx) => {
            // If we already have lastSessionSets from database, use them
            if (dbEx.lastSessionSets && dbEx.lastSessionSets.length > 0) {
              return dbEx;
            }

            // Otherwise, try to get previous workout data from workout_history cache
            try {
              const historyKey = `${session.user.id}-${dbEx.exercise_id}`;
              const cachedHistory = await db.get('workout_history', historyKey);

              // CRITICAL: Exclude current workout from cache to prevent showing current data as "previous"
              const isCachedDataFromCurrentWorkout = cachedHistory?.lastSession?.workoutId === id;

              console.log('[WorkoutDetail] Checking workout_history cache:', {
                exerciseId: dbEx.exercise_id,
                cachedWorkoutId: cachedHistory?.lastSession?.workoutId,
                currentWorkoutId: id,
                isSameWorkout: isCachedDataFromCurrentWorkout,
                willUseCache: !isCachedDataFromCurrentWorkout && cachedHistory?.lastSession?.sets?.length > 0
              });

              if (!isCachedDataFromCurrentWorkout && cachedHistory?.lastSession?.sets && cachedHistory.lastSession.sets.length > 0) {
                console.log('[WorkoutDetail] ✅ Restored lastSessionSets from workout_history for exercise:', {
                  exerciseId: dbEx.exercise_id,
                  name: dbEx.exercise?.name,
                  setsCount: cachedHistory.lastSession.sets.length,
                  lastSessionDate: cachedHistory.lastSession.endedAt,
                  cachedWorkoutId: cachedHistory.lastSession.workoutId
                });

                // Convert cached sets to PreviousSetSnapshot format
                const previousSets: PreviousSetSnapshot[] = cachedHistory.lastSession.sets.map((set: any) => ({
                  weight: set.weight ?? null,
                  reps: set.reps ?? null,
                  rir: set.rir ?? null,
                  isWarmup: set.isWarmup ?? false,
                  unit: set.unit ?? null,
                  isUnilateral: set.isUnilateral ?? false,
                  leftWeight: set.leftWeight ?? null,
                  rightWeight: set.rightWeight ?? null,
                  leftReps: set.leftReps ?? null,
                  rightReps: set.rightReps ?? null,
                  leftRir: set.leftRir ?? null,
                  rightRir: set.rightRir ?? null,
                }));

                return {
                  ...dbEx,
                  lastSessionSets: previousSets,
                  lastSessionDate: cachedHistory.lastSession.endedAt,
                };
              } else if (isCachedDataFromCurrentWorkout) {
                console.log('[WorkoutDetail] ⚠️ Skipping cache - it contains current workout data:', {
                  exerciseId: dbEx.exercise_id,
                  cachedWorkoutId: cachedHistory?.lastSession?.workoutId,
                  currentWorkoutId: id
                });
              }
            } catch (historyError) {
              console.warn('[WorkoutDetail] Failed to query workout_history for exercise:', dbEx.exercise_id, historyError);
            }

            return dbEx;
          })
        );

        // REMOVED: Third fallback to cached workout data
        // This was getting the CURRENT workout's cache (id as string), which would
        // show current workout data as "previous" data. We already tried:
        // 1. Database query (with exclusion)
        // 2. workout_history cache (with exclusion)
        // If neither worked, we should show no previous data rather than wrong data.

      } catch (error) {
        console.warn('[WorkoutDetail] Failed to restore cached lastSessionSets:', error);
        // Continue with database data if cache restoration fails
      }

      setExercises(finalExercises);
    } catch (error: any) {
      console.error("Failed to load workout details", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to load workout details",
        variant: "destructive",
      });
      navigate("/history");
    } finally {
      setLoading(false);
    }
  };

  const getWorkoutDuration = () => {
    if (!workout?.started_at || !workout?.ended_at) return "Unknown";

    const start = new Date(workout.started_at);
    const end = new Date(workout.ended_at);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) return "Unknown";

    const diff = Math.floor((end.getTime() - start.getTime()) / 60000);

    if (diff < 60) return `${diff} minutes`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return `${hours}h ${mins}m`;
  };

  const getTotalVolume = () => {
    let volume = 0;
    exercises.forEach((ex) => {
      ex.sets.forEach((set) => {
        if (!set.is_warmup) {
          if (set.is_unilateral) {
            // For unilateral exercises, add left + right volume
            const leftWeight = set.left_weight ?? 0;
            const rightWeight = set.right_weight ?? 0;
            const leftReps = set.left_reps ?? 0;
            const rightReps = set.right_reps ?? 0;
            volume += leftWeight * leftReps + rightWeight * rightReps;
          } else {
            // For bilateral exercises, use standard calculation
            const weight = set.weight ?? 0;
            const reps = set.reps ?? 0;
            volume += weight * reps;
          }
        }
      });
    });
    return volume.toFixed(0);
  };

  const handleShare = useCallback(
    async (action: ShareAction) => {
      console.log('=== SHARE DEBUG START ===');
      console.log('[handleShare] Starting with action:', action);
      console.log('[handleShare] workout exists:', !!workout);
      console.log('[handleShare] exercises count:', exercises.length);
      console.log('[handleShare] loading state:', loading);
      console.log('[handleShare] shareContentRef exists:', !!shareContentRef.current);

      if (!shareContentRef.current) {
        console.error('[handleShare] FAILED: No shareContentRef available');
        toast({
          title: "Share unavailable",
          description: "The workout content is still loading. Please try again in a moment.",
          variant: "destructive",
        });
        return;
      }

      if (typeof window === "undefined") {
        console.error('[handleShare] FAILED: Window is undefined');
        toast({
          title: "Share unavailable",
          description: "Sharing is only supported in the app or browser.",
          variant: "destructive",
        });
        return;
      }

      if (!workout) {
        console.error('[handleShare] FAILED: Workout data not loaded');
        console.error('[handleShare] workout object:', workout);
        toast({
          title: "Workout still loading",
          description: "Please wait for the workout details to finish loading before sharing.",
          variant: "destructive",
        });
        return;
      }

      if (loading) {
        console.error('[handleShare] FAILED: Page still loading');
        toast({
          title: "Workout still loading",
          description: "Please wait for the workout details to finish loading before sharing.",
          variant: "destructive",
        });
        return;
      }

      if (!exercises || exercises.length === 0) {
        console.error('[handleShare] FAILED: No exercises loaded');
        toast({
          title: "No exercises found",
          description: "Please wait for the workout details to finish loading before sharing.",
          variant: "destructive",
        });
        return;
      }

      console.log('[handleShare] All validation checks passed!');

      // Additional data validation for share preparation
      console.log('[handleShare] Validating exercise data for share...');
      const exercisesWithComparison = exercises.filter(e => e.lastSessionSets && e.lastSessionSets.length > 0);
      const exercisesWithSets = exercises.filter(e => e.sets && e.sets.length > 0);

      console.log('[handleShare] Data validation results:', {
        totalExercises: exercises.length,
        exercisesWithSets: exercisesWithSets.length,
        exercisesWithComparison: exercisesWithComparison.length,
        exerciseNames: exercises.map(e => e.exercise?.name || 'unknown')
      });

      // Log detailed exercise structure for debugging
      console.log('[handleShare] Detailed exercise data:', exercises.map(e => ({
        id: e.id,
        exerciseName: e.exercise?.name,
        hasSets: !!e.sets && e.sets.length > 0,
        setsCount: e.sets?.length || 0,
        hasLastSessionSets: !!e.lastSessionSets && e.lastSessionSets.length > 0,
        lastSessionSetsCount: e.lastSessionSets?.length || 0,
        firstSet: e.sets?.[0] ? {
          hasWeight: e.sets[0].weight !== null && e.sets[0].weight !== undefined,
          hasReps: e.sets[0].reps !== null && e.sets[0].reps !== undefined,
          isUnilateral: e.sets[0].is_unilateral
        } : null
      })));

      // Warn if comparison data is missing but allow share to proceed
      if (exercisesWithComparison.length === 0 && exercises.length > 0) {
        console.warn('[handleShare] No comparison data available for any exercises. Share will proceed without comparison data.');
      }

      setActiveShare(action);
      console.log('[handleShare] Active share set to:', action);

      // Wait for React to re-render with activeShare state updated
      // This ensures images switch from lazy to eager loading
      await new Promise(resolve => setTimeout(resolve, 300));

      try {
        console.log('[handleShare] Starting capture process...');
        const node = shareContentRef.current;
        // Show export-only content during capture
        node.setAttribute('data-exporting', 'true');

        // Wait for images to load (especially lazy-loaded ones)
        console.log('[handleShare] Waiting for images to load...');
        const images = node.querySelectorAll('img');
        console.log('[handleShare] Found', images.length, 'images in DOM');
        console.log('[handleShare] Image sources:', Array.from(images).map(img => ({
          src: img.src,
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          width: img.width,
          height: img.height
        })));

        await Promise.all(
          Array.from(images).map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve, reject) => {
              img.onload = () => resolve(null);
              img.onerror = () => {
                console.error('[handleShare] Image failed to load:', img.src);
                resolve(null); // Resolve even on error to not block
              };
              // Timeout after 8 seconds for external images to fully load
              setTimeout(() => {
                console.warn('[handleShare] Image load timeout:', img.src);
                resolve(null);
              }, 8000);
            });
          })
        );
        console.log('[handleShare] All images loaded/timed out');

        // Convert external images to data URLs to avoid any CORS issues during html-to-image capture
        console.log('[handleShare] Converting images to data URLs...');
        const allImages = node.querySelectorAll<HTMLImageElement>('img');
        const externalImages = Array.from(allImages).filter(img =>
          img.src &&
          (img.src.startsWith('http://') || img.src.startsWith('https://')) &&
          !img.src.startsWith('data:')
        );

        console.log('[handleShare] Found', externalImages.length, 'external images to convert');

        for (const img of externalImages) {
          try {
            console.log('[handleShare] Converting image:', img.src.substring(0, 50));

            if (!img.complete || !img.naturalWidth) {
              console.warn('[handleShare] Image not loaded, skipping:', img.src);
              continue;
            }

            // Create canvas and draw image
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d', { willReadFrequently: false });

            if (ctx) {
              // Try to draw - if CORS blocks this, we'll catch the error
              try {
                ctx.drawImage(img, 0, 0);
                const dataUrl = canvas.toDataURL('image/png');
                img.src = dataUrl;
                console.log('[handleShare] Successfully converted image');
              } catch (drawError) {
                console.warn('[handleShare] Could not draw image (CORS blocked):', drawError);
                // Image will remain as external URL - html-to-image will try to fetch it
              }
            }
          } catch (error) {
            console.warn('[handleShare] Failed to convert image:', error);
            // Continue with other images
          }
        }

        console.log('[handleShare] Image conversion complete');

        // Remove overflow constraints from both the node and its parent container
        const originalOverflow = node.style.overflow;
        const originalMaxHeight = node.style.maxHeight;
        const originalHeight = node.style.height;
        node.style.overflow = 'visible';
        node.style.maxHeight = 'none';
        node.style.height = 'auto';

        // Also remove overflow from parent main container
        const parentMain = node.parentElement;
        const originalParentOverflow = parentMain?.style.overflow;
        const originalParentMaxHeight = parentMain?.style.maxHeight;
        const originalParentHeight = parentMain?.style.height;
        if (parentMain) {
          parentMain.style.overflow = 'visible';
          parentMain.style.maxHeight = 'none';
          parentMain.style.height = 'auto';
        }

        // Scroll to top to ensure all content is visible
        node.scrollTop = 0;
        if (parentMain) {
          parentMain.scrollTop = 0;
        }

        // Force layout recalculation
        node.getBoundingClientRect();
        if (parentMain) {
          parentMain.getBoundingClientRect();
        }

        // Wait for layout to fully settle
        await new Promise(resolve => setTimeout(resolve, 200));

        // Apply grid layout directly for PNG exports
        const exercisesGrid = node.querySelector('.exercises-grid') as HTMLElement;
        let originalGridStyle = '';
        let originalNodeStyle = '';
        let originalMarginStyle: string[] = [];

        if ((action === 'png' || action === 'camera' || action === 'pdf') && exercisesGrid) {
          node.setAttribute('data-export-type', action === 'pdf' ? 'pdf' : 'png');

          // Apply grid layout - single column for PDF, 2 columns for PNG
          originalGridStyle = exercisesGrid.style.cssText;
          exercisesGrid.style.display = 'grid';
          exercisesGrid.style.gridTemplateColumns = action === 'pdf' ? '1fr' : 'repeat(2, 1fr)';
          exercisesGrid.style.gap = '1rem';

          // Remove margins from children
          const children = exercisesGrid.children;
          for (let i = 0; i < children.length; i++) {
            const child = children[i] as HTMLElement;
            originalMarginStyle.push(child.style.cssText);
            child.style.margin = '0';
          }
        }

        console.log('[handleShare] Calling captureNodeToImage...');
        // Log initial dimensions
        console.log('[handleShare] Initial node structure:', {
          tagName: node.tagName,
          childCount: node.children.length,
          clientWidth: node.clientWidth,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          offsetHeight: node.offsetHeight,
          isFullyVisible: node.scrollHeight <= node.clientHeight
        });

        // Log parent dimensions too
        if (parentMain) {
          console.log('[handleShare] Parent main structure:', {
            clientHeight: parentMain.clientHeight,
            scrollHeight: parentMain.scrollHeight,
            offsetHeight: parentMain.offsetHeight
          });
        }

        if (node.scrollHeight > node.clientHeight) {
          console.error('[handleShare] PROBLEM: Content is cut off!', {
            scrollHeight: node.scrollHeight,
            clientHeight: node.clientHeight,
            difference: node.scrollHeight - node.clientHeight
          });
        } else {
          console.log('[handleShare] ✓ All content appears visible');
        }

        const useLowerQuality = false; // Always use high quality
        let dataUrl, width, height;

        // If content is still cut off, try a different approach: clone and capture outside normal layout
        let clonedNode: HTMLElement | null = null;
        let nodeToCapture = node;

        if (node.scrollHeight > node.clientHeight) {
          console.warn('[handleShare] Content is cut off, using clone technique...');

          // Clone the node
          clonedNode = node.cloneNode(true) as HTMLElement;

          // Style the clone to be unconstrained
          clonedNode.style.position = 'absolute';
          clonedNode.style.left = '-9999px';
          clonedNode.style.top = '0';
          clonedNode.style.width = '800px';
          clonedNode.style.maxWidth = '800px';
          clonedNode.style.overflow = 'visible';
          clonedNode.style.maxHeight = 'none';
          clonedNode.style.height = 'auto';
          clonedNode.style.zIndex = '-1';

          // Append to body (outside all containers)
          document.body.appendChild(clonedNode);

          // Wait for render
          await new Promise(resolve => setTimeout(resolve, 100));

          // Use the clone for capture
          nodeToCapture = clonedNode;

          console.log('[handleShare] Cloned node dimensions:', {
            clientHeight: clonedNode.clientHeight,
            scrollHeight: clonedNode.scrollHeight,
            offsetHeight: clonedNode.offsetHeight
          });
        }

        try {
          const result = await captureNodeToImage(nodeToCapture, useLowerQuality);
          dataUrl = result.dataUrl;
          width = result.width;
          height = result.height;
          console.log('[handleShare] Capture complete, dimensions:', width, 'x', height);
        } catch (captureError) {
          console.error('[handleShare] Image capture failed:', captureError);
          console.error('[handleShare] Capture error details:', {
            message: captureError instanceof Error ? captureError.message : String(captureError),
            stack: captureError instanceof Error ? captureError.stack : 'N/A'
          });
          throw new Error(`Failed to capture workout image: ${captureError instanceof Error ? captureError.message : 'Unknown error'}`);
        }

        // Clean up cloned node if we used it
        if (clonedNode && document.body.contains(clonedNode)) {
          document.body.removeChild(clonedNode);
          console.log('[handleShare] Removed cloned node');
        }

        // Restore original styles
        if ((action === 'png' || action === 'camera' || action === 'pdf') && exercisesGrid) {
          exercisesGrid.style.cssText = originalGridStyle;
          const children = exercisesGrid.children;
          for (let i = 0; i < children.length; i++) {
            const child = children[i] as HTMLElement;
            child.style.cssText = originalMarginStyle[i] || '';
          }
        }

        // Restore overflow properties
        node.style.overflow = originalOverflow;
        node.style.maxHeight = originalMaxHeight;
        node.style.height = originalHeight;

        // Restore parent styles
        if (parentMain) {
          parentMain.style.overflow = originalParentOverflow || '';
          parentMain.style.maxHeight = originalParentMaxHeight || '';
          parentMain.style.height = originalParentHeight || '';
        }

        // Hide export-only content after capture
        node.removeAttribute('data-exporting');
        node.removeAttribute('data-export-type');
        const workoutDate = workout?.started_at && !isNaN(new Date(workout.started_at).getTime())
          ? new Date(workout.started_at)
          : new Date();
        const fileBaseName = `minimalog-workout-${format(workoutDate, "yyyy-MM-dd_HH-mm")}`;
        const shareLabel = `Workout from ${format(workoutDate, "PPP")}`;
        const isNative = Capacitor.isNativePlatform();

        if (action === "png") {
          if (isNative) {
            const base64 = extractBase64Payload(dataUrl);
            await shareNativeBase64(base64, `${fileBaseName}.png`, shareLabel);
            toast({
              title: "Share sheet opened",
              description: "Choose an app to send your PNG workout summary.",
            });
          } else {
            const shared = await tryWebShareFile(
              dataUrl,
              `${fileBaseName}.png`,
              "image/png",
              "Workout Summary",
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
                description: "Send your workout anywhere via the browser share menu.",
              });
            }
          }
        } else if (action === "pdf") {
          console.log('[PDF] Starting PDF generation...');
          console.log('[PDF] Image dimensions:', width, 'x', height);

          // Ensure dimensions are within jsPDF's absolute limits
          const PDF_MAX_DIMENSION = 10000;
          let pdfWidth = width;
          let pdfHeight = height;

          if (width > PDF_MAX_DIMENSION || height > PDF_MAX_DIMENSION) {
            console.log('[PDF] Dimensions exceed limit, scaling down further...');
            const scale = Math.min(PDF_MAX_DIMENSION / width, PDF_MAX_DIMENSION / height);
            pdfWidth = Math.floor(width * scale);
            pdfHeight = Math.floor(height * scale);
            console.log('[PDF] Scaled PDF dimensions:', pdfWidth, 'x', pdfHeight);
          }

          const orientation = pdfWidth >= pdfHeight ? "landscape" : "portrait";
          console.log('[PDF] Orientation:', orientation);

          console.log('[PDF] Creating jsPDF instance with light compression...');
          const pdf = new jsPDF({
            orientation,
            unit: "px",
            format: [pdfWidth, pdfHeight],
            compress: true,
          });
          console.log('[PDF] jsPDF instance created');

          console.log('[PDF] Converting to JPEG at 92% quality for ~5-6MB size...');
          const optimizedPdfImage = await convertToJpegDataUrl(dataUrl, 0.92);
          console.log('[PDF] JPEG conversion complete, length:', optimizedPdfImage.length);

          console.log('[PDF] Adding image to PDF...');
          pdf.addImage(optimizedPdfImage, "JPEG", 0, 0, pdfWidth, pdfHeight);
          console.log('[PDF] Image added to PDF');

          if (isNative) {
            console.log('[PDF] Native platform detected, preparing base64...');
            const pdfBase64 = extractBase64Payload(pdf.output("datauristring"));
            console.log('[PDF] PDF base64 extracted, length:', pdfBase64.length);
            console.log('[PDF] Estimated file size (MB):', (pdfBase64.length * 0.75 / 1024 / 1024).toFixed(2));

            console.log('[PDF] Calling shareNativeBase64...');
            await shareNativeBase64(pdfBase64, `${fileBaseName}.pdf`, shareLabel);
            console.log('[PDF] shareNativeBase64 completed successfully');
          } else {
            console.log('[PDF] Web platform, saving PDF...');
            pdf.save(`${fileBaseName}.pdf`);
            console.log('[PDF] PDF saved');
            toast({
              title: "PDF download started",
              description: "Your workout PDF is ready to share.",
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
        console.error("[handleShare] Error occurred:", error);
        console.error("[handleShare] Error type:", error instanceof Error ? error.constructor.name : typeof error);
        console.error("[handleShare] Error stack:", error instanceof Error ? error.stack : 'N/A');
        console.error("[handleShare] Debug info:", {
          workoutId: workout?.id,
          exercisesCount: exercises.length,
          exercisesWithLastSession: exercises.filter(e => e.lastSessionSets && e.lastSessionSets.length > 0).length,
          action: action,
          hasShareContentRef: !!shareContentRef.current
        });

        // Try to reload workout data once and retry if it was a data-related error
        const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
        const isDataError = errorMessage.includes('no data') ||
                           errorMessage.includes('not found') ||
                           errorMessage.includes('missing') ||
                           errorMessage.includes('undefined');

        if (isDataError && !loading) {
          console.log('[handleShare] Detected data error, attempting to reload workout data...');
          try {
            await loadWorkoutDetail();
            console.log('[handleShare] Workout data reloaded, please try sharing again');
            toast({
              title: "Data refreshed",
              description: "Workout data has been reloaded. Please try sharing again.",
            });
            return;
          } catch (reloadError) {
            console.error('[handleShare] Failed to reload workout data:', reloadError);
          }
        }

        toast({
          title: "Share failed",
          description:
            error instanceof Error
              ? error.message
              : "We couldn't prepare your workout export. Please try again.",
          variant: "destructive",
        });
      } finally {
        console.log('[handleShare] Finally block - resetting active share');
        setActiveShare(null);
      }
    },
    [toast, workout, loading, exercises]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading workout...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col overflow-hidden">
      <style>{`
        /* Hide export-only content by default */
        .export-only {
          display: none !important;
        }
        /* Show export-only content during export */
        [data-exporting="true"] .export-only {
          display: block !important;
        }
        [data-exporting="true"][data-export-type="png"] .exercises-grid {
          display: grid !important;
          grid-template-columns: repeat(2, 1fr) !important;
          gap: 1rem !important;
        }
        [data-exporting="true"][data-export-type="pdf"] .exercises-grid {
          display: grid !important;
          grid-template-columns: 1fr !important;
          gap: 1rem !important;
        }
        [data-exporting="true"][data-export-type="png"] .exercises-grid > *,
        [data-exporting="true"][data-export-type="pdf"] .exercises-grid > * {
          margin: 0 !important;
        }
      `}</style>
      {/* Header */}
      <header
        className="border-b sticky top-0 bg-background z-10"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px) + 1rem, 2.5rem)" }}
      >
        <div className="container mx-auto px-4 pb-4 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate("/history")}
            className="h-10 w-10"
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold truncate">Workout Details</h1>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10"
                aria-label="Share workout"
                disabled={activeShare !== null || loading || !workout || exercises.length === 0}
              >
                {activeShare ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Share2 className="h-5 w-5" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel>Share workout</DropdownMenuLabel>
              <DropdownMenuItem disabled={activeShare !== null || loading || !workout || exercises.length === 0} onSelect={() => handleShare("pdf")}>
                <FileText className="mr-2 h-4 w-4" />
                Share as PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Content */}
      <main className="container mx-auto px-4 py-6 max-w-4xl flex-1 overflow-y-auto overflow-x-hidden smooth-scroll">
        <div ref={shareContentRef} className="space-y-4 [&[data-exporting='true']]:max-w-[800px] [&[data-exporting='true']]:mx-auto [&[data-exporting='true']]:bg-background [&[data-exporting='true']]:p-8 [&[data-exporting='true']]:rounded-3xl">
          <div className="text-center space-y-1">
            <h2 className="text-2xl font-bold tracking-tight export-only">{workoutOwnerHeading}</h2>
            <p className="text-sm uppercase tracking-[0.2em] text-muted-foreground export-only">
              Download Minimalog
            </p>
          </div>
          {/* Workout Summary */}
          <Card className="border-2">
            <CardHeader>
              <CardTitle className="text-2xl">
                {workout?.started_at && !isNaN(new Date(workout.started_at).getTime())
                  ? format(new Date(workout.started_at), "EEEE, MMMM d, yyyy")
                  : "Workout Details"}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                {workout?.started_at && !isNaN(new Date(workout.started_at).getTime())
                  ? `${format(new Date(workout.started_at), "h:mm a")} • ${getWorkoutDuration()}`
                  : getWorkoutDuration()}
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold">{exercises.length}</p>
                  <p className="text-sm text-muted-foreground">Exercises</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {exercises.reduce((acc, ex) => acc + ex.sets.filter((s) => !s.is_warmup).length, 0)}
                  </p>
                  <p className="text-sm text-muted-foreground">Working Sets</p>
                </div>
                <div>
                  <p className="text-2xl font-bold">{getTotalVolume()}</p>
                  <p className="text-sm text-muted-foreground">Total Volume</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pre-Workout Check-In */}
          {hasPreSessionMetrics && (
            <Card className="border-2">
              <CardHeader className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="text-lg">Pre-Workout Check-In</CardTitle>
                  <p className="text-sm text-muted-foreground">Logged before this session</p>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {preSessionEntries.map((entry) => (
                    <div
                      key={entry.key}
                      className="rounded-2xl border border-muted/40 bg-muted/10 px-4 py-3"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {entry.label}
                      </p>
                      <p className="mt-2 text-lg font-semibold text-foreground">
                        {entry.value}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Exercises */}
          <div className="exercises-grid space-y-4">
          {exercises.map((we) => (
            <Card key={we.id} className="border-2">
              <CardHeader>
                <div className="flex items-start gap-3">
                  <ExerciseImage
                    exerciseId={we.exercise.id}
                    imageUrl={we.exercise.image_url || undefined}
                    exerciseName={we.exercise.name}
                    className="w-16 h-16 sm:w-20 sm:h-20"
                    loading={activeShare ? "eager" : "lazy"}
                    crossOrigin="anonymous"
                  />
                  <div className="flex-1 min-w-0">
                    <CardTitle className="text-xl">
                      {we.exercise.name.replace(/\s*\(Unilateral\)\s*$/i, '').trim()}
                      {we.sets.some((set) => set.is_unilateral) && (
                        <span className="text-muted-foreground font-normal text-base"> (Unilateral)</span>
                      )}
                    </CardTitle>
                    {we.exercise.equipment && (
                      <p className="text-sm text-muted-foreground">
                        {we.exercise.equipment} • {we.exercise.muscle_group}
                      </p>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {/* Headers */}
                  <div className="grid grid-cols-6 gap-2 text-xs font-semibold text-muted-foreground pb-2 border-b">
                    <div className="text-center">SET</div>
                    <div className="col-span-2 text-left">OUTPUT</div>
                    <div className="text-center">REPS</div>
                    <div className="text-center">RIR</div>
                    <div className="text-center">W-UP</div>
                  </div>

                  {/* Sets */}
                  {we.sets.map((set) => {
                    const formatNumber = (value: number | null) => {
                      if (value === null || Number.isNaN(value)) return "-";
                      return Number.isInteger(value) ? String(value) : value.toFixed(1);
                    };

                    const renderUnilateralWeight = (
                      label: string,
                      weight: number | null
                    ) => {
                      if (weight === null) {
                        return `${label}: -`;
                      }
                      return `${label}: ${formatNumber(weight)} ${set.unit}`;
                    };

                    const renderUnilateralRir = (label: string, rir: number | null) => {
                      return `${label}: ${rir === null || Number.isNaN(rir) ? "-" : formatNumber(rir)}`;
                    };

                    const weightContent = set.is_unilateral ? (
                      <div className="space-y-1 text-left text-xs sm:text-sm">
                        <div>{renderUnilateralWeight("L", set.left_weight)}</div>
                        <div>{renderUnilateralWeight("R", set.right_weight)}</div>
                      </div>
                    ) : (
                      <span>
                        {formatNumber(set.weight)} {set.unit}
                      </span>
                    );

                    const repsContent = set.is_unilateral ? (
                      <div className="space-y-1 text-center text-xs sm:text-sm">
                        <div>L: {formatNumber(set.left_reps)}</div>
                        <div>R: {formatNumber(set.right_reps)}</div>
                      </div>
                    ) : (
                      <span>{formatNumber(set.reps)}</span>
                    );

                    const rirContent = set.is_unilateral ? (
                      <div className="space-y-1 text-center text-xs sm:text-sm">
                        <div>{renderUnilateralRir("L", set.left_rir)}</div>
                        <div>{renderUnilateralRir("R", set.right_rir)}</div>
                      </div>
                    ) : (
                      <span>{set.rir === null ? "-" : formatNumber(set.rir)}</span>
                    );

                    return (
                      <div key={set.id} className="grid grid-cols-6 gap-2 items-center text-sm">
                        <div className="text-center font-bold">{set.set_no}</div>
                        <div className="col-span-2 text-left">{weightContent}</div>
                        <div className="text-center">{repsContent}</div>
                        <div className="text-center">{rirContent}</div>
                        <div className="text-center">{set.is_warmup ? "✓" : ""}</div>
                      </div>
                    );
                  })}
                </div>

                {/* Per-Set Weight Comparison */}
                {we.sets.filter((s) => !s.is_warmup).length > 0 && (
                  <div className="mt-4 space-y-3">
                    {we.sets
                      .filter((set) => !set.is_warmup)
                      .map((set, workingSetIndex) => {
                        const formatNumber = (value: number | null) => {
                          if (value === null || Number.isNaN(value)) return "-";
                          return Number.isInteger(value) ? String(value) : value.toFixed(1);
                        };

                        // Find corresponding set from last session
                        const previousWorkingSets = (we.lastSessionSets ?? []).filter((s) => !s.isWarmup);
                        const lastSessionSet = previousWorkingSets[workingSetIndex];

                        const isUnilateral = set.is_unilateral;

                        // For bilateral exercises
                        const currentWeight = set.weight ?? 0;
                        const currentReps = set.reps ?? 0;
                        const lastWeight = lastSessionSet ? (lastSessionSet.weight ?? 0) : 0;
                        const lastReps = lastSessionSet ? (lastSessionSet.reps ?? 0) : 0;

                        // For unilateral exercises - left side
                        const currentLeftWeight = set.left_weight ?? 0;
                        const currentLeftReps = set.left_reps ?? 0;
                        const lastLeftWeight = lastSessionSet ? (lastSessionSet.leftWeight ?? 0) : 0;
                        const lastLeftReps = lastSessionSet ? (lastSessionSet.leftReps ?? 0) : 0;

                        // For unilateral exercises - right side
                        const currentRightWeight = set.right_weight ?? 0;
                        const currentRightReps = set.right_reps ?? 0;
                        const lastRightWeight = lastSessionSet ? (lastSessionSet.rightWeight ?? 0) : 0;
                        const lastRightReps = lastSessionSet ? (lastSessionSet.rightReps ?? 0) : 0;

                        // Calculate changes (treat 0 previous as valid to show increase)
                        const weightChange = currentWeight > 0 ? currentWeight - lastWeight : null;
                        const repsChange = currentReps > 0 ? currentReps - lastReps : null;

                        // Calculate unilateral changes
                        const leftWeightChange = currentLeftWeight > 0 ? currentLeftWeight - lastLeftWeight : null;
                        const leftRepsChange = currentLeftReps > 0 ? currentLeftReps - lastLeftReps : null;
                        const rightWeightChange = currentRightWeight > 0 ? currentRightWeight - lastRightWeight : null;
                        const rightRepsChange = currentRightReps > 0 ? currentRightReps - lastRightReps : null;

                        return (
                          <div
                            key={`${set.id}-comparison-${workingSetIndex}`}
                            className="rounded-xl border border-muted/60 bg-muted/20 p-3"
                          >
                            <div className="mb-2 text-sm font-semibold text-foreground">
                              Set {set.set_no}
                              {set.rir !== null ? ` · RIR ${formatNumber(set.rir)}` : ""}
                            </div>

                            {lastSessionSet ? (
                              isUnilateral ? (
                                // Unilateral comparison - show left and right separately
                                <div className="space-y-3">
                                  {/* Left Side */}
                                  <div>
                                    <div className="mb-1 text-xs font-semibold text-muted-foreground">LEFT</div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">Weight</div>
                                        <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                          <div className="flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Prev:</span>
                                            <span className="text-sm font-semibold">
                                              {formatNumber(lastLeftWeight)} {set.unit}
                                            </span>
                                          </div>
                                          <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Curr:</span>
                                            <span className="text-sm font-bold text-foreground">
                                              {formatNumber(currentLeftWeight)} {set.unit}
                                            </span>
                                          </div>
                                          {leftWeightChange !== null && leftWeightChange !== 0 && (
                                            <div
                                              className={`mt-1 text-center text-xs font-semibold ${
                                                leftWeightChange > 0 ? "text-green-600" : "text-red-600"
                                              }`}
                                            >
                                              {leftWeightChange > 0 ? "+" : ""}
                                              {formatNumber(leftWeightChange)} {set.unit}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">Reps</div>
                                        <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                          <div className="flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Prev:</span>
                                            <span className="text-sm font-semibold">{formatNumber(lastLeftReps)}</span>
                                          </div>
                                          <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Curr:</span>
                                            <span className="text-sm font-bold text-foreground">
                                              {formatNumber(currentLeftReps)}
                                            </span>
                                          </div>
                                          {leftRepsChange !== null && leftRepsChange !== 0 && (
                                            <div
                                              className={`mt-1 text-center text-xs font-semibold ${
                                                leftRepsChange > 0 ? "text-green-600" : "text-red-600"
                                              }`}
                                            >
                                              {leftRepsChange > 0 ? "+" : ""}
                                              {formatNumber(leftRepsChange)}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>

                                  {/* Right Side */}
                                  <div>
                                    <div className="mb-1 text-xs font-semibold text-muted-foreground">RIGHT</div>
                                    <div className="grid grid-cols-2 gap-2">
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">Weight</div>
                                        <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                          <div className="flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Prev:</span>
                                            <span className="text-sm font-semibold">
                                              {formatNumber(lastRightWeight)} {set.unit}
                                            </span>
                                          </div>
                                          <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Curr:</span>
                                            <span className="text-sm font-bold text-foreground">
                                              {formatNumber(currentRightWeight)} {set.unit}
                                            </span>
                                          </div>
                                          {rightWeightChange !== null && rightWeightChange !== 0 && (
                                            <div
                                              className={`mt-1 text-center text-xs font-semibold ${
                                                rightWeightChange > 0 ? "text-green-600" : "text-red-600"
                                              }`}
                                            >
                                              {rightWeightChange > 0 ? "+" : ""}
                                              {formatNumber(rightWeightChange)} {set.unit}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="space-y-1">
                                        <div className="text-xs font-medium text-muted-foreground">Reps</div>
                                        <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                          <div className="flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Prev:</span>
                                            <span className="text-sm font-semibold">{formatNumber(lastRightReps)}</span>
                                          </div>
                                          <div className="mt-1 flex items-baseline justify-between">
                                            <span className="text-xs text-muted-foreground">Curr:</span>
                                            <span className="text-sm font-bold text-foreground">
                                              {formatNumber(currentRightReps)}
                                            </span>
                                          </div>
                                          {rightRepsChange !== null && rightRepsChange !== 0 && (
                                            <div
                                              className={`mt-1 text-center text-xs font-semibold ${
                                                rightRepsChange > 0 ? "text-green-600" : "text-red-600"
                                              }`}
                                            >
                                              {rightRepsChange > 0 ? "+" : ""}
                                              {formatNumber(rightRepsChange)}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                // Bilateral comparison - original layout
                                <div className="grid grid-cols-2 gap-2">
                                  {/* Weight Column */}
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">Weight</div>
                                    <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                      <div className="flex items-baseline justify-between">
                                        <span className="text-xs text-muted-foreground">Previous:</span>
                                        <span className="text-sm font-semibold">
                                          {formatNumber(lastWeight)} {set.unit}
                                        </span>
                                      </div>
                                      <div className="mt-1 flex items-baseline justify-between">
                                        <span className="text-xs text-muted-foreground">Current:</span>
                                        <span className="text-sm font-bold text-foreground">
                                          {formatNumber(currentWeight)} {set.unit}
                                        </span>
                                      </div>
                                      {weightChange !== null && weightChange !== 0 && (
                                        <div
                                          className={`mt-1 text-center text-xs font-semibold ${
                                            weightChange > 0 ? "text-green-600" : "text-red-600"
                                          }`}
                                        >
                                          {weightChange > 0 ? "+" : ""}
                                          {formatNumber(weightChange)} {set.unit}
                                        </div>
                                      )}
                                    </div>
                                  </div>

                                  {/* Reps Column */}
                                  <div className="space-y-1">
                                    <div className="text-xs font-medium text-muted-foreground">Reps</div>
                                    <div className="rounded-lg bg-background/80 px-2 py-1.5">
                                      <div className="flex items-baseline justify-between">
                                        <span className="text-xs text-muted-foreground">Previous:</span>
                                        <span className="text-sm font-semibold">{formatNumber(lastReps)}</span>
                                      </div>
                                      <div className="mt-1 flex items-baseline justify-between">
                                        <span className="text-xs text-muted-foreground">Current:</span>
                                        <span className="text-sm font-bold text-foreground">
                                          {formatNumber(currentReps)}
                                        </span>
                                      </div>
                                      {repsChange !== null && repsChange !== 0 && (
                                        <div
                                          className={`mt-1 text-center text-xs font-semibold ${
                                            repsChange > 0 ? "text-green-600" : "text-red-600"
                                          }`}
                                        >
                                          {repsChange > 0 ? "+" : ""}
                                          {formatNumber(repsChange)}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            ) : (
                              <div className="rounded-lg bg-background/80 px-3 py-2 text-center">
                                <div className="text-sm font-semibold text-foreground">
                                  {isUnilateral ? (
                                    <>
                                      L: {formatNumber(currentLeftWeight)} {set.unit} × {formatNumber(currentLeftReps)} |
                                      R: {formatNumber(currentRightWeight)} {set.unit} × {formatNumber(currentRightReps)}
                                    </>
                                  ) : (
                                    <>
                                      {formatNumber(currentWeight)} {set.unit} × {formatNumber(currentReps)} reps
                                    </>
                                  )}
                                </div>
                                <div className="mt-1 text-xs text-muted-foreground">No previous data</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}

                <ProgressComparison
                  currentSets={we.sets}
                  previousSets={we.lastSessionSets ?? []}
                  previousDate={we.lastSessionDate}
                  preferredUnit={preferredUnit}
                />
              </CardContent>
            </Card>
          ))}
          </div>

          {/* Session Comparison - Aggregate stats across all exercises */}
          {(() => {
            // Calculate aggregate session totals
            let currentSessionLeftVolume = 0;
            let currentSessionRightVolume = 0;
            let currentSessionTotalVolume = 0;
            let currentSessionLeftReps = 0;
            let currentSessionRightReps = 0;
            let currentSessionTotalReps = 0;
            let hasCurrentLeft = false;
            let hasCurrentRight = false;
            let hasCurrentVolume = false;
            let hasCurrentReps = false;

            let previousSessionLeftVolume = 0;
            let previousSessionRightVolume = 0;
            let previousSessionTotalVolume = 0;
            let previousSessionLeftReps = 0;
            let previousSessionRightReps = 0;
            let previousSessionTotalReps = 0;
            let hasPreviousLeft = false;
            let hasPreviousRight = false;
            let hasPreviousVolume = false;
            let hasPreviousReps = false;

            // Iterate through all exercises to calculate session totals
            exercises.forEach((we) => {
              const workingSets = we.sets.filter((set) => !set.is_warmup);
              const previousWorkingSets = (we.lastSessionSets ?? []).filter((set) => !set.isWarmup);
              const isUnilateral = we.exercise?.is_unilateral ?? false;

              if (isUnilateral) {
                // For unilateral exercises, track left/right separately per exercise
                let exerciseLeftVolume = 0;
                let exerciseRightVolume = 0;
                let exerciseLeftReps = 0;
                let exerciseRightReps = 0;

                workingSets.forEach((set) => {
                  // Try to get left/right specific data first
                  let leftWeight = set.left_weight ? parseFloat(String(set.left_weight)) : null;
                  let rightWeight = set.right_weight ? parseFloat(String(set.right_weight)) : null;
                  let leftReps = set.left_reps ? parseFloat(String(set.left_reps)) : null;
                  let rightReps = set.right_reps ? parseFloat(String(set.right_reps)) : null;

                  // Fallback: if no left/right data, use standard weight/reps fields
                  // This handles cases where unilateral exercises were logged with standard fields
                  const hasLeftRightData = (leftWeight !== null || rightWeight !== null || leftReps !== null || rightReps !== null);

                  if (!hasLeftRightData) {
                    const weight = set.weight ? parseFloat(String(set.weight)) : null;
                    const reps = set.reps ? parseFloat(String(set.reps)) : null;

                    // Use the standard weight/reps for both sides when no side-specific data exists
                    if (weight !== null && reps !== null && !isNaN(weight) && !isNaN(reps)) {
                      currentSessionTotalVolume += weight * reps;
                      currentSessionTotalReps += reps;
                      hasCurrentVolume = true;
                      hasCurrentReps = true;
                    }
                  } else {
                    // Process side-specific data
                    if (leftWeight !== null && leftReps !== null && !isNaN(leftWeight) && !isNaN(leftReps)) {
                      exerciseLeftVolume += leftWeight * leftReps;
                      exerciseLeftReps += leftReps;
                      hasCurrentLeft = true;
                      hasCurrentVolume = true;
                      hasCurrentReps = true;
                    }
                    if (rightWeight !== null && rightReps !== null && !isNaN(rightWeight) && !isNaN(rightReps)) {
                      exerciseRightVolume += rightWeight * rightReps;
                      exerciseRightReps += rightReps;
                      hasCurrentRight = true;
                      hasCurrentVolume = true;
                      hasCurrentReps = true;
                    }
                  }
                });

                currentSessionLeftVolume += exerciseLeftVolume;
                currentSessionRightVolume += exerciseRightVolume;
                currentSessionTotalVolume += exerciseLeftVolume + exerciseRightVolume;
                currentSessionLeftReps += exerciseLeftReps;
                currentSessionRightReps += exerciseRightReps;
                currentSessionTotalReps += exerciseLeftReps + exerciseRightReps;

                let prevExerciseLeftVolume = 0;
                let prevExerciseRightVolume = 0;
                let prevExerciseLeftReps = 0;
                let prevExerciseRightReps = 0;

                previousWorkingSets.forEach((set) => {
                  // Try to get left/right specific data first
                  let leftWeight = set.leftWeight ? parseFloat(String(set.leftWeight)) : null;
                  let rightWeight = set.rightWeight ? parseFloat(String(set.rightWeight)) : null;
                  let leftReps = set.leftReps ? parseFloat(String(set.leftReps)) : null;
                  let rightReps = set.rightReps ? parseFloat(String(set.rightReps)) : null;

                  // Fallback: if no left/right data, use standard weight/reps fields
                  const hasLeftRightData = (leftWeight !== null || rightWeight !== null || leftReps !== null || rightReps !== null);

                  if (!hasLeftRightData) {
                    const weight = set.weight ? parseFloat(String(set.weight)) : null;
                    const reps = set.reps ? parseFloat(String(set.reps)) : null;

                    if (weight !== null && reps !== null && !isNaN(weight) && !isNaN(reps)) {
                      previousSessionTotalVolume += weight * reps;
                      previousSessionTotalReps += reps;
                      hasPreviousVolume = true;
                      hasPreviousReps = true;
                    }
                  } else {
                    // Process side-specific data
                    if (leftWeight !== null && leftReps !== null && !isNaN(leftWeight) && !isNaN(leftReps)) {
                      prevExerciseLeftVolume += leftWeight * leftReps;
                      prevExerciseLeftReps += leftReps;
                      hasPreviousLeft = true;
                      hasPreviousVolume = true;
                      hasPreviousReps = true;
                    }
                    if (rightWeight !== null && rightReps !== null && !isNaN(rightWeight) && !isNaN(rightReps)) {
                      prevExerciseRightVolume += rightWeight * rightReps;
                      prevExerciseRightReps += rightReps;
                      hasPreviousRight = true;
                      hasPreviousVolume = true;
                      hasPreviousReps = true;
                    }
                  }
                });

                previousSessionLeftVolume += prevExerciseLeftVolume;
                previousSessionRightVolume += prevExerciseRightVolume;
                previousSessionTotalVolume += prevExerciseLeftVolume + prevExerciseRightVolume;
                previousSessionLeftReps += prevExerciseLeftReps;
                previousSessionRightReps += prevExerciseRightReps;
                previousSessionTotalReps += prevExerciseLeftReps + prevExerciseRightReps;
              } else {
                // For bilateral exercises, use standard calculation
                workingSets.forEach((set) => {
                  const weight = set.weight ? parseFloat(String(set.weight)) : null;
                  const reps = set.reps ? parseFloat(String(set.reps)) : null;

                  if (weight !== null && reps !== null && !isNaN(weight) && !isNaN(reps)) {
                    currentSessionTotalVolume += weight * reps;
                    currentSessionTotalReps += reps;
                    hasCurrentVolume = true;
                    hasCurrentReps = true;
                  }
                });

                previousWorkingSets.forEach((set) => {
                  const weight = set.weight ? parseFloat(String(set.weight)) : null;
                  const reps = set.reps ? parseFloat(String(set.reps)) : null;

                  if (weight !== null && reps !== null && !isNaN(weight) && !isNaN(reps)) {
                    previousSessionTotalVolume += weight * reps;
                    previousSessionTotalReps += reps;
                    hasPreviousVolume = true;
                    hasPreviousReps = true;
                  }
                });
              }
            });

            const formatMetricValue = (value: number | null, isInteger = false): string => {
              if (value === null || isNaN(value)) return '-';
              if (isInteger) return Math.round(value).toLocaleString();
              const rounded = Math.round(value * 10) / 10;
              const decimals = Math.abs(rounded - Math.round(rounded)) < 0.05 ? 0 : 1;
              return rounded.toLocaleString(undefined, {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals,
              });
            };

            const buildDeltaLabel = (
              currentValue: number | null,
              previousValue: number | null,
              unitLabel: string,
              isInteger = false
            ): { text: string; className: string } => {
              if (currentValue === null) {
                return {
                  text: 'No data',
                  className: 'text-muted-foreground',
                };
              }

              // Treat null previous value as 0 to show the delta
              const effectivePrevious = previousValue ?? 0;
              const delta = currentValue - effectivePrevious;
              const threshold = isInteger ? 1 : 0.1;

              if (Math.abs(delta) < threshold) {
                return {
                  text: 'No change',
                  className: 'text-muted-foreground',
                };
              }

              const formatted = formatMetricValue(Math.abs(delta), isInteger);
              return {
                text: `${delta > 0 ? '+' : '-'}${formatted}${unitLabel}`,
                className: delta > 0 ? 'text-green-500' : 'text-red-500',
              };
            };

            const currentVolume = hasCurrentVolume ? currentSessionTotalVolume : null;
            const previousVolume = hasPreviousVolume ? previousSessionTotalVolume : null;
            const currentReps = hasCurrentReps ? currentSessionTotalReps : null;
            const previousReps = hasPreviousReps ? previousSessionTotalReps : null;

            const volumeDelta = buildDeltaLabel(currentVolume, previousVolume, ` ${preferredUnit}·reps`);
            const repsDelta = buildDeltaLabel(currentReps, previousReps, ' reps', true);

            // Show if there's any current session data (don't require previous session data)
            const hasAnyData = hasCurrentVolume || hasCurrentReps;
            if (!hasAnyData) {
              return null;
            }

            return (
              <Card className="border-2 mt-6">
                <CardHeader>
                  <CardTitle className="text-xl font-bold">Session Totals</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Aggregate stats across all exercises (warmup sets excluded)
                  </p>
                </CardHeader>
                <CardContent className="space-y-6">
                  {/* Total Volume */}
                  {hasCurrentVolume && (
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-base font-semibold text-foreground">Total Volume</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {previousVolume !== null ? `Last time: ${formatMetricValue(previousVolume)} ${preferredUnit}·reps` : 'No previous data'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-foreground">
                          {currentVolume !== null ? `${formatMetricValue(currentVolume)} ${preferredUnit}·reps` : '-'}
                        </p>
                        <p className={`text-xs font-semibold mt-1 ${volumeDelta.className}`}>{volumeDelta.text}</p>
                      </div>
                    </div>
                  )}

                  {/* Total Reps */}
                  {hasCurrentReps && (
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <p className="text-base font-semibold text-foreground">Total Reps</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {previousReps !== null ? `Last time: ${formatMetricValue(previousReps, true)} reps` : 'No previous data'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-bold text-foreground">
                          {currentReps !== null ? `${formatMetricValue(currentReps, true)} reps` : '-'}
                        </p>
                        <p className={`text-xs font-semibold mt-1 ${repsDelta.className}`}>{repsDelta.text}</p>
                      </div>
                    </div>
                  )}

                  {/* Left/Right Breakdown for Unilateral Exercises */}
                  {(hasCurrentLeft || hasCurrentRight) && (
                    <div className="pt-4 border-t space-y-4">
                      <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Side Breakdown</p>

                      {hasCurrentLeft && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Left Side Volume</p>
                            <p className="text-base font-semibold text-foreground">
                              {formatMetricValue(currentSessionLeftVolume)} {preferredUnit}·reps
                            </p>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Left Side Reps</p>
                            <p className="text-base font-semibold text-foreground">
                              {formatMetricValue(currentSessionLeftReps, true)} reps
                            </p>
                          </div>
                        </div>
                      )}

                      {hasCurrentRight && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Right Side Volume</p>
                            <p className="text-base font-semibold text-foreground">
                              {formatMetricValue(currentSessionRightVolume)} {preferredUnit}·reps
                            </p>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-foreground">Right Side Reps</p>
                            <p className="text-base font-semibold text-foreground">
                              {formatMetricValue(currentSessionRightReps, true)} reps
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {workout.notes && (
            <Card className="border-2">
              <CardHeader>
                <CardTitle className="text-lg">Notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{workout.notes}</p>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
    </div>
  );
};

interface ProgressComparisonProps {
  currentSets: Set[];
  previousSets: PreviousSetSnapshot[];
  previousDate: string | null | undefined;
  preferredUnit: WeightUnit;
}

const ProgressComparison = ({ currentSets, previousSets, previousDate, preferredUnit }: ProgressComparisonProps) => {
  const workingSets = currentSets.filter((set) => !set.is_warmup);
  const previousWorkingSets = previousSets.filter((set) => !set.isWarmup);

  const hasAnyData = workingSets.length > 0 || previousWorkingSets.length > 0;
  if (!hasAnyData) {
    return null;
  }

  let previousDateLabel: string | null = null;
  if (previousDate) {
    const parsed = new Date(previousDate);
    if (!Number.isNaN(parsed.getTime())) {
      previousDateLabel = format(parsed, "MMM d, yyyy");
    }
  }

  const parseNumber = (value: string | number | null | undefined): number | null => {
    if (value === undefined || value === null || value === "") return null;
    const parsed = typeof value === "number" ? value : parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const normalizeWeight = (value: string | number | null | undefined, unit?: WeightUnit | null): number | null => {
    const parsed = parseNumber(value);
    if (parsed === null) return null;
    const fromUnit: WeightUnit = unit === "lb" ? "lb" : unit === "kg" ? "kg" : preferredUnit;
    return convertWeight(parsed, fromUnit, preferredUnit);
  };

  const formatMetricValue = (value: number, isInteger = false) => {
    if (isInteger) {
      return Math.round(value).toLocaleString();
    }
    const rounded = Math.round(value * 10) / 10;
    const decimals = Math.abs(rounded - Math.round(rounded)) < 0.05 ? 0 : 1;
    return rounded.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  };

  const buildValueLabel = (value: number | null, unitLabel: string, isInteger = false) =>
    value === null ? "-" : `${formatMetricValue(value, isInteger)}${unitLabel}`;

  const buildDeltaLabel = (
    currentValue: number | null,
    previousValue: number | null,
    unitLabel: string,
    isInteger = false
  ) => {
    if (currentValue === null) {
      return {
        text: "No data",
        className: "text-muted-foreground",
      };
    }

    // Treat null previous value as 0 to show the delta
    const effectivePrevious = previousValue ?? 0;
    const delta = currentValue - effectivePrevious;
    const threshold = isInteger ? 1 : 0.1;

    if (Math.abs(delta) < threshold) {
      return {
        text: "No change",
        className: "text-muted-foreground",
      };
    }

    const formatted = formatMetricValue(Math.abs(delta), isInteger);
    return {
      text: `${delta > 0 ? "+" : "-"}${formatted}${unitLabel}`,
      className: delta > 0 ? "text-green-500" : "text-red-500",
    };
  };

  const computeHeaviestWeight = (sets: Array<{
    weight?: number | string | null;
    unit?: WeightUnit | null;
    isUnilateral?: boolean;
    leftWeight?: number | string | null;
    rightWeight?: number | string | null;
  }>) => {
    let max: number | null = null;
    sets.forEach((set) => {
      if (set.isUnilateral) {
        // For unilateral exercises, check both left and right weights
        const leftNormalized = normalizeWeight(set.leftWeight ?? null, set.unit ?? null);
        const rightNormalized = normalizeWeight(set.rightWeight ?? null, set.unit ?? null);
        if (leftNormalized !== null && (max === null || leftNormalized > max)) {
          max = leftNormalized;
        }
        if (rightNormalized !== null && (max === null || rightNormalized > max)) {
          max = rightNormalized;
        }
      } else {
        // For bilateral exercises, use standard weight
        const normalized = normalizeWeight(set.weight ?? null, set.unit ?? null);
        if (normalized === null) return;
        if (max === null || normalized > max) {
          max = normalized;
        }
      }
    });
    return max;
  };

  const computeTotalReps = (
    sets: Array<{
      reps?: number | string | null;
      isUnilateral?: boolean;
      leftReps?: number | string | null;
      rightReps?: number | string | null;
    }>
  ) => {
    if (sets.length === 0) return null;
    let total = 0;
    let hasValue = false;
    sets.forEach((set) => {
      if (set.isUnilateral) {
        // For unilateral exercises, add left + right reps
        const leftReps = parseNumber(set.leftReps ?? null);
        const rightReps = parseNumber(set.rightReps ?? null);
        if (leftReps !== null) {
          total += leftReps;
          hasValue = true;
        }
        if (rightReps !== null) {
          total += rightReps;
          hasValue = true;
        }
      } else {
        // For bilateral exercises, use standard calculation
        const reps = parseNumber(set.reps ?? null);
        if (reps !== null) {
          total += reps;
          hasValue = true;
        }
      }
    });
    return hasValue ? total : null;
  };

  const computeVolume = (
    sets: Array<{
      weight?: number | string | null;
      unit?: WeightUnit | null;
      reps?: number | string | null;
      isUnilateral?: boolean;
      leftWeight?: number | string | null;
      rightWeight?: number | string | null;
      leftReps?: number | string | null;
      rightReps?: number | string | null;
    }>
  ) => {
    if (sets.length === 0) return null;
    let total = 0;
    let hasValue = false;
    sets.forEach((set) => {
      if (set.isUnilateral) {
        // For unilateral exercises, add left + right volume
        const leftWeight = normalizeWeight(set.leftWeight ?? null, set.unit ?? null);
        const rightWeight = normalizeWeight(set.rightWeight ?? null, set.unit ?? null);
        const leftReps = parseNumber(set.leftReps ?? null);
        const rightReps = parseNumber(set.rightReps ?? null);
        if (leftWeight !== null && leftReps !== null) {
          total += leftWeight * leftReps;
          hasValue = true;
        }
        if (rightWeight !== null && rightReps !== null) {
          total += rightWeight * rightReps;
          hasValue = true;
        }
      } else {
        // For bilateral exercises, use standard calculation
        const normalizedWeight = normalizeWeight(set.weight ?? null, set.unit ?? null);
        const reps = parseNumber(set.reps ?? null);
        if (normalizedWeight !== null && reps !== null) {
          total += normalizedWeight * reps;
          hasValue = true;
        }
      }
    });
    return hasValue ? total : null;
  };

  const currentHeaviest = computeHeaviestWeight(workingSets);
  const previousHeaviest = computeHeaviestWeight(previousWorkingSets);
  const currentTotalReps = computeTotalReps(workingSets);
  const previousTotalReps = computeTotalReps(previousWorkingSets);
  const currentVolume = computeVolume(workingSets);
  const previousVolume = computeVolume(previousWorkingSets);

  const progressRows = [
    {
      key: "heaviest",
      label: "Heaviest working set",
      previous: buildValueLabel(previousHeaviest, ` ${preferredUnit}`),
      current: buildValueLabel(currentHeaviest, ` ${preferredUnit}`),
      delta: buildDeltaLabel(currentHeaviest, previousHeaviest, ` ${preferredUnit}`),
    },
    {
      key: "reps",
      label: "Total reps",
      previous: buildValueLabel(previousTotalReps, " reps", true),
      current: buildValueLabel(currentTotalReps, " reps", true),
      delta: buildDeltaLabel(currentTotalReps, previousTotalReps, " reps", true),
    },
    {
      key: "volume",
      label: "Volume (weight × reps)",
      previous: buildValueLabel(previousVolume, ` ${preferredUnit}·reps`),
      current: buildValueLabel(currentVolume, ` ${preferredUnit}·reps`),
      delta: buildDeltaLabel(currentVolume, previousVolume, ` ${preferredUnit}·reps`),
    },
  ].filter((row) => row.current !== "-" || row.previous !== "-");

  if (progressRows.length === 0 && previousWorkingSets.length === 0) {
    return null;
  }

  return (
    <div className="mt-6 rounded-xl border border-muted/70 bg-muted/20 px-4 py-3 space-y-3">
      <div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-semibold uppercase tracking-wide">Progress vs last session</span>
          {previousDateLabel && (
            <span>{previousDateLabel}</span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/60 mt-0.5">
          Warmup sets excluded from analysis
        </p>
      </div>
      {progressRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No comparable working sets yet.</p>
      ) : (
        progressRows.map((row) => (
          <div key={row.key} className="flex items-start justify-between gap-3 text-sm">
            <div>
              <p className="font-semibold text-foreground">{row.label}</p>
              <p className="text-xs text-muted-foreground">Last time: {row.previous}</p>
            </div>
            <div className="text-right">
              <p className="font-semibold text-foreground">{row.current}</p>
              <p className={`text-xs font-medium ${row.delta.className}`}>{row.delta.text}</p>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default WorkoutDetail;
