import { registerPlugin } from "@capacitor/core";

export interface LiveActivityStartOptions {
  workoutId: string;
  workoutName: string;
  startDate: string; // ISO 8601
  exerciseCount: number;
}

export interface LiveActivitiesPlugin {
  start(options: LiveActivityStartOptions): Promise<{ activityId: string }>;
  update(options: { exerciseCount: number }): Promise<void>;
  stop(options?: { workoutId?: string }): Promise<void>;
}

export const LiveActivities = registerPlugin<LiveActivitiesPlugin>("LiveActivities");
