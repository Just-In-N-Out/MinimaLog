import { Capacitor } from "@capacitor/core";
import { LiveActivities, type LiveActivityStartOptions } from "./native-live-activities";

export interface LiveActivityWorkoutMetadata {
  id: string;
  name: string;
  exerciseCount: number;
}

interface PersistedActivityState {
  workoutId: string;
  activityId: string;
  metadata: LiveActivityWorkoutMetadata;
  startDateIso: string;
}

const LIVE_ACTIVITY_STORAGE_KEY = 'weightstone:live-activity-state';

let currentWorkoutId: string | null = null;
let currentActivityId: string | null = null;
let cachedMetadata: LiveActivityWorkoutMetadata | null = null;
let lastStartDateIso: string | null = null;

// Persistence helpers
const persistActivityState = () => {
  if (!currentWorkoutId || !currentActivityId || !cachedMetadata || !lastStartDateIso) {
    localStorage.removeItem(LIVE_ACTIVITY_STORAGE_KEY);
    return;
  }

  const state: PersistedActivityState = {
    workoutId: currentWorkoutId,
    activityId: currentActivityId,
    metadata: cachedMetadata,
    startDateIso: lastStartDateIso,
  };

  try {
    localStorage.setItem(LIVE_ACTIVITY_STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to persist activity state", error);
  }
};

export const getPersistedActivityState = (): PersistedActivityState | null => {
  try {
    const stored = localStorage.getItem(LIVE_ACTIVITY_STORAGE_KEY);
    if (!stored) return null;
    return JSON.parse(stored) as PersistedActivityState;
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to restore activity state", error);
    return null;
  }
};

export const clearPersistedActivityState = () => {
  localStorage.removeItem(LIVE_ACTIVITY_STORAGE_KEY);
};

const isiOS162OrLater = () => {
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return true;
  const match = navigator.userAgent.match(/OS (\d+)[_.](\d+)/);
  if (!match) return true;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (Number.isNaN(major) || Number.isNaN(minor)) return true;
  if (major > 16) return true;
  if (major < 16) return false;
  return minor >= 2;
};

const canUseLiveActivities = () => {
  if (!Capacitor.isNativePlatform()) return false;
  if (Capacitor.getPlatform() !== "ios") return false;
  return isiOS162OrLater();
};

const sanitizeIsoString = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
};

const buildStartOptions = (
  metadata: LiveActivityWorkoutMetadata,
  startDateIso: string,
): LiveActivityStartOptions | null => {
  if (!metadata.id) return null;
  const normalizedName = metadata.name?.trim() || "Workout";
  const isoStart = sanitizeIsoString(startDateIso);
  if (!isoStart) return null;
  return {
    workoutId: metadata.id,
    workoutName: normalizedName,
    startDate: isoStart,
    exerciseCount: Math.max(0, Number.isFinite(metadata.exerciseCount) ? metadata.exerciseCount : 0),
  };
};

export const setLiveActivitiesWorkoutId = (workoutId: string | null) => {
  currentWorkoutId = workoutId;
  if (!workoutId) {
    cachedMetadata = null;
    currentActivityId = null;
    lastStartDateIso = null;
    clearPersistedActivityState();
  }
};

export const setLiveActivitiesMetadata = (metadata: LiveActivityWorkoutMetadata | null) => {
  cachedMetadata = metadata;
};

export const stopLiveActivity = async () => {
  if (!canUseLiveActivities()) {
    setLiveActivitiesWorkoutId(null);
    return;
  }

  try {
    if (cachedMetadata?.id) {
      await LiveActivities.stop({ workoutId: cachedMetadata.id });
    } else {
      await LiveActivities.stop();
    }
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to stop live activity", error);
  } finally {
    setLiveActivitiesWorkoutId(null);
  }
};

export const startLiveActivity = async (metadata: LiveActivityWorkoutMetadata, startDateIso: string) => {
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  console.log('[LiveActivities] start called', { isNative, platform, metadata, startDateIso });

  if (!isNative || platform !== 'ios') {
    return;
  }

  if (!canUseLiveActivities()) return;
  const options = buildStartOptions(metadata, startDateIso);
  if (!options) {
    console.warn('[LiveActivities] invalid options for live activity start', { metadata, startDateIso });
    return;
  }

  if (currentWorkoutId && currentWorkoutId !== metadata.id) {
    await stopLiveActivity();
  }

  currentWorkoutId = metadata.id;
  cachedMetadata = metadata;

  if (lastStartDateIso === options.startDate && currentActivityId) {
    console.log('[LiveActivities] skipping start; already active', { currentActivityId, lastStartDateIso });
    return;
  }

  try {
    const result = await LiveActivities.start(options);
    currentActivityId = result?.activityId ?? metadata.id;
    lastStartDateIso = options.startDate;
    persistActivityState();
    console.log('[LiveActivities] started', { currentActivityId, lastStartDateIso });
  } catch (error) {
    console.warn('[LiveActivities] failed to start', error);
  }
};
