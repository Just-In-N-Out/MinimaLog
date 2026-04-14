import { forwardRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SortableExercise } from "./SortableExerciseList";

interface DraggableExerciseProps {
  exercise: SortableExercise;
  onRemove?: (exerciseId: string) => void;
}

export const DraggableExercise = ({ exercise, onRemove }: DraggableExerciseProps) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: exercise.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className="border flex items-center justify-between gap-4 px-4 py-3 bg-background"
    >
      <div className="flex items-center gap-3">
        <button
          className="h-10 w-10 flex items-center justify-center rounded-full bg-muted hover:bg-muted/70"
          {...listeners}
          {...attributes}
          type="button"
          aria-label="Reorder exercise"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </button>
        <span className="text-sm font-semibold">{exercise.name}</span>
      </div>
      {onRemove && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => onRemove(exercise.id)}
        >
          Remove
        </Button>
      )}
    </Card>
  );
};

interface ExerciseDragOverlayProps {
  exercises: SortableExercise[];
}

export const ExerciseDragOverlay = ({ exercises }: ExerciseDragOverlayProps) => {
  return null;
};
