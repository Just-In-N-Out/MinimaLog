import { useMemo } from "react";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { arrayMove, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { DraggableExercise, ExerciseDragOverlay } from "./SortableExerciseRow";

export interface SortableExercise {
  id: string;
  name: string;
  exerciseId: string;
}

interface SortableExerciseListProps {
  exercises: SortableExercise[];
  onReorder: (next: SortableExercise[]) => void;
  onRemove?: (exerciseId: string) => void;
}

export const SortableExerciseList = ({ exercises, onReorder, onRemove }: SortableExerciseListProps) => {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    })
  );

  const ids = useMemo(() => exercises.map((ex) => ex.id), [exercises]);

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={(event) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
          const oldIndex = exercises.findIndex((item) => item.id === active.id);
          const newIndex = exercises.findIndex((item) => item.id === over.id);
          onReorder(arrayMove(exercises, oldIndex, newIndex));
        }
      }}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="space-y-2">
          {exercises.map((exercise) => (
            <DraggableExercise
              key={exercise.id}
              exercise={exercise}
              onRemove={onRemove}
            />
          ))}
        </div>
      </SortableContext>
      <ExerciseDragOverlay exercises={exercises} />
    </DndContext>
  );
};
