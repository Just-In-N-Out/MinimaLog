import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSubscription } from "@/hooks/useSubscription";
import { SubscriptionBadge, FreeBadge } from "@/components/SubscriptionBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { LogOut, Pencil, X, Check, ArrowLeft, Info, RefreshCw, Download, Trash2, Crown } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { usernameSchema } from "@/lib/validation";
import { extractEmailUsername } from "@/util/names";
import { syncProfileFirstName } from "@/util/profile";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  downloadAllExerciseImagesToFilesystem,
  getExerciseImageFilesystemCacheStats,
  clearExerciseImageFilesystemCache,
} from "@/lib/cache/exerciseImageFilesystemCache";
import {
  downloadAllExerciseImages,
  getExerciseImageCacheStats,
  clearExerciseImageCache,
} from "@/lib/cache/exerciseImageCache";
import { cacheExercises, getExercisesOffline } from "@/lib/cache/exerciseCache";
import { Progress } from "@/components/ui/progress";
import { Capacitor } from "@capacitor/core";
import { logoutRevenueCatUser } from "@/lib/revenuecat";
import { useSubscriptionStore } from "@/lib/subscriptionStore";
import { LiquidGlassTabs } from "@/components/LiquidGlassTabs";

const normalizeDisplayName = (value: unknown): string => {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.toLowerCase() === "user") return "";
  return trimmed;
};

const USERNAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

const BIO_MAX_LENGTH = 240;
const CM_PER_INCH = 2.54;
const INCHES_PER_FOOT = 12;

const isSchemaCacheRelated = (message: string | null | undefined) => {
  if (!message) return false;
  const normalized = message.toLowerCase();
  return (
    normalized.includes("schema cache") ||
    normalized.includes("set_profile_height") ||
    normalized.includes("height_cm")
  );
};

const formatCm = (value: number | null) => {
  if (value === null || !Number.isFinite(value)) return "";
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toString() : rounded.toString();
};

const cmToFeetInches = (cm: number) => {
  if (!Number.isFinite(cm) || cm <= 0) return { feet: "", inches: "" };
  const totalInches = cm / CM_PER_INCH;
  let feet = Math.floor(totalInches / INCHES_PER_FOOT);
  let inches = Math.round(totalInches - feet * INCHES_PER_FOOT);
  if (inches === INCHES_PER_FOOT) {
    feet += 1;
    inches = 0;
  }
  return { feet: feet.toString(), inches: inches.toString() };
};

const feetInchesToCm = (feetRaw: string, inchesRaw: string) => {
  const feet = Number.parseFloat(feetRaw || "0");
  const inches = Number.parseFloat(inchesRaw || "0");
  if (!Number.isFinite(feet) || !Number.isFinite(inches)) return null;
  if (feet < 0 || inches < 0 || inches >= INCHES_PER_FOOT) return null;
  const totalInches = feet * INCHES_PER_FOOT + inches;
  if (totalInches <= 0) return null;
  return totalInches * CM_PER_INCH;
};

const resetSubscriptionState = () => {
  try {
    useSubscriptionStore.getState().reset();
  } catch (error) {
    console.error("Failed to reset subscription store:", error);
  }
};

interface ProfileSettingsProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  profile: any;
  userEmail: string;
  onProfileUpdate: () => void;
}

type SettingsNotificationType = "success" | "error" | "info";

interface SettingsNotification {
  id: number;
  type: SettingsNotificationType;
  title: string;
  description?: string;
}

export const ProfileSettings = ({ open, onOpenChange, profile, userEmail, onProfileUpdate }: ProfileSettingsProps) => {
  const navigate = useNavigate();
  const { isPremium, isLoading: isLoadingSubscription } = useSubscription();
  const [bodyweight, setBodyweight] = useState(profile?.bodyweight?.toString() || "");
  const [heightCmRaw, setHeightCmRaw] = useState("");
  const [heightFeetRaw, setHeightFeetRaw] = useState("");
  const [heightInchesRaw, setHeightInchesRaw] = useState("");
  const [heightUnit, setHeightUnit] = useState<"cm" | "ft">("cm");
  const [userConfirmedHeightCm, setUserConfirmedHeightCm] = useState<number | null>(null);
  const [heightFeedback, setHeightFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [heightLastEditedUnit, setHeightLastEditedUnit] = useState<"cm" | "ft" | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [username, setUsername] = useState(profile?.username || "");
  const [bio, setBio] = useState(profile?.bio || "");
  const [savingBio, setSavingBio] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingDisplayName, setSavingDisplayName] = useState(false);
  const [notifications, setNotifications] = useState<SettingsNotification[]>([]);
  const notificationIdRef = useRef(0);
  const [isPrivateAccount, setIsPrivateAccount] = useState<boolean>(Boolean(profile?.is_private));
  const [savingPrivacy, setSavingPrivacy] = useState(false);
  const [aiTipsEnabled, setAiTipsEnabled] = useState<boolean>(Boolean(profile?.ai_tips_consent));
  const [savingAiConsent, setSavingAiConsent] = useState(false);
  const [unitDefault, setUnitDefault] = useState<"kg" | "lb">(profile?.unit_default || "kg");

  // Offline Mode states
  const [downloadingImages, setDownloadingImages] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const [cacheStats, setCacheStats] = useState({ count: 0, estimatedSizeMB: 0 });

  // Account Deletion states
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deletingAccount, setDeletingAccount] = useState(false);
  const notificationStyleMap: Record<SettingsNotificationType, string> = {
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600",
    error: "border-destructive/40 bg-destructive/10 text-destructive",
    info: "border-muted bg-muted/30 text-foreground",
  };

  const emailFallbackName = extractEmailUsername(userEmail);
  const resolvedName = (() => {
    const fullNameValue = normalizeDisplayName(profile?.full_name);
    if (fullNameValue) return fullNameValue;
    const nameValue = normalizeDisplayName(profile?.name);
    if (nameValue) return nameValue;
    const usernameValue = normalizeDisplayName(profile?.username);
    if (usernameValue) return usernameValue;
    return emailFallbackName || "Not provided";
  })();
  if (import.meta.env.DEV) console.log("ProfileSettings resolved name:", {
    rawFullName: profile?.full_name,
    rawName: profile?.name,
    rawUsername: profile?.username,
    emailFallbackName,
    resolvedName,
  });

  useEffect(() => {
    if (import.meta.env.DEV) console.log("ProfileSettings props update:", {
      profile,
      userEmail,
      open,
    });
    if (import.meta.env.DEV) console.log("ProfileSettings current names:", {
      full_name: profile?.full_name,
      name: profile?.name,
      username: profile?.username,
    });
  }, [profile, userEmail, open]);

  // Sync state when profile changes
  useEffect(() => {
    if (import.meta.env.DEV) console.log("ProfileSettings sync effect triggered");
    setBodyweight(profile?.bodyweight?.toString() || "");
    const normalizedUsername = normalizeDisplayName(profile?.username);
    const fallbackUsername =
      normalizedUsername ||
      normalizeDisplayName(profile?.name) ||
      normalizeDisplayName(profile?.full_name) ||
      "";
    setUsername(fallbackUsername);
    setBio(profile?.bio || "");
    setIsPrivateAccount(Boolean(profile?.is_private));

    // Only sync AI tips toggle if we're not currently saving it
    // This prevents race conditions where profile refresh overwrites optimistic update
    if (!savingAiConsent) {
      setAiTipsEnabled(Boolean(profile?.ai_tips_consent));
    }

    // Sync unit default from profile (but not during active toggle to prevent glitch)
    setUnitDefault(profile?.unit_default || "kg");

    const initialName =
      normalizeDisplayName(profile?.full_name) ||
      normalizeDisplayName(profile?.name) ||
      fallbackUsername;
    setNameInput(initialName);

    const rawHeight = profile?.height_cm as number | string | null | undefined;
    const parsedHeight =
      typeof rawHeight === "number"
        ? rawHeight
        : typeof rawHeight === "string"
        ? Number.parseFloat(rawHeight)
        : null;
    const candidateCm =
      Number.isFinite(parsedHeight) && parsedHeight && parsedHeight > 0 ? parsedHeight : null;
    const storedCm = userConfirmedHeightCm ?? candidateCm;
    const storedCmString = storedCm ? formatCm(storedCm) : "";

    if (storedCm) {
      setHeightUnit("cm");
      setHeightCmRaw(storedCmString);
      const { feet, inches } = cmToFeetInches(storedCm);
      setHeightFeetRaw(feet);
      setHeightInchesRaw(inches);
      setHeightLastEditedUnit("cm");
    } else {
      setHeightUnit("cm");
      setHeightCmRaw("");
      setHeightFeetRaw("");
      setHeightInchesRaw("");
      setHeightLastEditedUnit(null);
    }

  }, [profile, userConfirmedHeightCm]);

  const isNativeApp = useMemo(() => Capacitor.isNativePlatform(), []);

  const refreshCacheStats = useCallback(async () => {
    try {
      const stats = isNativeApp
        ? await getExerciseImageFilesystemCacheStats()
        : await getExerciseImageCacheStats();
      setCacheStats(stats);
    } catch (error) {
      console.warn("[ProfileSettings] Failed to refresh cache stats:", error);
    }
  }, [isNativeApp]);

  useEffect(() => {
    if (!open) {
      setHeightFeedback(null);
      setNotifications([]);
    } else {
      // Load cache stats when settings open
      console.log('[ProfileSettings] Loading cache stats...');
      refreshCacheStats();

      // Preload profile picture for instant display
      if (profile?.avatar_url) {
        const img = new Image();
        img.src = profile.avatar_url;
      }
    }
  }, [open, profile?.avatar_url, refreshCacheStats]);

  const derivedCmFromFeet = feetInchesToCm(heightFeetRaw, heightInchesRaw);
  const derivedFeetFromFeet = derivedCmFromFeet
    ? cmToFeetInches(derivedCmFromFeet)
    : { feet: "", inches: "" };
  const derivedFeetFromCm = (() => {
    const parsed = Number.parseFloat(heightCmRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return cmToFeetInches(parsed);
  })();

  const cmDisplayValue =
    heightLastEditedUnit === "ft"
      ? (derivedCmFromFeet ? formatCm(derivedCmFromFeet) : heightCmRaw)
      : heightCmRaw;

  const feetDisplayValue =
    heightLastEditedUnit === "ft"
      ? heightFeetRaw
      : derivedFeetFromCm?.feet || derivedFeetFromFeet.feet;

  const inchesDisplayValue =
    heightLastEditedUnit === "ft"
      ? heightInchesRaw
      : derivedFeetFromCm?.inches || derivedFeetFromFeet.inches;

  const pushNotification = useCallback(
    ({ type, title, description }: Omit<SettingsNotification, "id">) => {
      if (!open) return;
      const id = notificationIdRef.current++;
      setNotifications((prev) => [...prev, { id, type, title, description }]);
      window.setTimeout(() => {
        setNotifications((prev) => prev.filter((note) => note.id !== id));
      }, 8000);
    },
    [open]
  );

  const hasPersistedName = Boolean(
    normalizeDisplayName(profile?.full_name) || normalizeDisplayName(profile?.name)
  );
  const canEditDisplayName = !hasPersistedName;

  const handleSaveDisplayName = async () => {
    if (!profile?.id) {
      pushNotification({
        type: "error",
        title: "Missing profile",
        description: "Unable to update name right now.",
      });
      return;
    }

    const trimmed = nameInput.trim();
    if (trimmed.length < 2) {
      pushNotification({
        type: "error",
        title: "Invalid name",
        description: "Please enter at least 2 characters.",
      });
      return;
    }

    setSavingDisplayName(true);
    try {
      const result = await syncProfileFirstName(profile.id, trimmed);
      if (import.meta.env.DEV) console.log("ProfileSettings display-name sync result");
      if (!result.success) {
        pushNotification({
          type: "error",
          title: "Couldn't save name",
          description: result.errorMessage || "Please try again later.",
        });
        return;
      }

      pushNotification({
        type: "success",
        title: "Name saved",
      });
      onProfileUpdate();
    } catch (error) {
      console.warn("ProfileSettings failed to save display name:", error);
      pushNotification({
        type: "error",
        title: "Couldn't save name",
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSavingDisplayName(false);
    }
  };

  const handleSignOut = async () => {
    let signOutError: any = null;

    try {
      const { error } = await supabase.auth.signOut({ scope: "global" });
      signOutError = error;
    } catch (err: any) {
      signOutError = err;
    }

    const safeToProceed =
      !signOutError ||
      signOutError?.name === "AuthSessionMissingError" ||
      signOutError?.status === 400 ||
      signOutError?.status === 403;

    if (!safeToProceed) {
      console.error("Sign out failed", signOutError);
      pushNotification({
        type: "error",
        title: "Failed to sign out",
        description: signOutError?.message || "Please try again.",
      });
      return;
    }

    // Clear Supabase auth artifacts manually (fallback when global logout fails).
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith("sb-")) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));

    // Clear all Supabase-related state
    localStorage.removeItem("last-workout-id");
    sessionStorage.clear();

    // Force clear the Supabase client's internal session cache
    // This ensures the next sign-in uses a fresh session
    try {
      await supabase.auth.refreshSession({ refresh_token: '' });
    } catch {
      // Ignore errors - this is just to force clear the session
    }

    await logoutRevenueCatUser();
    resetSubscriptionState();

    // Add a small delay to ensure session is fully cleared before redirecting
    setTimeout(() => {
      navigate("/auth", { replace: true });
    }, 100);
  };

  const handleDeleteAccount = async () => {
    // Verify confirmation text
    if (deleteConfirmText !== "AGREE") {
      pushNotification({
        type: "error",
        title: "Confirmation required",
        description: "Please type AGREE in all caps to confirm account deletion.",
      });
      return;
    }

    setDeletingAccount(true);

    try {
      const session = await getSupabaseSession();
      const user = session?.user;

      if (!user) {
        throw new Error("No active session");
      }

      // Call the delete account RPC function
      const { error: deleteError } = await supabase.rpc('delete_user_account');

      if (deleteError) {
        throw deleteError;
      }

      // Sign out after successful deletion
      await supabase.auth.signOut({ scope: "global" });
      await logoutRevenueCatUser();
      resetSubscriptionState();

      // Clear local storage
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("sb-")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((key) => localStorage.removeItem(key));
      localStorage.removeItem("last-workout-id");
      sessionStorage.clear();

      // Navigate to auth page
      navigate("/auth", { replace: true });
    } catch (error) {
      console.error("Account deletion failed:", error);
      pushNotification({
        type: "error",
        title: "Account deletion failed",
        description: error instanceof Error ? error.message : "Please try again or contact support.",
      });
      setDeletingAccount(false);
    }
  };

  const toggleUnit = async (unit: "kg" | "lb") => {
    // Skip if already on this unit
    if (unit === unitDefault) return;

    // Store previous value for potential revert
    const previousUnit = unitDefault;

    // Optimistic update - set local state immediately to prevent glitch
    setUnitDefault(unit);

    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        // Revert on auth failure
        setUnitDefault(previousUnit);
        return;
      }

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Update unit via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': apiKey
        },
        body: JSON.stringify({ unit_default: unit })
      });

      if (!response.ok) throw new Error('Failed to update unit');

      // Silently refresh profile in background without affecting UI
      // No notification needed - the visual toggle change is enough feedback
      onProfileUpdate();
    } catch (error: any) {
      // Revert optimistic update on failure
      setUnitDefault(previousUnit);
      pushNotification({
        type: "error",
        title: "Failed to update unit",
        description: "Something went wrong saving your preference.",
      });
    }
  };

  const handleSaveBio = async () => {
    const trimmed = bio.trim();
    if ((profile?.bio || "") === trimmed) {
      pushNotification({
        type: "info",
        title: "Bio already up to date",
      });
      return;
    }

    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        pushNotification({
          type: "error",
          title: "Unable to save bio",
          description: "You need to be signed in to update your bio.",
        });
        return;
      }

      setSavingBio(true);

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();
      const payload = { bio: trimmed.length ? trimmed : null };

      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || "Failed to save bio");
      }

      const { error: publicProfileError } = await supabase
        .from("public_profiles")
        .update(payload)
        .eq("id", user.id);

      if (publicProfileError) throw publicProfileError;

      pushNotification({
        type: "success",
        title: "Bio updated",
      });
      onProfileUpdate();
    } catch (error: any) {
      console.error("Failed to save bio", error);
      pushNotification({
        type: "error",
        title: "Failed to save bio",
        description: error.message || "Please try again.",
      });
    } finally {
      setSavingBio(false);
    }
  };

  const handleSaveBodyweight = async () => {
    if (!bodyweight) return;

    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) {
        pushNotification({
          type: "error",
          title: "Missing session",
          description: "Please sign in again before saving.",
        });
        return;
      }

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Update bodyweight via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': apiKey
        },
        body: JSON.stringify({ bodyweight: parseFloat(bodyweight) })
      });

      if (!response.ok) throw new Error('Failed to save bodyweight');

      pushNotification({
        type: "success",
        title: "Bodyweight saved",
      });
      
      onProfileUpdate();
    } catch (error: any) {
      pushNotification({
        type: "error",
        title: "Failed to save bodyweight",
        description: "Please try again.",
      });
    }
  };

  const getHeightCm = () => {
    const parsedCmRaw = Number.parseFloat(heightCmRaw);
    const cmFromCm = Number.isFinite(parsedCmRaw) && parsedCmRaw > 0 ? parsedCmRaw : null;
    const cmFromFeet = feetInchesToCm(heightFeetRaw, heightInchesRaw);

    if (heightLastEditedUnit === "cm") return cmFromCm;
    if (heightLastEditedUnit === "ft") return cmFromFeet;

    if (heightUnit === "cm") return cmFromCm ?? cmFromFeet;
    return cmFromFeet ?? cmFromCm;
  };

  const handleHeightUnitToggle = (unit: "cm" | "ft") => {
    if (unit === heightUnit) return;
    setHeightUnit(unit);
    setHeightFeedback(null);
  };

  const handleHeightCmChange = (value: string) => {
    const trimmed = value.trim();
    setHeightCmRaw(trimmed);
    setHeightLastEditedUnit("cm");
    setHeightFeedback(null);

    if (!trimmed) {
      setHeightFeetRaw("");
      setHeightInchesRaw("");
      return;
    }
    const parsed = Number.parseFloat(trimmed);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    const { feet, inches } = cmToFeetInches(parsed);
    setHeightFeetRaw(feet);
    setHeightInchesRaw(inches);
  };

  const handleHeightFeetChange = (value: string) => {
    const trimmed = value.trim();
    setHeightFeetRaw(trimmed);
    setHeightLastEditedUnit("ft");
    setHeightFeedback(null);
    const cm = feetInchesToCm(trimmed, heightInchesRaw);
    if (cm) {
      setHeightCmRaw(cm.toString());
    } else if (!trimmed && !heightInchesRaw) {
      setHeightCmRaw("");
    }
  };

  const handleHeightInchesChange = (value: string) => {
    const trimmed = value.trim();
    setHeightInchesRaw(trimmed);
    setHeightLastEditedUnit("ft");
    setHeightFeedback(null);
    const cm = feetInchesToCm(heightFeetRaw, trimmed);
    if (cm) {
      setHeightCmRaw(cm.toString());
    } else if (!trimmed && !heightFeetRaw) {
      setHeightCmRaw("");
    }
  };

  const handleSaveHeight = async () => {
    const cm = getHeightCm();
    const isClearing =
      (heightLastEditedUnit === "cm" && !heightCmRaw) ||
      (heightLastEditedUnit === "ft" && !heightFeetRaw && !heightInchesRaw) ||
      (!heightLastEditedUnit && !heightCmRaw && !heightFeetRaw && !heightInchesRaw);

    if (!cm && !isClearing) {
      setHeightFeedback({ type: "error", message: "Enter a valid height." });
      return;
    }

    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) return;

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();
      const payloadHeight = isClearing ? null : cm;

      let schemaWarning = false;
      let heightPersisted = false;

      const { error: heightError } = await supabase.rpc("set_profile_height", {
        user_id: user.id,
        new_height_cm: payloadHeight,
      });

      if (heightError) {
        if (!isSchemaCacheRelated(heightError.message)) {
          throw new Error(heightError.message || "Failed to save height");
        }
        console.warn("Schema cache issue while calling set_profile_height RPC:", heightError);
        schemaWarning = true;
      } else {
        heightPersisted = true;
      }

      if (!heightPersisted) {
        const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: apiKey,
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ height_cm: payloadHeight }),
        });

        const status = typeof response.status === "number" ? response.status : NaN;
        const okFlag = typeof response.ok === "boolean" ? response.ok : undefined;
        const requestSucceeded =
          (typeof okFlag === "boolean" && okFlag) || (Number.isFinite(status) && status >= 200 && status < 400);

        if (requestSucceeded) {
          heightPersisted = true;
        } else {
          let responseText = "";
          try {
            responseText = await response.text();
          } catch {
            responseText = "";
          }

          if (isSchemaCacheRelated(responseText)) {
            console.warn("Schema cache issue while using REST fallback for height:", responseText);
            schemaWarning = true;
            heightPersisted = true;
          } else {
            let errorMessage = "Failed to save height";
            if (responseText) {
              try {
                const parsed = JSON.parse(responseText);
                errorMessage = parsed?.message || parsed?.error || responseText || errorMessage;
              } catch {
                errorMessage = responseText;
              }
            }
            throw new Error(errorMessage);
          }
        }
      }

      if (!heightPersisted) {
        throw new Error("Failed to save height.");
      }

      setHeightFeedback(null);

      pushNotification({
        type: "success",
        title: isClearing ? "Height cleared" : "Height saved",
        description: schemaWarning
          ? "It may take a moment for the new value to appear everywhere."
          : undefined,
      });

      if (payloadHeight) {
        const formattedCm = formatCm(payloadHeight);
        setUserConfirmedHeightCm(payloadHeight);
        if (heightLastEditedUnit === "cm") {
          setHeightCmRaw(heightCmRaw || formattedCm);
          const { feet, inches } = cmToFeetInches(payloadHeight);
          setHeightFeetRaw(feet);
          setHeightInchesRaw(inches);
          setHeightLastEditedUnit("cm");
        } else {
          const { feet, inches } = cmToFeetInches(payloadHeight);
          setHeightFeetRaw(heightFeetRaw || feet);
          setHeightInchesRaw(heightInchesRaw || inches);
          setHeightCmRaw(formattedCm);
          setHeightLastEditedUnit("ft");
        }
      } else {
        setHeightCmRaw("");
        setHeightFeetRaw("");
        setHeightInchesRaw("");
        setHeightLastEditedUnit(null);
      }

      try {
        const maybePromise = onProfileUpdate();
        if (maybePromise && typeof (maybePromise as Promise<unknown>).then === "function") {
          await maybePromise;
        }
      } catch (refreshError) {
        console.warn("Height saved but profile refresh failed:", refreshError);
      }
    } catch (error: any) {
      console.error(error);
      setHeightFeedback({
        type: "error",
        message: error?.message || "Failed to save height.",
      });
    }
  };

  const handleSaveName = async () => {
    if (!username.trim()) {
      pushNotification({
        type: "error",
        title: "Username cannot be empty",
      });
      return;
    }

    if (normalizeDisplayName(profile?.username) === username.trim()) {
      setEditingName(false);
      return;
    }

    // Validate username format
    const validation = usernameSchema.safeParse(username.trim());
    if (!validation.success) {
      pushNotification({
        type: "error",
        title: "Invalid username",
        description: validation.error.errors[0].message,
      });
      return;
    }

    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      const accessToken = session?.access_token;
      if (!user || !accessToken) return;

      const lastChangedRaw = user.user_metadata?.username_last_changed_at;
      if (typeof lastChangedRaw === "string") {
        const lastChanged = Date.parse(lastChangedRaw);
        if (!Number.isNaN(lastChanged)) {
          const now = Date.now();
          const elapsed = now - lastChanged;
          if (elapsed < USERNAME_COOLDOWN_MS) {
            const remainingMs = USERNAME_COOLDOWN_MS - elapsed;
            const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
            pushNotification({
              type: "error",
              title: "Username cooldown active",
              description: `You can change your username again in ${remainingDays} day${remainingDays === 1 ? "" : "s"}.`,
            });
            return;
          }
        }
      }

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // Normalize username to lowercase for case-insensitive uniqueness
      const normalizedUsername = username.trim().toLowerCase();

      // Update username via REST API
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': apiKey
        },
        body: JSON.stringify({ username: normalizedUsername })
      });

      if (!response.ok) {
        const errorData = await response.json();
        const profileError: any = new Error(errorData.message || 'Failed to update username');
        profileError.message = errorData.message || profileError.message;

        // Check if it's a duplicate username error
        if (profileError.message.includes("duplicate") || profileError.message.includes("unique")) {
          pushNotification({
            type: "error",
            title: "Username taken",
            description: "Try a different username.",
          });
          return;
        }
        throw profileError;
      }

      const { error: publicProfileError } = await supabase
        .from("public_profiles")
        .update({ username: normalizedUsername })
        .eq("id", user.id);

      if (publicProfileError) throw publicProfileError;

      try {
        await supabase.auth.updateUser({
          data: {
            username_last_changed_at: new Date().toISOString(),
          },
        });
      } catch (metadataError) {
        console.warn("Failed to persist username cooldown metadata:", metadataError);
      }

      // Update local state to reflect the normalized username
      setUsername(normalizedUsername);
      setEditingName(false);

      pushNotification({
        type: "success",
        title: "Username updated",
      });

      onProfileUpdate();
    } catch (error: any) {
      pushNotification({
        type: "error",
        title: "Failed to save username",
        description: error.message || "Please try again.",
      });
    }
  };

  const handleCancelEditName = () => {
    setUsername(profile?.username || "");
    setEditingName(false);
  };

  const handleAvatarUploadSuccess = (newAvatarUrl: string) => {
    pushNotification({
      type: "success",
      title: "Profile picture updated",
    });
    onProfileUpdate();
  };

  const handleAvatarUploadError = (error: string) => {
    pushNotification({
      type: "error",
      title: "Failed to upload profile picture",
      description: error,
    });
  };

  const handlePrivacyToggle = async (nextValue: boolean) => {
    if (savingPrivacy) return;

    const session = await getSupabaseSession();
    const user = session?.user;
    const accessToken = session?.access_token;
    if (!user || !accessToken) {
      pushNotification({
        type: "error",
        title: "Missing session",
        description: "Please sign in again before updating privacy.",
      });
      return;
    }

    setSavingPrivacy(true);
    setIsPrivateAccount(nextValue);

    const supabaseUrl = getSupabaseUrl();
    const apiKey = getSupabaseAnonKey();

    try {
      const payload = { is_private: nextValue };
      console.log("[Privacy Toggle] Updating privacy to:", nextValue, "for user:", user.id);
      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify(payload),
      });

      console.log("[Privacy Toggle] Response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("[Privacy Toggle] Error response:", errorData);
        throw new Error(errorData.message || "Failed to update account privacy");
      }

      const { error: publicProfileError } = await supabase
        .from("public_profiles")
        .update(payload)
        .eq("id", user.id);

      if (publicProfileError) throw publicProfileError;

      pushNotification({
        type: "success",
        title: nextValue ? "Account set to private" : "Account set to public",
        description: nextValue
          ? "New followers will need approval."
          : "Anyone can see your workouts again.",
      });

      onProfileUpdate();
    } catch (error: any) {
      console.error("Failed to update privacy", error);
      setIsPrivateAccount(!nextValue);
      pushNotification({
        type: "error",
        title: "Privacy update failed",
        description: error?.message || "Please try again.",
      });
    } finally {
      setSavingPrivacy(false);
    }
  };

  const handleAiTipsToggle = async (nextValue: boolean) => {
    if (savingAiConsent) return;

    const session = await getSupabaseSession();
    const user = session?.user;
    const accessToken = session?.access_token;
    if (!user || !accessToken) {
      console.error("AI toggle failed: Missing session or access token");
      pushNotification({
        type: "error",
        title: "Missing session",
        description: "Please sign in again.",
      });
      return;
    }

    setSavingAiConsent(true);
    setAiTipsEnabled(nextValue);

    const supabaseUrl = getSupabaseUrl();
    const apiKey = getSupabaseAnonKey();

    try {
      const payload = {
        ai_tips_consent: nextValue,
        ai_tips_consent_granted_at: nextValue ? new Date().toISOString() : null,
      };

      if (import.meta.env.DEV) {
        console.log("Updating AI consent:", payload);
      }

      const response = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error("AI consent update failed:", response.status, errorData);
        throw new Error(errorData.message || "Failed to update AI tips consent");
      }

      if (import.meta.env.DEV) {
        console.log("AI consent updated successfully");
      }

      // Dispatch profile update event so AIHelp page knows about the change
      window.dispatchEvent(
        new CustomEvent("profile:updated", {
          detail: {
            id: user.id,
            ai_tips_consent: nextValue,
            ai_tips_consent_granted_at: nextValue ? new Date().toISOString() : null,
          },
        })
      );

      pushNotification({
        type: "success",
        title: nextValue ? "AI Tips enabled" : "AI Tips disabled",
        description: nextValue
          ? "You can now generate workout tips powered by Google AI."
          : "Your workout data will no longer be shared with Google AI.",
      });

      onProfileUpdate();
    } catch (error: any) {
      console.error("Failed to update AI consent", error);
      setAiTipsEnabled(!nextValue);
      pushNotification({
        type: "error",
        title: "Update failed",
        description: error?.message || "Please try again.",
      });
    } finally {
      setSavingAiConsent(false);
    }
  };

  const handleDownloadAllImages = async () => {
    if (downloadingImages) return;

    try {
      setDownloadingImages(true);
      setDownloadProgress({ current: 0, total: 0 });

      // Get current user
      const session = await getSupabaseSession();
      const userId = session?.user?.id;
      if (!userId) {
        pushNotification({
          type: "error",
          title: "Not signed in",
          description: "Please sign in to download exercise images.",
        });
        return;
      }

      // Get all exercises from cache (refresh if empty)
      let exercises = await getExercisesOffline(userId);
      let exercisesWithImages = exercises.filter(ex => ex.image_url);

      if (exercisesWithImages.length === 0) {
        console.warn("[ProfileSettings] Exercise cache empty, refreshing before download");
        const refreshedCount = await cacheExercises(userId);

        if (refreshedCount > 0) {
          exercises = await getExercisesOffline(userId);
          exercisesWithImages = exercises.filter(ex => ex.image_url);
        }
      }

      if (exercisesWithImages.length === 0) {
        pushNotification({
          type: "info",
          title: "Exercise library needs refresh",
          description: "Connect online to sync the exercise library before downloading images.",
        });
        return;
      }

      setDownloadProgress({ current: 0, total: exercisesWithImages.length });

      if (isNativeApp) {
        const result = await downloadAllExerciseImagesToFilesystem(
          exercisesWithImages,
          (current, total) => {
            setDownloadProgress({ current, total });
          }
        );

        // Provide better feedback based on results
        if (result.failed === 0) {
          pushNotification({
            type: "success",
            title: "Download complete",
            description: `Downloaded ${result.success} images (${result.skipped} already cached)`,
          });
        } else if (result.success === 0 && result.failed > 0) {
          pushNotification({
            type: "error",
            title: "All downloads failed",
            description: `Failed to download ${result.failed} images. Check your internet connection or try again later.`,
          });
        } else {
          pushNotification({
            type: "warning",
            title: "Download partially complete",
            description: `Downloaded ${result.success} images, but ${result.failed} failed. Try downloading again for missing images.`,
          });
        }
      } else {
        const result = await downloadAllExerciseImages(
          exercisesWithImages,
          (current, total) => {
            setDownloadProgress({ current, total });
          }
        );

        // Provide better feedback based on results
        if (result.failed === 0) {
          pushNotification({
            type: "success",
            title: "Download complete",
            description: `Cached ${result.success} images in browser (${result.skipped} already cached)`,
          });
        } else if (result.success === 0 && result.failed > 0) {
          pushNotification({
            type: "error",
            title: "All downloads failed",
            description: `Failed to cache ${result.failed} images. Check your internet connection or try again later.`,
          });
        } else {
          pushNotification({
            type: "warning",
            title: "Download partially complete",
            description: `Cached ${result.success} images, but ${result.failed} failed. Try downloading again for missing images.`,
          });
        }
      }

      await refreshCacheStats();
    } catch (error: any) {
      console.error("Failed to download exercise images:", error);
      pushNotification({
        type: "error",
        title: "Download failed",
        description: error?.message || "Please try again.",
      });
    } finally {
      setDownloadingImages(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };

  const handleClearImageCache = async () => {
    try {
      if (isNativeApp) {
        await clearExerciseImageFilesystemCache();
      } else {
        await clearExerciseImageCache();
      }

      await refreshCacheStats();

      pushNotification({
        type: "success",
        title: "Cache cleared",
        description: "All exercise images removed from storage.",
      });
    } catch (error: any) {
      console.error("Failed to clear exercise image cache:", error);
      pushNotification({
        type: "error",
        title: "Failed to clear cache",
        description: error?.message || "Please try again.",
      });
    }
  };

  const isBioDirty = (profile?.bio || "") !== bio;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ paddingTop: 'max(env(safe-area-inset-top, 0px) + 1rem, 2.5rem)' }}>
        <SheetHeader className="relative">
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-0 top-0"
            onClick={() => onOpenChange(false)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <SheetTitle className="text-center">Settings</SheetTitle>
          <SheetDescription className="text-center">Manage your account and preferences</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 mt-8">
          {notifications.length > 0 && (
            <div className="space-y-2">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`rounded-lg border px-3 py-2 text-sm ${notificationStyleMap[notification.type]}`}
                >
                  <p className="font-medium">{notification.title}</p>
                  {notification.description && (
                    <p className="text-xs mt-1 opacity-80">
                      {notification.description}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Account Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-semibold">Account</h3>

            {/* Profile Picture */}
            <div className="flex justify-center py-2">
              <ProfilePictureUpload
                currentAvatarUrl={profile?.avatar_url || null}
                username={profile?.username || "User"}
                onUploadSuccess={handleAvatarUploadSuccess}
                onUploadError={handleAvatarUploadError}
              />
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Name</Label>
              {canEditDisplayName ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={nameInput}
                      onChange={(event) => setNameInput(event.target.value)}
                      placeholder="Enter your name"
                      autoFocus
                    />
                    <Button
                      size="icon"
                      variant="default"
                      onClick={handleSaveDisplayName}
                      disabled={savingDisplayName}
                    >
                      {savingDisplayName ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <Check className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">You can only set this once.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">
                    {resolvedName}
                  </p>
                  <p className="text-xs text-muted-foreground">Only you can see this name.</p>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-border/60 p-4 flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm">Private account</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Only accepted followers can see your posts, PRs, and stats. Follow requests must be approved.
                </p>
              </div>
              <Switch
                checked={isPrivateAccount}
                disabled={savingPrivacy}
                onCheckedChange={handlePrivacyToggle}
              />
            </div>

            <div className="rounded-2xl border border-border/60 p-4 flex items-start justify-between gap-4">
              <div>
                <Label className="text-sm">AI-Powered Workout Tips</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Allow sharing workout data with Google Gemini AI to generate personalized tips. Limited to 5 tips per day.
                </p>
              </div>
              <Switch
                checked={aiTipsEnabled}
                disabled={savingAiConsent}
                onCheckedChange={handleAiTipsToggle}
              />
            </div>

            {/* Subscription Status */}
            <div
              className="rounded-2xl border border-border/60 p-4 flex items-center justify-between gap-4 cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => {
                onOpenChange(false);
                navigate("/subscription");
              }}
            >
              <div className="flex items-center gap-3">
                <Crown className={`h-5 w-5 ${isPremium ? 'text-yellow-500' : 'text-gray-400'}`} />
                <div>
                  <Label className="text-sm cursor-pointer">Subscription</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {isLoadingSubscription ? 'Loading...' : isPremium ? 'Premium Member' : 'Free Plan'}
                  </p>
                </div>
              </div>
              {!isLoadingSubscription && (
                isPremium ? <SubscriptionBadge showTrial={false} /> : <FreeBadge />
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-sm text-muted-foreground">Username</Label>
              {editingName ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="Letters and numbers only"
                      autoFocus
                    />
                    <Button size="icon" variant="ghost" onClick={handleSaveName}>
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="ghost" onClick={handleCancelEditName}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    3-20 characters, letters and numbers only (case-sensitive)
                  </p>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="font-medium">{profile?.username || "Not set"}</p>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => setEditingName(true)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </div>

            <div>
              <Label className="text-sm text-muted-foreground">Email</Label>
              <p className="font-medium">{userEmail}</p>
            </div>

            <div>
              <Label className="text-sm text-muted-foreground">Member since</Label>
              <p className="font-medium">
                {new Date(profile?.created_at).toLocaleDateString()}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="bio" className="text-sm text-muted-foreground">
                Bio
              </Label>
              <Textarea
                id="bio"
                value={bio}
                onChange={(e) => {
                  setBio(e.target.value);
                }}
                maxLength={BIO_MAX_LENGTH}
                rows={4}
                placeholder="Share a quick intro for other lifters..."
                className="resize-none text-sm"
              />
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Visible on your profile.</span>
                <span>
                  {bio.length}/{BIO_MAX_LENGTH}
                </span>
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveBio}
                  disabled={savingBio || !isBioDirty}
                >
                  {savingBio ? "Saving..." : "Save Bio"}
                </Button>
              </div>
            </div>
          </div>

          {/* Settings Section */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-lg font-semibold">Preferences</h3>

            <div className="space-y-2">
              <Label>Theme</Label>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Toggle between light and dark mode</span>
                <ThemeToggle />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Default Unit</Label>
              <LiquidGlassTabs
                tabs={[
                  { id: "kg", label: "kg" },
                  { id: "lb", label: "lb" },
                ]}
                activeTab={unitDefault}
                onTabChange={(tabId) => toggleUnit(tabId as "kg" | "lb")}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bodyweight">
                Current Bodyweight (optional)
              </Label>
              <div className="flex gap-2">
                <Input
                  id="bodyweight"
                  type="number"
                  step="0.1"
                  value={bodyweight}
                  onChange={(e) => setBodyweight(e.target.value)}
                  onBlur={handleSaveBodyweight}
                  placeholder="70.5"
                />
                <div className="px-3 flex items-center justify-center bg-muted rounded-md font-medium">
                  {unitDefault}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="height">
                Height (optional)
              </Label>
              <LiquidGlassTabs
                tabs={[
                  { id: "cm", label: "cm" },
                  { id: "ft", label: "ft / in" },
                ]}
                activeTab={heightUnit}
                onTabChange={(tabId) => handleHeightUnitToggle(tabId as "cm" | "ft")}
              />
              {heightUnit === "cm" ? (
                <Input
                  id="height"
                  type="number"
                  step="0.1"
                  value={cmDisplayValue}
                  onChange={(e) => handleHeightCmChange(e.target.value)}
                  onBlur={handleSaveHeight}
                  placeholder="175"
                />
              ) : (
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      type="number"
                      min="0"
                      value={feetDisplayValue}
                      onChange={(e) => handleHeightFeetChange(e.target.value)}
                      onBlur={handleSaveHeight}
                      placeholder="5"
                    />
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground text-center">
                      ft
                    </span>
                  </div>
                  <div className="flex-1">
                    <Input
                      type="number"
                      min="0"
                      max="11"
                      value={inchesDisplayValue}
                      onChange={(e) => handleHeightInchesChange(e.target.value)}
                      onBlur={handleSaveHeight}
                      placeholder="10"
                    />
                    <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground text-center">
                      in
                    </span>
                  </div>
                </div>
              )}
              <div className="flex justify-between text-xs text-muted-foreground">
                <span />
                {heightUnit === "cm" && cmDisplayValue
                  ? (() => {
                      const cm = Number.parseFloat(cmDisplayValue);
                      if (!Number.isFinite(cm) || cm <= 0) return null;
                      const { feet, inches } = cmToFeetInches(cm);
                      return <span>{`${feet} ft ${inches} in`}</span>;
                    })()
                  : heightUnit === "ft" && (feetDisplayValue || inchesDisplayValue)
                  ? (() => {
                      const cm = feetInchesToCm(feetDisplayValue, inchesDisplayValue);
                      if (!cm) return null;
                      const displayCm = heightLastEditedUnit === "ft"
                        ? formatCm(cm)
                        : heightCmRaw || formatCm(cm);
                      return <span>{`${displayCm} cm`}</span>;
                    })()
                  : null}
              </div>
              {heightFeedback?.type === "error" && (
                <p
                  className="text-xs text-destructive"
                >
                  {heightFeedback.message}
                </p>
              )}
            </div>
          </div>

          {/* Offline Mode Section */}
          <div className="space-y-4 pt-4 border-t">
            <h3 className="text-lg font-semibold">Offline Mode</h3>

            <div className="space-y-4">
              <div className="rounded-2xl border border-border/60 bg-muted/30 p-4">
                <p className="text-sm text-muted-foreground mb-4">
                  Download all exercise photos and GIFs to your device so you can workout without WiFi.
                  Exercise images will load instantly when starting workouts or templates offline.
                </p>

                {cacheStats.count > 0 && (
                  <div className="mb-4 p-3 rounded-lg bg-background border border-border">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Cached exercises:</span>
                      <span className="font-medium">{cacheStats.count} images</span>
                    </div>
                    <div className="flex items-center justify-between text-sm mt-1">
                      <span className="text-muted-foreground">Storage used:</span>
                      <span className="font-medium">~{cacheStats.estimatedSizeMB} MB</span>
                    </div>
                  </div>
                )}

                {downloadingImages && (
                  <div className="mb-4">
                    <div className="flex items-center justify-between text-sm mb-2">
                      <span>Downloading...</span>
                      <span className="font-medium">
                        {downloadProgress.current} / {downloadProgress.total}
                      </span>
                    </div>
                    <Progress
                      value={downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total) * 100 : 0}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-2">
                  <Button
                    onClick={handleDownloadAllImages}
                    disabled={downloadingImages}
                    className="w-full"
                  >
                    {downloadingImages ? (
                      <>
                        <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                        Downloading...
                      </>
                    ) : (
                      <>
                        <Download className="h-4 w-4 mr-2" />
                        Download All Exercise Images
                      </>
                    )}
                  </Button>

                  {cacheStats.count > 0 && (
                    <Button
                      variant="outline"
                      onClick={handleClearImageCache}
                      disabled={downloadingImages}
                      className="w-full"
                    >
                      <Trash2 className="h-4 w-4 mr-2" />
                      Clear Image Cache
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Info Section */}
          <div className="pt-4 border-t space-y-2">
            <Button
              variant="outline"
              onClick={() => {
                onOpenChange(false);
                navigate("/info");
              }}
              className="w-full"
            >
              <Info className="h-4 w-4 mr-2" />
              About & Privacy
            </Button>
          </div>

          {/* Delete Account Section */}
          <div className="pt-4 border-t space-y-2">
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Permanently delete your account and all associated data. This action cannot be undone.
              </p>
              <Button
                variant="destructive"
                onClick={() => setShowDeleteDialog(true)}
                className="w-full"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Account
              </Button>
            </div>
          </div>

          {/* Sign Out Section */}
          <div className="pt-4 border-t">
            <Button
              variant="outline"
              onClick={handleSignOut}
              className="w-full"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </div>
      </SheetContent>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Account Permanently?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-4">
                <p>
                  This will permanently delete your account and all associated data, including:
                </p>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  <li>All workout logs and training history</li>
                  <li>Personal records (PRs)</li>
                  <li>Profile information and photos</li>
                  <li>Social posts and connections</li>
                  <li>All uploaded images</li>
                </ul>
                <p className="font-semibold text-foreground">
                  This action cannot be undone. All your data will be permanently removed from our servers.
                </p>
                <div className="space-y-2">
                  <Label htmlFor="delete-confirm" className="text-sm font-medium">
                    Type <span className="font-mono font-bold">AGREE</span> in all caps to confirm:
                  </Label>
                  <Input
                    id="delete-confirm"
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    placeholder="AGREE"
                    className="font-mono"
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setDeleteConfirmText("");
                setShowDeleteDialog(false);
              }}
              disabled={deletingAccount}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteAccount}
              disabled={deletingAccount || deleteConfirmText !== "AGREE"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deletingAccount ? "Deleting..." : "Delete Account"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
};
