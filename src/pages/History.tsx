import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { Paywall } from "@/components/Paywall";
import { FeatureLock } from "@/components/FeatureLock";
import { getSupabaseSession } from "@/lib/session";
import { Calendar, Dumbbell, ChevronLeft, ChevronRight, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiquidGlassHeader } from "@/components/LiquidGlassHeader";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  subMonths,
  isSameMonth,
  isSameDay,
} from "date-fns";
import { supabase } from "@/integrations/supabase/client";

interface HistoryItem {
  postId: string;
  workoutId: string;
  createdAt: string;
  title: string | null;
  caption: string | null;
  startedAt: string | null;
  endedAt: string | null;
  notes: string | null;
  exerciseCount: number;
  setCount: number;
}

const History = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { isPremium } = useSubscription();
  const [showPaywall, setShowPaywall] = useState(false);
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const initialLoadRef = useRef(true);

  const loadHistory = useCallback(async () => {
    try {
      setLoading(true);
      const session = await getSupabaseSession();
      const user = session?.user;
      if (!user) {
        navigate("/auth");
        return;
      }

      // OPTIMIZATION: Single query with joins instead of 4 sequential queries
      const { data: postsData, error: postsError } = await supabase
        .from("posts")
        .select(`
          id,
          created_at,
          title,
          caption,
          workout_id,
          workouts!inner(
            id,
            started_at,
            ended_at,
            notes,
            workout_exercises(
              id,
              sets(id)
            )
          )
        `)
        .eq("user_id", user.id)
        .eq("show_workout_details", true)
        .order("created_at", { ascending: false });

      if (postsError) throw postsError;

      const shareablePosts = (postsData || []).filter((post: any) => post.workout_id && post.workouts);
      if (shareablePosts.length === 0) {
        setItems([]);
        setSelectedDate(null);
        return;
      }

      // OPTIMIZATION: Process nested data in single loop (no additional queries)
      const historyItems = shareablePosts.map((post: any) => {
        const workout = post.workouts;
        const exerciseCount = workout?.workout_exercises?.length ?? 0;
        const setCount = workout?.workout_exercises?.reduce(
          (sum: number, we: any) => sum + (we.sets?.length ?? 0),
          0
        ) ?? 0;

        return {
          postId: post.id,
          workoutId: post.workout_id,
          createdAt: post.created_at,
          title: post.title || null,
          caption: post.caption || null,
          startedAt: workout?.started_at || null,
          endedAt: workout?.ended_at || null,
          notes: workout?.notes || null,
          exerciseCount,
          setCount,
        } as HistoryItem;
      });

      if (initialLoadRef.current) {
        if (historyItems.length > 0) {
          const latest = historyItems[0];
          const latestDateValue = latest.startedAt ?? latest.createdAt;
          if (latestDateValue) {
            const latestDate = new Date(latestDateValue);
            if (!Number.isNaN(latestDate.getTime())) {
              setCurrentMonth(startOfMonth(latestDate));
              setSelectedDate(latestDate);
            }
          }
        } else {
          setSelectedDate(null);
        }
        initialLoadRef.current = false;
      }

      setItems(historyItems);
    } catch (error) {
      console.error("Failed to load history", error);
      toast({
        title: "Error",
        description: "Unable to load workout history",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [navigate, toast]);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  useEffect(() => {
    const eventListener: EventListener = () => {
      loadHistory();
    };
    window.addEventListener("post:deleted:confirmed", eventListener);
    window.addEventListener("post:delete:failed", eventListener);
    return () => {
      window.removeEventListener("post:deleted:confirmed", eventListener);
      window.removeEventListener("post:delete:failed", eventListener);
    };
  }, [loadHistory]);

  const formatDateKey = useCallback((date: Date) => format(date, "yyyy-MM-dd"), []);

  const workoutsByDate = useMemo(() => {
    const map = new Map<string, HistoryItem[]>();
    items.forEach((item) => {
      const source = item.startedAt ?? item.createdAt;
      if (!source) return;
      const date = new Date(source);
      if (Number.isNaN(date.getTime())) return;
      const key = formatDateKey(date);
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)!.push(item);
    });
    return map;
  }, [items, formatDateKey]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 0 });
    const days: Date[] = [];
    let day = start;
    while (day <= end) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentMonth]);

  useEffect(() => {
    const daysThisMonth = monthDays
      .filter((day) => isSameMonth(day, currentMonth))
      .filter((day) => workoutsByDate.has(formatDateKey(day)))
      .sort((a, b) => a.getTime() - b.getTime());

    if (daysThisMonth.length === 0) {
      if (selectedDate && !isSameMonth(selectedDate, currentMonth)) {
        setSelectedDate(null);
      }
      return;
    }

    if (
      selectedDate &&
      isSameMonth(selectedDate, currentMonth) &&
      workoutsByDate.has(formatDateKey(selectedDate))
    ) {
      return;
    }

    setSelectedDate(daysThisMonth[daysThisMonth.length - 1]);
  }, [currentMonth, monthDays, workoutsByDate, selectedDate, formatDateKey]);

  const selectedKey = selectedDate ? formatDateKey(selectedDate) : null;
  const selectedItems = selectedKey ? workoutsByDate.get(selectedKey) ?? [] : [];

  const weekdaysShort = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const handlePrevMonth = () => {
    setCurrentMonth((prev) => subMonths(prev, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth((prev) => addMonths(prev, 1));
  };

  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(startOfMonth(today));
    setSelectedDate(today);
  };

  const getIntensityClasses = (count: number, isCurrentMonthDay: boolean) => {
    if (count === 0) {
      return isCurrentMonthDay
        ? "border-muted bg-muted/20 text-muted-foreground"
        : "border-transparent bg-transparent text-muted-foreground/50";
    }
    if (count >= 4) return "border-emerald-500 bg-emerald-500/90 text-emerald-900";
    if (count === 3) return "border-emerald-400 bg-emerald-400/80 text-emerald-900";
    if (count === 2) return "border-emerald-300 bg-emerald-300/70 text-emerald-900";
    return "border-emerald-200 bg-emerald-200/60 text-emerald-900";
  };

  const getWorkoutDuration = (item: HistoryItem) => {
    if (!item.startedAt || !item.endedAt) return null;
    const start = new Date(item.startedAt);
    const end = new Date(item.endedAt);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    const minutes = Math.floor((end.getTime() - start.getTime()) / 60000);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <Dumbbell className="h-12 w-12 animate-pulse mx-auto mb-4" />
          <p className="text-lg text-muted-foreground">Loading history...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-white dark:bg-neutral-900">
      <LiquidGlassHeader>
        <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
          <Calendar className="h-5 w-5 text-primary-foreground" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">History</h1>
      </LiquidGlassHeader>

      <main
        className="flex-1 overflow-y-auto overflow-x-hidden smooth-scroll"
        style={{ paddingTop: 'calc(env(safe-area-inset-top) + 90px)' }}
      >
        <div className="container mx-auto px-4 py-6 max-w-4xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 100px)' }}>
          {items.length === 0 ? (
            <Card className="border-2">
              <CardContent className="py-12 text-center">
                <Dumbbell className="h-16 w-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-xl font-semibold mb-2">No workouts yet</h3>
                <p className="text-muted-foreground mb-6">
                  Share a workout with details to see it here
                </p>
                <Button onClick={() => navigate("/start-workout")}>
                  Start Your First Workout
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <Card className="border-2">
                <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle className="text-lg sm:text-xl">Monthly Overview</CardTitle>
                    <CardDescription>Select a highlighted day to revisit your workouts.</CardDescription>
                  </div>
                  <div className="flex w-full flex-col-reverse items-stretch gap-2 sm:w-auto sm:flex-row sm:items-center sm:justify-end sm:gap-3">
                    <div className="flex items-center justify-between gap-2 sm:justify-end">
                      <Button variant="outline" size="icon" onClick={handlePrevMonth} aria-label="Previous month">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <div className="min-w-[130px] text-center font-semibold text-sm sm:text-base">
                        {format(currentMonth, "MMMM yyyy")}
                      </div>
                      <Button variant="outline" size="icon" onClick={handleNextMonth} aria-label="Next month">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleToday}>
                        Today
                      </Button>
                    </div>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="gap-2 sm:self-end"
                      onClick={() => navigate("/history/monthly-overview")}
                    >
                      <BarChart3 className="h-4 w-4" />
                      Monthly overview
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-7 gap-1 sm:gap-2 text-center text-[10px] sm:text-xs font-medium text-muted-foreground">
                    {weekdaysShort.map((weekday) => (
                      <div key={weekday} className="py-1">
                        {weekday}
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-7 gap-1 sm:gap-2">
                    {monthDays.map((day) => {
                      const key = formatDateKey(day);
                      const workouts = workoutsByDate.get(key) ?? [];
                      const count = workouts.length;
                      const isCurrentMonthDay = isSameMonth(day, currentMonth);
                      const isSelected = selectedDate ? isSameDay(day, selectedDate) : false;
                      const isToday = isSameDay(day, new Date());

                      const dayClasses = cn(
                        "relative flex h-10 w-10 sm:h-12 sm:w-12 items-center justify-center rounded-lg border text-xs sm:text-sm transition-all duration-150",
                        isCurrentMonthDay ? "cursor-pointer" : "cursor-default opacity-50",
                        getIntensityClasses(count, isCurrentMonthDay),
                        isSelected && "ring-2 ring-offset-2 ring-primary ring-offset-background",
                        !isCurrentMonthDay && "border-dashed",
                        isToday && "border-primary/50"
                      );

                      return (
                        <button
                          key={key}
                          type="button"
                          className={dayClasses}
                          onClick={() => {
                            if (count > 0) {
                              setSelectedDate(new Date(day));
                            }
                          }}
                          disabled={count === 0}
                        >
                          <span className="font-semibold">
                            {format(day, "d")}
                          </span>
                          {count > 0 && (
                            <span className="absolute bottom-1 text-[10px] font-medium opacity-80">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-4">
                <div>
                  <h2 className="text-lg sm:text-xl font-semibold">
                    {selectedDate
                      ? `Workouts on ${format(selectedDate, "MMMM d, yyyy")}`
                      : "Select a highlighted day"}
                  </h2>
                  <p className="text-sm text-muted-foreground">
                    {selectedItems.length > 0
                      ? `${selectedItems.length} workout${selectedItems.length > 1 ? "s" : ""} logged`
                      : "Choose a day with activity to see workout details."}
                  </p>
                </div>

                {selectedItems.length === 0 ? (
                  <Card className="border-dashed bg-muted/30">
                    <CardContent className="py-10 text-center text-sm text-muted-foreground">
                      No workouts recorded for this day.
                    </CardContent>
                  </Card>
                ) : (
                  <>
                    {!isPremium && selectedItems.length > 0 && (
                      <div className="relative">
                        <div className="absolute inset-0 z-10 flex items-center justify-center">
                          <FeatureLock
                            featureName="Workout History Details"
                            onUpgrade={() => setShowPaywall(true)}
                          />
                        </div>
                        <div className="opacity-30 pointer-events-none blur-sm space-y-4">
                          {selectedItems.slice(0, 2).map((item) => {
                            const displayDate = item.startedAt ?? item.createdAt;
                            const dateObj = displayDate ? new Date(displayDate) : null;
                            const formattedDate = dateObj && !Number.isNaN(dateObj.getTime())
                              ? format(dateObj, "PPP p")
                              : "Unknown date";
                            const duration = getWorkoutDuration(item);

                            return (
                              <Card
                                key={`locked-${item.postId}-${item.workoutId}`}
                                className="no-focus-ring border-2"
                              >
                                <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div>
                                    <CardTitle className="text-base sm:text-lg">
                                      {item.title ?? "Untitled workout"}
                                    </CardTitle>
                                    <CardDescription>{formattedDate}</CardDescription>
                                  </div>
                                  <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-muted-foreground">
                                    <span>{item.exerciseCount} exercises</span>
                                    <span>{item.setCount} sets</span>
                                    {duration && <span>{duration}</span>}
                                  </div>
                                </CardHeader>
                                <CardContent className="space-y-3">
                                  {item.caption && (
                                    <p className="text-sm text-muted-foreground">{item.caption}</p>
                                  )}
                                  {item.notes && (
                                    <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                                      <span className="font-semibold text-foreground">Notes:</span>
                                      <p className="mt-1 whitespace-pre-wrap">{item.notes}</p>
                                    </div>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {isPremium && (
                      <div className="space-y-4">
                        {selectedItems.map((item) => {
                          const displayDate = item.startedAt ?? item.createdAt;
                          const dateObj = displayDate ? new Date(displayDate) : null;
                          const formattedDate = dateObj && !Number.isNaN(dateObj.getTime())
                            ? format(dateObj, "PPP p")
                            : "Unknown date";
                          const duration = getWorkoutDuration(item);

                          return (
                            <Card
                              key={`${item.postId}-${item.workoutId}`}
                              className="no-focus-ring border-2 transition-all duration-100 cursor-pointer active:scale-[0.98]"
                              onClick={() => navigate(`/workout-detail/${item.workoutId}`)}
                          style={{
                            WebkitTapHighlightColor: 'transparent',
                            WebkitUserSelect: 'none',
                            userSelect: 'none',
                            outline: 'none',
                            boxShadow: 'none'
                          }}
                        >
                          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div>
                              <CardTitle className="text-base sm:text-lg">
                                {item.title ?? "Untitled workout"}
                              </CardTitle>
                              <CardDescription>{formattedDate}</CardDescription>
                            </div>
                            <div className="flex flex-wrap gap-3 text-xs sm:text-sm text-muted-foreground">
                              <span>{item.exerciseCount} exercises</span>
                              <span>{item.setCount} sets</span>
                              {duration && <span>{duration}</span>}
                            </div>
                          </CardHeader>
                          <CardContent className="space-y-3">
                            {item.caption && (
                              <p className="text-sm text-muted-foreground">{item.caption}</p>
                            )}
                            <div className="flex flex-wrap gap-2" />
                            {item.notes && (
                              <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground">
                                <span className="font-semibold text-foreground">Notes:</span>
                                <p className="mt-1 whitespace-pre-wrap">{item.notes}</p>
                              </div>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <Paywall open={showPaywall} onClose={() => setShowPaywall(false)} feature="Workout History Details" />
    </div>
  );
};

export default History;
