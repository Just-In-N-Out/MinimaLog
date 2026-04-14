import { useEffect, useMemo, useState, useRef, useCallback, useDeferredValue } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { supabase } from "@/integrations/supabase/client";
import { getSupabaseAnonKey, getSupabaseUrl } from "@/lib/env";
import { getSupabaseSession } from "@/lib/session";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Search, Plus, Dumbbell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { primaryRegions, nameSupportsUnilateralToggle } from "@/data/gymExercises";
import { shouldUseOfflineMode } from "@/lib/network";
import { getExercisesOffline } from "@/lib/cache/exerciseCache";
import { getDB } from "@/lib/db/indexedDB";
import { queueOperation } from "@/lib/db/operationQueue";
import { uploadExerciseImage } from "@/lib/imageProcessing";
import { ExerciseImage } from "@/components/ExerciseImage";
import { generateUUID } from "@/lib/utils";

interface Exercise {
  id: string;
  seedId?: string;
  name: string;
  equipment: string | null;
  muscle_group: string | null;
  body_part: string | null;
  is_bodyweight: boolean;
  is_unilateral?: boolean;
  supabaseId?: string;
  origin: "seed" | "custom";
  forceUnilateral?: boolean;
  supportsUnilateral?: boolean;
  image_url?: string | null;
}

interface ExercisePickerProps {
  onSelect: (exercise: Exercise) => void;
  onCancel: () => void;
}

type PickerRow =
  | { type: "group"; key: string; label: string }
  | { type: "exercise"; key: string; exercise: Exercise };

const EXERCISE_SUPABASE_MAP_KEY = "weightstone:exercise-supabase-map:v2";
const CUSTOM_EXERCISE_CACHE_KEY = "weightstone:custom-exercises-cache:v1";

const readSupabaseMap = (userId: string): Record<string, string> => {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(EXERCISE_SUPABASE_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const userMap = parsed[userId];
    return userMap && typeof userMap === "object" ? userMap : {};
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to read exercise supabase map");
    return {};
  }
};

const writeSupabaseMap = (userId: string, map: Record<string, string>) => {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(EXERCISE_SUPABASE_MAP_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const next = { ...(parsed && typeof parsed === "object" ? parsed : {}), [userId]: map };
    window.localStorage.setItem(EXERCISE_SUPABASE_MAP_KEY, JSON.stringify(next));
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to persist exercise supabase map");
  }
};

const readCachedCustomExercises = (userId: string): Exercise[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CUSTOM_EXERCISE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const userEntries = parsed?.[userId];
    if (!Array.isArray(userEntries)) return [];
    return userEntries
      .map((item: any) => {
        if (!item || typeof item !== "object") return null;
        const id = item.id ?? item.supabaseId ?? item.localId;
        const name = typeof item.name === "string" ? item.name : "";
        if (!id || !name) return null;
        if (findSeedByName(name)) {
          return null;
        }
        const supabaseId = item.id ? String(item.id) : undefined;
        return {
          id: supabaseId ?? String(id),
          name,
          equipment: item.equipment ?? null,
          muscle_group: item.muscle_group ?? null,
          body_part: item.body_part ?? null,
          is_bodyweight: item.is_bodyweight ?? false,
          supabaseId,
          origin: "custom" as const,
          supportsUnilateral: Boolean(item.supportsUnilateral),
          forceUnilateral: Boolean(
            item.forceUnilateral ?? item.supportsUnilateral ?? item.is_unilateral,
          ),
        };
      })
      .filter((item): item is Exercise => !!item);
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to read cached custom exercises");
    return [];
  }
};

const writeCachedCustomExercises = (userId: string, exercises: Exercise[]) => {
  if (typeof window === "undefined") return;
  try {
    const payload = exercises
      .filter((exercise) => exercise.origin === "custom")
      .map((exercise) => ({
        id: exercise.supabaseId ?? exercise.id,
        name: exercise.name,
        equipment: exercise.equipment,
        muscle_group: exercise.muscle_group,
        body_part: exercise.body_part ?? null,
        is_bodyweight: exercise.is_bodyweight ?? false,
        supportsUnilateral: Boolean(exercise.supportsUnilateral),
        forceUnilateral: Boolean(exercise.forceUnilateral),
      }));
    const raw = window.localStorage.getItem(CUSTOM_EXERCISE_CACHE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    const base = parsed && typeof parsed === "object" ? parsed : {};
    const next = { ...base, [userId]: payload };
    window.localStorage.setItem(CUSTOM_EXERCISE_CACHE_KEY, JSON.stringify(next));
  } catch (error) {
    if (import.meta.env.DEV) console.warn("Failed to cache custom exercises");
  }
};


const normalizeDisplayName = (value: string) =>
  value.trim().toLowerCase().replace(/\s*\(unilateral\)$/i, "");

const computeExerciseScore = (exercise: Exercise): number => {
  let score = 0;
  if (exercise.origin === "seed") score += 4;
  if (exercise.supportsUnilateral) score += 2;
  if (exercise.forceUnilateral) score += 1;
  return score;
};

const mergeExerciseLists = (current: Exercise[], customExercises: Exercise[]): Exercise[] => {
  const combined = [
    ...current.filter((item) => item.origin === "seed"),
    ...customExercises,
  ];

  const byName = new Map<string, Exercise>();

  combined.forEach((exercise) => {
    const key = normalizeDisplayName(exercise.name);
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, exercise);
      return;
    }

    const candidateScore = computeExerciseScore(exercise);
    const existingScore = computeExerciseScore(existing);

    let winner = existing;
    if (candidateScore > existingScore) {
      winner = exercise;
    } else if (candidateScore === existingScore && exercise.origin === "seed") {
      winner = exercise;
    }

    // When merging, prefer seed exercise's supportsUnilateral value (authoritative source)
    // Only use OR logic if neither is a seed exercise
    const finalSupportsUnilateral = winner.origin === "seed"
      ? winner.supportsUnilateral
      : existing.supportsUnilateral || exercise.supportsUnilateral;

    const finalForceUnilateral = winner.origin === "seed"
      ? winner.forceUnilateral
      : existing.forceUnilateral || exercise.forceUnilateral;

    byName.set(key, {
      ...winner,
      supportsUnilateral: finalSupportsUnilateral,
      forceUnilateral: finalForceUnilateral,
    });
  });

  return Array.from(byName.values());
};

export const ExercisePicker = ({ onSelect, onCancel }: ExercisePickerProps) => {
  const { toast } = useToast();
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [loadingCustom, setLoadingCustom] = useState(true);
  const [selectingSeedId, setSelectingSeedId] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);
  const [unilateralOverrides, setUnilateralOverrides] = useState<Record<string, boolean>>({});
  const [customExercise, setCustomExercise] = useState({
    name: "",
    equipment: "",
    muscle_group: "",
    is_bodyweight: false,
    supportsUnilateral: false,
    imageFile: null as File | null,
    imagePreview: null as string | null,
  });
  const listRef = useRef<HTMLDivElement | null>(null);

  const getOverrideKey = (exercise: Exercise): string | null => {
    if (exercise.seedId) return exercise.seedId;
    if (exercise.supabaseId) return exercise.supabaseId;
    if (exercise.id) return exercise.id;
    return null;
  };

  const getUnilateralChoice = (exercise: Exercise): boolean => {
    // Only return true if exercise actually supports unilateral
    if (!exercise.supportsUnilateral) return false;

    const key = getOverrideKey(exercise);
    if (key && Object.prototype.hasOwnProperty.call(unilateralOverrides, key)) {
      return unilateralOverrides[key];
    }
    return false; // Default to bilateral mode
  };

  const setUnilateralChoice = (exercise: Exercise, value: boolean) => {
    const key = getOverrideKey(exercise);
    if (!key) {
      if (import.meta.env.DEV) {
        console.warn('[ExercisePicker] Cannot set unilateral choice: no valid key for exercise', exercise);
      }
      return;
    }
    setUnilateralOverrides((prev) => ({ ...prev, [key]: value }));
    setExercises((prev) =>
      prev.map((item) => {
        if (getOverrideKey(item) !== key) return item;
        // Update all exercises including seed exercises with forceUnilateral flag
        return {
          ...item,
          supportsUnilateral: value || item.supportsUnilateral,
          forceUnilateral: value,
        };
      }),
    );
  };

  useEffect(() => {
    const loadCustomExercises = async () => {
      let hasCachedResults = false;
      try {
        const session = await getSupabaseSession();
        const user = session?.user;
        const accessToken = session?.access_token;
        if (!user || !accessToken) {
          setLoadingCustom(false);
          return;
        }

        const cached = readCachedCustomExercises(user.id);
        if (cached.length > 0) {
          hasCachedResults = true;
          setExercises((prev) => mergeExerciseLists(prev, cached));
          setLoadingCustom(false);
        }

        const useOffline = shouldUseOfflineMode();

        if (useOffline) {
          // OFFLINE MODE: Load from IndexedDB cache
          console.log('[ExercisePicker] Loading exercises from cache (offline)');
          try {
            const cachedExercises = await getExercisesOffline(user.id);
            const allExercises: Exercise[] = cachedExercises
              .map((item: any) => {
                // Filter out unilateral variants (they're created automatically when needed)
                if (item.name && typeof item.name === "string" && item.name.match(/\(unilateral\)\s*$/i)) {
                  return null;
                }
                const isGlobalExercise = item.owner_user_id === null;
                return {
                  id: String(item.id),
                  name: item.name,
                  equipment: item.equipment,
                  muscle_group: item.muscle_group,
                  body_part: item.body_part ?? null,
                  is_bodyweight: item.is_bodyweight ?? false,
                  supabaseId: String(item.id),
                  origin: isGlobalExercise ? "seed" as const : "custom" as const,
                  supportsUnilateral: Boolean(item.is_unilateral) || nameSupportsUnilateralToggle(item.name),
                  forceUnilateral: false,
                  image_url: item.image_url,
                };
              })
              .filter((item): item is Exercise => Boolean(item));

            setExercises(allExercises);
            const customExercises = allExercises.filter(e => e.origin === "custom");
            writeCachedCustomExercises(user.id, customExercises);
            setLoadingCustom(false);
            return;
          } catch (offlineError) {
            console.error('[ExercisePicker] Failed to load from offline cache:', offlineError);
            // Continue to use localStorage cache
            setLoadingCustom(false);
            return;
          }
        }

        // ONLINE MODE: Fetch from Supabase (global + custom exercises)
        const supabaseUrl = getSupabaseUrl();
        const apiKey = getSupabaseAnonKey();
        const response = await fetch(
          `${supabaseUrl}/rest/v1/exercises?or=(owner_user_id.is.null,owner_user_id.eq.${encodeURIComponent(user.id)})&select=id,name,equipment,muscle_group,body_part,is_bodyweight,is_unilateral,owner_user_id,image_url`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
          },
        );

        if (!response.ok) {
          throw new Error("Failed to load custom exercises");
        }

        const data = await response.json();

        const cachedMap = new Map<string, Exercise>();
        cached.forEach((entry) => {
          if (entry.supabaseId) cachedMap.set(entry.supabaseId, entry);
          cachedMap.set(normalizeDisplayName(entry.name), entry);
        });

        const allExercises: Exercise[] = (data || [])
          .map((item: any) => {
            if (!item || typeof item !== "object") return null;
            const rawName = typeof item.name === "string" ? item.name : "";
            if (!rawName) return null;

            // Filter out unilateral variants (they're created automatically when needed)
            if (rawName.match(/\(unilateral\)\s*$/i)) return null;

            const isGlobalExercise = item.owner_user_id === null;
            const cachedEntry =
              cachedMap.get(String(item.id)) || cachedMap.get(normalizeDisplayName(rawName));
            const supportsUnilateral = Boolean(item.is_unilateral) || nameSupportsUnilateralToggle(rawName);
            const forceUnilateral = Boolean(item.is_unilateral) || cachedEntry?.forceUnilateral || false;
            return {
              id: String(item.id),
              name: rawName,
              equipment: item.equipment,
              muscle_group: item.muscle_group,
              body_part: item.body_part ?? null,
              is_bodyweight: item.is_bodyweight ?? false,
              supabaseId: String(item.id),
              origin: isGlobalExercise ? "seed" as const : "custom" as const,
              supportsUnilateral,
              forceUnilateral,
              image_url: item.image_url,
            };
          })
          .filter((item): item is Exercise => Boolean(item));

        // Replace seed exercises with global exercises from database
        setExercises(allExercises);

        // Cache only custom exercises
        const customExercises = allExercises.filter(e => e.origin === "custom");
        writeCachedCustomExercises(user.id, customExercises);
      } catch (error) {
        console.error(error);

        // Fallback to offline cache on error
        try {
          const session = await getSupabaseSession();
          const user = session?.user;
          if (user) {
            console.warn('[ExercisePicker] Online fetch failed, using offline cache');
            const cachedExercises = await getExercisesOffline(user.id);
            const allExercises: Exercise[] = cachedExercises
              .map((item: any) => {
                // Filter out unilateral variants (they're created automatically when needed)
                if (item.name && typeof item.name === "string" && item.name.match(/\(unilateral\)\s*$/i)) {
                  return null;
                }
                const isGlobalExercise = item.owner_user_id === null;
                return {
                  id: String(item.id),
                  name: item.name,
                  equipment: item.equipment,
                  muscle_group: item.muscle_group,
                  body_part: item.body_part ?? null,
                  is_bodyweight: item.is_bodyweight ?? false,
                  supabaseId: String(item.id),
                  origin: isGlobalExercise ? "seed" as const : "custom" as const,
                  supportsUnilateral: Boolean(item.is_unilateral) || nameSupportsUnilateralToggle(item.name),
                  forceUnilateral: false,
                  image_url: item.image_url,
                };
              })
              .filter((item): item is Exercise => Boolean(item));

            setExercises(allExercises);
            const customExercises = allExercises.filter(e => e.origin === "custom");
            writeCachedCustomExercises(user.id, customExercises);
            setLoadingCustom(false);
            return;
          }
        } catch (fallbackError) {
          console.error('[ExercisePicker] Fallback to offline cache failed:', fallbackError);
        }

        if (!hasCachedResults) {
          toast({
            title: "Error",
            description: "Unable to load your custom exercises",
            variant: "destructive",
          });
        }
      } finally {
        setLoadingCustom(false);
      }
    };

    loadCustomExercises();
  }, [toast]);

  const filteredExercises = useMemo(() => {
    if (!deferredSearch.trim()) return exercises;
    const term = deferredSearch.toLowerCase();
    return exercises.filter((exercise) => {
      const nameMatch = exercise.name.toLowerCase().includes(term);
      const muscleMatch = exercise.muscle_group?.toLowerCase().includes(term);
      const regionMatch = exercise.body_part?.toLowerCase().includes(term);
      return nameMatch || muscleMatch || regionMatch;
    });
  }, [exercises, deferredSearch]);

  const regionOrder = useMemo(() => {
    const order = new Map<string, number>();
    primaryRegions.forEach((region, index) => {
      // Store both original case and lowercase for case-insensitive lookup
      order.set(region, index);
      order.set(region.toLowerCase(), index);
    });
    return order;
  }, []);

  // Helper function to normalize muscle group / body part display names
  const normalizeDisplayName = (name: string | null | undefined): string | null => {
    if (!name) return null;

    const trimmed = name.trim();
    const normalizedLower = trimmed.toLowerCase();

    // Map variations to standard names
    if (normalizedLower === "lower arms" || normalizedLower === "upper arms") {
      return "Arms";
    } else if (normalizedLower === "lower legs" || normalizedLower === "upper legs") {
      return "Legs";
    }

    // Apply Title Case for consistency
    return trimmed
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  };

  const groupedExercises = useMemo(() => {
    return filteredExercises.reduce((acc, exercise) => {
      // Use body_part first, fallback to muscle_group for custom exercises, then "Other"
      let group = (exercise.body_part || exercise.muscle_group || "Other").trim();

      // Normalize category names to ensure consistent grouping
      const normalizedLower = group.toLowerCase();

      // Map variations to standard names
      if (normalizedLower === "lower arms" || normalizedLower === "upper arms") {
        group = "Arms";
      } else if (normalizedLower === "lower legs" || normalizedLower === "upper legs") {
        group = "Legs";
      } else {
        // Capitalize first letter of each word for consistency
        // This ensures "legs", "Legs", "LEGS" all become "Legs"
        group = group
          .split(' ')
          .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
          .join(' ');
      }

      if (!acc[group]) acc[group] = [];
      acc[group].push(exercise);
      return acc;
    }, {} as Record<string, Exercise[]>);
  }, [filteredExercises]);

  const sortedGroups = useMemo(() => {
    return Object.entries(groupedExercises).sort((a, b) => {
      // Try exact match first, then lowercase for case-insensitive matching
      const rankA = regionOrder.get(a[0]) ?? regionOrder.get(a[0].toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
      const rankB = regionOrder.get(b[0]) ?? regionOrder.get(b[0].toLowerCase()) ?? Number.MAX_SAFE_INTEGER;

      // If both are unknown categories (both MAX_SAFE_INTEGER), sort alphabetically
      // But put "Other" at the very end
      if (rankA === Number.MAX_SAFE_INTEGER && rankB === Number.MAX_SAFE_INTEGER) {
        if (a[0] === "Other") return 1;
        if (b[0] === "Other") return -1;
        return a[0].localeCompare(b[0]);
      }

      if (rankA !== rankB) return rankA - rankB;
      return a[0].localeCompare(b[0]);
    });
  }, [groupedExercises, regionOrder]);

  const flatRows = useMemo<PickerRow[]>(() => {
    const rows: PickerRow[] = [];
    sortedGroups.forEach(([group, groupExercises]) => {
      rows.push({ type: "group", key: `group-${group}`, label: group });
      groupExercises.forEach((exercise) => {
        rows.push({ type: "exercise", key: `exercise-${exercise.id}`, exercise });
      });
    });
    return rows;
  }, [sortedGroups]);

  const estimatePickerRowSize = useCallback(
    (index: number) => {
      const row = flatRows[index];
      if (!row) return 80;
      // Group: h3 (~20px) + paddingBottom (32px) = ~52px
      // Exercise: Card (~92px) + paddingBottom (32px) = ~124px
      return row.type === "group" ? 52 : 124;
    },
    [flatRows]
  );

  const pickerVirtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => listRef.current,
    estimateSize: estimatePickerRowSize,
    overscan: 12,
  });

  const pickerVirtualItems = pickerVirtualizer.getVirtualItems();
  const pickerTotalHeight = pickerVirtualizer.getTotalSize();

  const ensureSeedSupabaseId = async (exercise: Exercise): Promise<string> => {
    if (exercise.supabaseId) return exercise.supabaseId;
    if (!exercise.seedId) return exercise.supabaseId ?? exercise.id;

    const session = await getSupabaseSession();
    const user = session?.user;
    const accessToken = session?.access_token;
    if (!user || !accessToken) throw new Error("Please sign in to use this exercise");

    const supabaseMap = readSupabaseMap(user.id);
    if (supabaseMap[exercise.seedId]) {
      return supabaseMap[exercise.seedId];
    }

    // Check if we're in offline mode
    const useOffline = shouldUseOfflineMode();

    if (useOffline) {
      // OFFLINE MODE: Check IndexedDB cache for existing exercise
      try {
        const db = await getDB();
        const cached = await db.getAll('exercises');
        const existing = cached.find(
          (ex: any) => ex.name === exercise.name && ex.owner_user_id === user.id
        );

        if (existing) {
          // Found in cache, update map and return
          const nextMap = { ...supabaseMap, [exercise.seedId]: existing.id };
          writeSupabaseMap(user.id, nextMap);
          return existing.id;
        }

        // Not found in cache - create temporary ID that will be resolved during sync
        const tempId = `temp-seed-${exercise.seedId}`;
        console.log('[ExercisePicker] Using temp ID for offline seed exercise:', tempId);
        return tempId;
      } catch (error) {
        console.error('[ExercisePicker] Error checking offline cache:', error);
        // Fall back to temp ID
        return `temp-seed-${exercise.seedId}`;
      }
    }

    // ONLINE MODE: Original lookup/registration logic
    const supabaseUrl = getSupabaseUrl();
    const apiKey = getSupabaseAnonKey();
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      apikey: apiKey,
    };

    const encodedName = encodeURIComponent(exercise.name);
    const ownerFilter = encodeURIComponent(user.id);
    const lookupResponse = await fetch(
      `${supabaseUrl}/rest/v1/exercises?select=id,name,body_part&name=eq.${encodedName}&owner_user_id=eq.${ownerFilter}`,
      { headers },
    );

    if (!lookupResponse.ok) {
      throw new Error("Failed to look up exercise");
    }

    const existing = await lookupResponse.json();
    let supabaseId: string | undefined = existing?.[0]?.id;

    const fallbackBodyPart = exercise.body_part ?? seedRegionMap.get(exercise.name.toLowerCase()) ?? null;

    if (!supabaseId) {
      const insertResponse = await fetch(`${supabaseUrl}/rest/v1/exercises`, {
        method: "POST",
        headers: {
          ...headers,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          name: exercise.name,
          body_part: fallbackBodyPart,
          is_bodyweight: exercise.is_bodyweight,
          owner_user_id: user.id,
        }),
      });

      if (!insertResponse.ok) {
        throw new Error("Failed to register exercise");
      }
      const created = await insertResponse.json();
      supabaseId = created?.[0]?.id;
    }

    if (!supabaseId) {
      throw new Error("Unable to determine exercise reference");
    }

    const nextMap = { ...supabaseMap, [exercise.seedId]: supabaseId };
    writeSupabaseMap(user.id, nextMap);
    return supabaseId;
  };

  
  const persistCustomUnilateralPreference = async (exercise: Exercise, supports: boolean) => {
    if (exercise.origin !== "custom" || !exercise.supabaseId) return;
    try {
      const session = await getSupabaseSession();
      if (!session?.user?.id) return;
      const { error } = await supabase
        .from("exercises")
        .update({ is_unilateral: supports })
        .eq("id", exercise.supabaseId)
        .eq("owner_user_id", session.user.id);
      if (error) throw error;
    } catch (error) {
      console.error("Failed to persist unilateral preference", error);
    }
  };

const handleSeedSelection = async (exercise: Exercise, asUnilateral: boolean) => {
    setSelectingSeedId(exercise.seedId || exercise.id);
    try {
      const supabaseId = await ensureSeedSupabaseId(exercise);
      const fallbackBodyPart =
        exercise.body_part ?? seedRegionMap.get(exercise.name.toLowerCase()) ?? null;
      const enriched: Exercise = {
        ...exercise,
        id: supabaseId,
        supabaseId,
        body_part: fallbackBodyPart,
        forceUnilateral: asUnilateral,
        supportsUnilateral: asUnilateral || exercise.supportsUnilateral,
      };

      // Preserve override state across ID transition
      const oldKey = getOverrideKey(exercise);
      const newKey = getOverrideKey(enriched);

      if (oldKey && newKey && oldKey !== newKey) {
        setUnilateralOverrides((prev) => {
          const next = { ...prev };
          // Transfer the override from old key to new key
          if (Object.prototype.hasOwnProperty.call(next, oldKey)) {
            next[newKey] = next[oldKey];
            delete next[oldKey]; // Clean up old override
            if (import.meta.env.DEV) {
              console.log(`[ExercisePicker] Transferred override state from ${oldKey} to ${newKey}: ${next[newKey]}`);
            }
          } else {
            // If no override exists, set it based on asUnilateral
            next[newKey] = asUnilateral;
            if (import.meta.env.DEV) {
              console.log(`[ExercisePicker] Set new override state for ${newKey}: ${asUnilateral}`);
            }
          }
          return next;
        });
      } else {
        setUnilateralChoice(enriched, asUnilateral);
      }

      // Validate the final state
      if (import.meta.env.DEV) {
        const finalChoice = getUnilateralChoice(enriched);
        if (enriched.supportsUnilateral && asUnilateral !== finalChoice) {
          console.warn(`[ExercisePicker] State mismatch after selection: expected ${asUnilateral}, got ${finalChoice}`);
        }
      }

      onSelect(enriched);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Could not select exercise",
        variant: "destructive",
      });
    } finally {
      setSelectingSeedId(null);
    }
  };

  const handleCustomSelection = (exercise: Exercise, asUnilateral: boolean) => {
    const enriched: Exercise = {
      ...exercise,
      supportsUnilateral: asUnilateral || exercise.supportsUnilateral,
      forceUnilateral: asUnilateral,
    };
    setUnilateralChoice(enriched, asUnilateral);
    onSelect(enriched);
  };

  const createCustomExercise = async () => {
    if (!customExercise.name.trim()) {
      toast({
        title: "Error",
        description: "Exercise name is required",
        variant: "destructive",
      });
      return;
    }

    setCreating(true);
    try {
      const session = await getSupabaseSession();
      const user = session?.user;
      if (!user) throw new Error("Not authenticated");

      const isOffline = shouldUseOfflineMode();

      // OFFLINE MODE: Create exercise in IndexedDB and queue for sync
      if (isOffline) {
        if (import.meta.env.DEV) console.log('[ExercisePicker] Creating custom exercise offline');

        const exerciseId = generateUUID();
        const timestamp = new Date().toISOString();

        const exerciseData = {
          id: exerciseId,
          name: customExercise.name.trim(),
          equipment: customExercise.equipment.trim() || null,
          muscle_group: customExercise.muscle_group.trim() || null,
          body_part: null,
          is_bodyweight: customExercise.is_bodyweight,
          owner_user_id: user.id,
          is_unilateral: customExercise.supportsUnilateral,
          image_url: null, // Images not supported offline
          created_at: timestamp,
          updated_at: timestamp,
        };

        // Add to IndexedDB
        const db = await getDB();
        await db.put('exercises', exerciseData);

        // Queue operation for sync
        await queueOperation({
          type: 'insert',
          table: 'exercises',
          data: exerciseData,
          timestamp,
          userId: user.id,
        });

        if (import.meta.env.DEV) console.log('[ExercisePicker] Custom exercise queued for sync:', exerciseId);

        toast({
          title: "Custom exercise created",
          description: `${customExercise.name} added to your library (offline)`,
        });

        const newExercise: Exercise = {
          id: exerciseId,
          name: exerciseData.name,
          equipment: exerciseData.equipment,
          muscle_group: exerciseData.muscle_group,
          body_part: exerciseData.body_part ?? null,
          is_bodyweight: exerciseData.is_bodyweight ?? false,
          supabaseId: exerciseId,
          origin: "custom",
          supportsUnilateral: customExercise.supportsUnilateral,
          forceUnilateral: false,
          image_url: null,
        };

        // Update in-memory list and cache
        setExercises((prev) => {
          const customExercises = [
            ...prev.filter((item) => item.origin === "custom" && item.id !== newExercise.id),
            newExercise,
          ];
          const next = mergeExerciseLists(prev, customExercises);
          writeCachedCustomExercises(user.id, customExercises);
          return next;
        });

        setCustomExercise({
          name: "",
          equipment: "",
          muscle_group: "",
          is_bodyweight: false,
          supportsUnilateral: false,
          imageFile: null,
          imagePreview: null,
        });
        setShowCreateForm(false);
        onSelect(newExercise);
        return;
      }

      // ONLINE MODE: Create exercise via Supabase
      const accessToken = session?.access_token;
      if (!accessToken) throw new Error("Not authenticated");

      const supabaseUrl = getSupabaseUrl();
      const apiKey = getSupabaseAnonKey();

      // First, create the exercise record
      const response = await fetch(`${supabaseUrl}/rest/v1/exercises`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: apiKey,
          Prefer: "return=representation",
        },
        body: JSON.stringify({
          name: customExercise.name.trim(),
          equipment: customExercise.equipment.trim() || null,
          muscle_group: customExercise.muscle_group.trim() || null,
          body_part: null,
          is_bodyweight: customExercise.is_bodyweight,
          owner_user_id: user.id,
          is_unilateral: customExercise.supportsUnilateral,
        }),
      });

      if (!response.ok) throw new Error("Failed to create exercise");
      const body = await response.json();
      const record = body[0];

      let imageUrl: string | null = null;

      // If user uploaded an image, upload it to storage and update the exercise
      if (customExercise.imageFile && record.id) {
        try {
          imageUrl = await uploadExerciseImage(String(record.id), customExercise.imageFile, true);

          // Update exercise with image URL
          await fetch(`${supabaseUrl}/rest/v1/exercises?id=eq.${record.id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
              apikey: apiKey,
            },
            body: JSON.stringify({ image_url: imageUrl }),
          });
        } catch (imageError) {
          console.error("Failed to upload image:", imageError);
          // Continue anyway - exercise was created, just without image
          toast({
            title: "Warning",
            description: "Exercise created but image upload failed",
            variant: "destructive",
          });
        }
      }

      toast({
        title: "Custom exercise created",
        description: `${customExercise.name} added to your library`,
      });

      const newExercise: Exercise = {
        id: String(record.id ?? `custom-${Date.now()}`),
        name: record.name,
        equipment: record.equipment,
        muscle_group: record.muscle_group,
        body_part: record.body_part ?? null,
        is_bodyweight: record.is_bodyweight ?? false,
        supabaseId: String(record.id ?? ""),
        origin: "custom",
        supportsUnilateral: customExercise.supportsUnilateral,
        forceUnilateral: false, // Default to bilateral mode when adding to workout
        image_url: imageUrl,
      };

      // Update in-memory list and cache
      setExercises((prev) => {
        const customExercises = [
          ...prev.filter((item) => item.origin === "custom" && item.id !== newExercise.id),
          newExercise,
        ];
        const next = mergeExerciseLists(prev, customExercises);
        writeCachedCustomExercises(user.id, customExercises);
        return next;
      });

      setCustomExercise({
        name: "",
        equipment: "",
        muscle_group: "",
        is_bodyweight: false,
        supportsUnilateral: false,
        imageFile: null,
        imagePreview: null,
      });
      setShowCreateForm(false);
      onSelect(newExercise);
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to create exercise",
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col">
      <div
        className="border-b px-4 pb-4 space-y-4"
        style={{ paddingTop: `max(env(safe-area-inset-top, 0px) + 0.75rem, 2.75rem)` }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">
            {showCreateForm ? "Create Custom Exercise" : "Add Exercise"}
          </h2>
          <Button
            variant="ghost"
            onClick={() => {
              if (showCreateForm) {
                setShowCreateForm(false);
                setCustomExercise({
                  name: "",
                  equipment: "",
                  muscle_group: "",
                  is_bodyweight: false,
                  supportsUnilateral: false,
                });
              } else {
                onCancel();
              }
            }}
            className="h-10"
          >
            {showCreateForm ? "Back" : "Cancel"}
          </Button>
        </div>
        {!showCreateForm && (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search exercises..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              className="pl-10 h-12 text-base"
            />
          </div>
        )}
      </div>

      {showCreateForm ? (
        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6 max-w-2xl mx-auto">
            <Card className="border-2">
              <CardContent className="p-6 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="exercise-name">Exercise Name *</Label>
                  <Input
                    id="exercise-name"
                    type="text"
                    placeholder="e.g., Overhead Press"
                    value={customExercise.name}
                    onChange={(event) =>
                      setCustomExercise({ ...customExercise, name: event.target.value })
                    }
                    className="h-12"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exercise-image">Exercise Image (Optional)</Label>
                  <div className="flex flex-col gap-3">
                    {customExercise.imagePreview && (
                      <div className="w-24 h-24 rounded-lg overflow-hidden bg-muted">
                        <img
                          src={customExercise.imagePreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    )}
                    <Input
                      id="exercise-image"
                      type="file"
                      accept="image/*"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onloadend = () => {
                            setCustomExercise({
                              ...customExercise,
                              imageFile: file,
                              imagePreview: reader.result as string,
                            });
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="h-12"
                    />
                    {customExercise.imageFile && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setCustomExercise({
                            ...customExercise,
                            imageFile: null,
                            imagePreview: null,
                          });
                        }}
                      >
                        Remove Image
                      </Button>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="equipment">Equipment</Label>
                  <Select
                    value={customExercise.equipment}
                    onValueChange={(value) =>
                      setCustomExercise({ ...customExercise, equipment: value })
                    }
                  >
                    <SelectTrigger id="equipment" className="h-12">
                      <SelectValue placeholder="Select equipment" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="barbell">Barbell</SelectItem>
                      <SelectItem value="dumbbell">Dumbbell</SelectItem>
                      <SelectItem value="cable">Cable</SelectItem>
                      <SelectItem value="machine">Machine</SelectItem>
                      <SelectItem value="bodyweight">Bodyweight</SelectItem>
                      <SelectItem value="bands">Bands</SelectItem>
                      <SelectItem value="kettlebell">Kettlebell</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="muscle-group">Muscle Group</Label>
                  <Select
                    value={customExercise.muscle_group}
                    onValueChange={(value) =>
                      setCustomExercise({ ...customExercise, muscle_group: value })
                    }
                  >
                    <SelectTrigger id="muscle-group" className="h-12">
                      <SelectValue placeholder="Select muscle group" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chest">Chest</SelectItem>
                      <SelectItem value="back">Back</SelectItem>
                      <SelectItem value="shoulders">Shoulders</SelectItem>
                      <SelectItem value="arms">Arms</SelectItem>
                      <SelectItem value="legs">Legs</SelectItem>
                      <SelectItem value="core">Core</SelectItem>
                      <SelectItem value="cardio">Cardio/Conditioning</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center justify-between rounded-lg border border-muted px-3 py-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">Supports unilateral tracking</p>
                    <p className="text-xs text-muted-foreground">
                      Enable to log left/right weights for this exercise.
                    </p>
                  </div>
                  <Switch
                    checked={customExercise.supportsUnilateral}
                    onCheckedChange={(checked) =>
                      setCustomExercise((prev) => ({ ...prev, supportsUnilateral: checked }))
                    }
                    aria-label="Toggle unilateral support"
                  />
                </div>

                <Button
                  onClick={createCustomExercise}
                  disabled={creating || !customExercise.name.trim()}
                  className="w-full h-12"
                >
                  {creating ? "Creating..." : "Create Exercise"}
                </Button>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
      ) : (
        <>
          <div ref={listRef} className="flex-1 overflow-y-auto">
            <div className="p-4 space-y-6">
              <Card
                className="border-2 border-primary cursor-pointer hover:bg-muted/50 transition-colors"
                onClick={() => setShowCreateForm(true)}
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                      <Dumbbell className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold text-base">Create Custom Exercise</h4>
                      <p className="text-sm text-muted-foreground">
                        Can't find what you're looking for? Add your own
                      </p>
                    </div>
                    <Plus className="h-6 w-6 text-primary" />
                  </div>
                </CardContent>
              </Card>

              {loadingCustom ? (
                <div className="text-center py-12 text-muted-foreground">
                  Loading your library...
                </div>
              ) : filteredExercises.length === 0 ? (
                <div className="text-center py-12 text-muted-foreground">
                  <p className="text-lg">No exercises found</p>
                  <p className="text-sm mt-2">
                    Try a different search term or create a custom exercise
                  </p>
                </div>
              ) : (
                <div className="relative" style={{ height: pickerTotalHeight }}>
                  {pickerVirtualItems.map((virtualRow) => {
                    const row = flatRows[virtualRow.index];
                    if (!row) return null;

                    if (row.type === "group") {
                      return (
                        <div
                          key={row.key}
                          data-index={virtualRow.index}
                          ref={pickerVirtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${virtualRow.start}px)`,
                            paddingBottom: '32px',
                          }}
                        >
                          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                            {row.label}
                          </h3>
                        </div>
                      );
                    }

                    const exercise = row.exercise;
                    const disabled = exercise.origin === "seed" && selectingSeedId === exercise.seedId;
                    const supportsToggle = Boolean(exercise.supportsUnilateral);
                    const unilateralEnabled = supportsToggle ? getUnilateralChoice(exercise) : false;

                    return (
                      <div
                        key={row.key}
                        data-index={virtualRow.index}
                        ref={pickerVirtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                          paddingBottom: '32px',
                        }}
                      >
                        <Card
                          className="backdrop-blur-xl bg-white/70 dark:bg-neutral-800/70 border border-white/20 dark:border-white/10 rounded-2xl cursor-pointer transition-all active:scale-[0.98] shadow-sm"
                          onClick={() =>
                            exercise.origin === "seed"
                              ? handleSeedSelection(exercise, unilateralEnabled)
                              : handleCustomSelection(exercise, unilateralEnabled)
                          }
                        >
                          <CardContent className="p-3.5">
                            <div className="flex items-center gap-3.5">
                              <ExerciseImage
                                exerciseId={exercise.id}
                                imageUrl={exercise.image_url || undefined}
                                exerciseName={exercise.name}
                                size="md"
                                disableAutoCache={true}
                              />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-0.5">
                                  <h4 className="font-semibold text-base leading-tight truncate">{exercise.name}</h4>
                                  {supportsToggle && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                                      L/R
                                    </span>
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground truncate">
                                  {[normalizeDisplayName(exercise.body_part), normalizeDisplayName(exercise.muscle_group), exercise.equipment].filter(Boolean).join(' • ')}
                                </p>
                              </div>
                              <Plus
                                className={`h-5 w-5 flex-shrink-0 ${
                                  disabled
                                    ? "text-muted-foreground/60"
                                    : "text-primary"
                                }`}
                              />
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default ExercisePicker;
