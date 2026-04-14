import { Fragment, useRef, useState, useEffect, useCallback } from "react";
import type { PointerEvent } from "react";
import { GripVertical, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import type { Exercise } from "@/pages/WorkoutSession/types";

export interface DraggableExerciseItem {
  id: string;
  exerciseId: string;
  name: string;
  disabled?: boolean;
  isUnilateral?: boolean;
  exercise?: Exercise; // Full exercise data for checking unilateral support
  [key: string]: any; // Allow additional properties for custom data
}

interface DraggableExerciseListProps {
  items: DraggableExerciseItem[];
  onReorder: (next: DraggableExerciseItem[]) => void;
  onRemove?: (id: string) => void;
  onToggleUnilateral?: (id: string, isUnilateral: boolean) => void;
  renderItem?: (item: DraggableExerciseItem, index: number) => React.ReactNode;
  showDefaultContent?: boolean;
}

const DraggableExerciseList = ({ items, onReorder, onRemove, onToggleUnilateral, renderItem, showDefaultContent = true }: DraggableExerciseListProps) => {
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [pointerPosition, setPointerPosition] = useState<{ x: number; y: number } | null>(null);
  const [dragMetrics, setDragMetrics] = useState<{
    width: number;
    height: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const initialPointerRef = useRef<{ x: number; y: number } | null>(null);
  const [isLongPressActive, setIsLongPressActive] = useState(false);
  const autoScrollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const scrollPositionRef = useRef<number>(0);

  const draggedItem = draggingId ? items.find((item) => item.id === draggingId) ?? null : null;
  const currentIndex = draggingId ? items.findIndex((item) => item.id === draggingId) : -1;
  const nonDraggingItems = draggingId ? items.filter((item) => item.id !== draggingId) : items;
  const defaultDropIndex =
    draggingId && currentIndex !== -1 ? Math.min(currentIndex, nonDraggingItems.length) : null;
  const effectiveDropIndex =
    draggingId && currentIndex !== -1 ? dropIndex ?? defaultDropIndex ?? 0 : null;

  // Prevent scrolling when dragging and store initial scroll position
  useEffect(() => {
    if (isLongPressActive && draggingId) {
      // Find the main scrollable container (the main element with overflow-y-auto)
      const mainScrollContainer = document.querySelector('main.overflow-y-auto') as HTMLElement;
      const initialScrollTop = mainScrollContainer?.scrollTop || 0;
      scrollPositionRef.current = initialScrollTop;

      // Store original styles
      const originalOverflow = mainScrollContainer?.style.overflow || '';
      const originalTouchAction = mainScrollContainer?.style.touchAction || '';

      // Prevent scrolling by setting overflow hidden and touch-action none on the container
      if (mainScrollContainer) {
        mainScrollContainer.style.overflow = 'hidden';
        mainScrollContainer.style.touchAction = 'none';
      }

      return () => {
        // Restore original styles
        if (mainScrollContainer) {
          mainScrollContainer.style.overflow = originalOverflow;
          mainScrollContainer.style.touchAction = originalTouchAction;
        }
      };
    }
  }, [isLongPressActive, draggingId]);

  const resetDragState = () => {
    setDraggingId(null);
    setPointerPosition(null);
    setDragMetrics(null);
    setDropIndex(null);
    setIsLongPressActive(false);
    initialPointerRef.current = null;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
  };

  const calculateDropIndex = (pointerY: number) => {
    if (!draggingId) return null;
    const others = items.filter((item) => item.id !== draggingId);
    if (others.length === 0) return 0;

    for (let index = 0; index < others.length; index++) {
      const target = others[index];
      const node = itemRefs.current[target.id];
      if (!node) continue;
      const rect = node.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (pointerY < midpoint) {
        return index;
      }
    }

    return others.length;
  };

  // Handler for pointer move
  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    // Only process if we're waiting for long press
    if (longPressTimerRef.current && initialPointerRef.current && !isLongPressActive) {
      const deltaX = Math.abs(event.clientX - initialPointerRef.current.x);
      const deltaY = Math.abs(event.clientY - initialPointerRef.current.y);
      const moveThreshold = 10; // pixels

      if (deltaX > moveThreshold || deltaY > moveThreshold) {
        // User is scrolling, cancel long press
        resetDragState();
        return;
      }
      // Don't process movement while waiting for long press
      return;
    }

    // Only process if drag is active
    if (!draggingId || !dragMetrics || !isLongPressActive) return;

    event.preventDefault();
    event.stopPropagation();

    const clientX = event.clientX;
    const clientY = event.clientY;

    const nextPointerPosition = { x: clientX, y: clientY };
    setPointerPosition(nextPointerPosition);

    const nextDropIndex = calculateDropIndex(clientY);
    if (typeof nextDropIndex === "number" && nextDropIndex !== dropIndex) {
      setDropIndex(nextDropIndex);
    }

    // Auto-scroll logic (top and bottom edges)
    const scrollZoneTop = 400; // pixels from top edge to trigger scroll (very large area for easy triggering)
    const scrollZoneBottom = 150; // pixels from bottom edge to trigger scroll
    const scrollSpeed = 8; // pixels per frame
    const pointerY = clientY;
    const viewportHeight = window.innerHeight;

    // Clear existing auto-scroll
    if (autoScrollIntervalRef.current) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }

    // Check if near top edge of viewport
    if (pointerY < scrollZoneTop) {
      // Calculate scroll speed based on how close to edge (faster when closer)
      const distanceFromEdge = Math.max(0, pointerY);
      const speedMultiplier = Math.max(1, (scrollZoneTop - distanceFromEdge) / scrollZoneTop * 4);
      const adjustedSpeed = Math.ceil(scrollSpeed * speedMultiplier);

      autoScrollIntervalRef.current = setInterval(() => {
        // Find the main scrollable container
        const mainScrollContainer = document.querySelector('main.overflow-y-auto') as HTMLElement;
        if (mainScrollContainer && mainScrollContainer.scrollTop > 0) {
          const newScrollPosition = Math.max(0, mainScrollContainer.scrollTop - adjustedSpeed);
          mainScrollContainer.scrollTop = newScrollPosition;
          scrollPositionRef.current = newScrollPosition;
        }
      }, 16); // ~60fps
    }
    // Check if near bottom edge of viewport
    else if (pointerY > viewportHeight - scrollZoneBottom) {
      // Calculate scroll speed based on how close to edge (faster when closer)
      const distanceFromEdge = Math.max(0, viewportHeight - pointerY);
      const speedMultiplier = Math.max(1, (scrollZoneBottom - distanceFromEdge) / scrollZoneBottom * 4);
      const adjustedSpeed = Math.ceil(scrollSpeed * speedMultiplier);

      autoScrollIntervalRef.current = setInterval(() => {
        // Find the main scrollable container
        const mainScrollContainer = document.querySelector('main.overflow-y-auto') as HTMLElement;
        if (mainScrollContainer) {
          const maxScroll = mainScrollContainer.scrollHeight - mainScrollContainer.clientHeight;
          if (mainScrollContainer.scrollTop < maxScroll) {
            const newScrollPosition = Math.min(maxScroll, mainScrollContainer.scrollTop + adjustedSpeed);
            mainScrollContainer.scrollTop = newScrollPosition;
            scrollPositionRef.current = newScrollPosition;
          }
        }
      }, 16); // ~60fps
    }
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    // If long press timer is still running, cancel it (user didn't hold long enough)
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }

    if (!draggingId || !isLongPressActive) {
      resetDragState();
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const dragged = items.find((item) => item.id === draggingId);
    if (!dragged) {
      resetDragState();
      return;
    }

    const others = items.filter((item) => item.id !== draggingId);
    const insertAt =
      dropIndex ?? (currentIndex !== -1 ? Math.min(currentIndex, others.length) : others.length);

    const next = [...others];
    next.splice(insertAt, 0, dragged);
    onReorder(next);
    resetDragState();
  };

  const handlePointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    resetDragState();
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, id: string, disabled?: boolean) => {
    // Don't start drag if clicking on interactive elements or if item is disabled
    if ((event.target as HTMLElement | null)?.closest("button, input, textarea, select, a")) {
      return;
    }

    if (disabled) {
      return;
    }

    const node = itemRefs.current[id];
    if (!node) return;

    // Store initial pointer position
    initialPointerRef.current = { x: event.clientX, y: event.clientY };

    const rect = node.getBoundingClientRect();

    // Start long press timer (500ms = 0.5 seconds)
    longPressTimerRef.current = setTimeout(() => {
      // Long press completed, activate drag
      event.preventDefault();
      setDraggingId(id);
      setIsLongPressActive(true);
      setDragMetrics({
        width: rect.width,
        height: rect.height,
        offsetX: initialPointerRef.current!.x - rect.left,
        offsetY: initialPointerRef.current!.y - rect.top,
      });
      setPointerPosition({ x: initialPointerRef.current!.x, y: initialPointerRef.current!.y });

      const others = items.filter((item) => item.id !== id);
      const index = items.findIndex((item) => item.id === id);
      setDropIndex(Math.min(index, others.length));

      // Add haptic feedback if available
      if (navigator.vibrate) {
        navigator.vibrate(50);
      }

      longPressTimerRef.current = null;
    }, 500); // 500ms = 0.5 seconds hold time
  };

  const renderPlaceholder = () => {
    if (!draggingId || !draggedItem) return null;

    return (
      <div
        aria-hidden
        className="flex items-center justify-between rounded-xl border-2 border-dashed border-primary/60 bg-primary/5 px-4 py-3 text-sm font-semibold text-primary/80 opacity-70"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary/70">
            <GripVertical className="h-4 w-4" />
          </div>
          <div>
            <p>{draggedItem.name}</p>
            <p className="text-xs font-normal text-primary/60">
              Exercise {(effectiveDropIndex ?? 0) + 1}
            </p>
          </div>
        </div>
      </div>
    );
  };

  let nonDraggingIndex = 0;

  return (
    <div className="space-y-2">
      {items.map((item, index) => {
        const isDragging = draggingId === item.id;
        let placeholderBefore = false;
        const currentOtherIndex = !isDragging ? nonDraggingIndex : null;

        if (!isDragging) {
          nonDraggingIndex += 1;
        }

        if (
          draggingId &&
          !isDragging &&
          typeof effectiveDropIndex === "number" &&
          currentOtherIndex === effectiveDropIndex
        ) {
          placeholderBefore = true;
        }

        return (
          <Fragment key={item.id}>
            {placeholderBefore && renderPlaceholder()}
            <div
              ref={(node) => {
                itemRefs.current[item.id] = node;
              }}
              className={`relative ${
                isDragging && isLongPressActive ? "ring-2 ring-primary bg-background shadow-xl" : ""
              } ${item.disabled ? "opacity-50 cursor-not-allowed" : ""}`}
              style={{
                position: isDragging && isLongPressActive && pointerPosition && dragMetrics ? "fixed" : "relative",
                top:
                  isDragging && isLongPressActive && pointerPosition && dragMetrics
                    ? pointerPosition.y - dragMetrics.offsetY
                    : undefined,
                left:
                  isDragging && isLongPressActive && pointerPosition && dragMetrics
                    ? pointerPosition.x - dragMetrics.offsetX
                    : undefined,
                width: isDragging && isLongPressActive && dragMetrics ? dragMetrics.width : undefined,
                zIndex: isDragging && isLongPressActive ? 50 : "auto",
                transform: isDragging && isLongPressActive ? "scale(0.95)" : undefined,
                boxShadow: isDragging && isLongPressActive ? "0 20px 45px -12px rgba(0,0,0,0.25)" : undefined,
                touchAction: isDragging && isLongPressActive ? "none" : undefined,
                userSelect: isDragging && isLongPressActive ? "none" : "auto",
                cursor: isDragging && isLongPressActive ? "grabbing" : "default",
              }}
              onPointerDown={(event) => handlePointerDown(event, item.id, item.disabled)}
              onPointerMove={(event) => {
                // Only process pointer move for the item being interacted with
                if (longPressTimerRef.current && initialPointerRef.current && !isLongPressActive) {
                  // Check if user moved too much (cancel long press)
                  const deltaX = Math.abs(event.clientX - initialPointerRef.current.x);
                  const deltaY = Math.abs(event.clientY - initialPointerRef.current.y);
                  if (deltaX > 10 || deltaY > 10) {
                    resetDragState();
                  }
                } else if (isDragging && isLongPressActive) {
                  // Only process drag movement for the item being dragged
                  handlePointerMove(event);
                }
              }}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            >
              {isDragging && isLongPressActive ? (
                // Show simplified version when dragging
                <div className="flex items-center justify-center rounded-xl border-2 border-primary bg-background px-4 py-6">
                  <div className="flex items-center gap-3">
                    <GripVertical className="h-5 w-5 text-primary" />
                    <p className="text-base font-semibold text-foreground">{item.name}</p>
                  </div>
                </div>
              ) : renderItem ? (
                renderItem(item, index)
              ) : showDefaultContent ? (
                <div className="flex items-center justify-between rounded-xl border bg-muted/30 px-4 py-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-foreground">{item.name}</p>
                    <p className="text-xs text-muted-foreground">Exercise {index + 1}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {onToggleUnilateral && (item.exercise?.supportsUnilateral || item.exercise?.is_unilateral) && (
                      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                        <span className={!item.isUnilateral ? "font-medium" : ""}>Bi</span>
                        <Switch
                          checked={item.isUnilateral ?? false}
                          onCheckedChange={(value) => {
                            onToggleUnilateral(item.id, value);
                          }}
                          className="scale-75"
                        />
                        <span className={item.isUnilateral ? "font-medium" : ""}>Uni</span>
                      </div>
                    )}
                    {onRemove && (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => onRemove(item.id)}
                        aria-label={`Remove ${item.name}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </Fragment>
        );
      })}
      {draggingId &&
        typeof effectiveDropIndex === "number" &&
        effectiveDropIndex === nonDraggingItems.length &&
        renderPlaceholder()}
    </div>
  );
};

export default DraggableExerciseList;
