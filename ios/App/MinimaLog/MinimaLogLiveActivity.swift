import ActivityKit
import WidgetKit
import SwiftUI

@available(iOS 16.1, *)
struct MinimaLogLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkoutLiveActivityNewAttributes.self) { context in
            // Lock screen / banner UI
            HStack(spacing: 12) {
                Image(systemName: "dumbbell")
                    .font(.system(size: 22, weight: .semibold))
                    .symbolRenderingMode(.monochrome)
                    .foregroundColor(.white)
                VStack(alignment: .leading, spacing: 4) {
                    Text(context.attributes.name)
                        .font(.headline)
                        .lineLimit(1)
                    
                    Text(context.state.startDate, style: .timer)
                        .font(.title2.monospacedDigit())
                        .foregroundStyle(.secondary)
                    
                    if context.state.exerciseCount > 0 {
                        Text("\(context.state.exerciseCount) exercises")
                            .font(.subheadline)
                            .foregroundStyle(.tertiary)
                    }
                }
                
                Spacer()
            }
            .padding(16)
            .activityBackgroundTint(Color.black.opacity(0.25))
            .activitySystemActionForegroundColor(.white)

        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    HStack(spacing: 6) {
                        Image(systemName: "dumbbell")
                            .font(.system(size: 16, weight: .semibold))
                            .symbolRenderingMode(.monochrome)
                            .foregroundColor(.white)
                        Text(context.state.startDate, style: .timer)
                            .font(.system(size: 14, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                            .lineLimit(1)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 3)
                }
            } compactLeading: {
                // Left side - gym icon
                Image(systemName: "dumbbell")
                    .font(.system(size: 16, weight: .semibold))
                    .symbolRenderingMode(.monochrome)
                    .foregroundColor(.white)
            } compactTrailing: {
                // Right side - just timer
                Text(context.state.startDate, style: .timer)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .frame(width: 44, alignment: .trailing)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                
            } minimal: {
                // Minimal view (e.g. when sharing the Island with Spotify) shows timer only
                Text(context.state.startDate, style: .timer)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
    }
}

@available(iOS 16.1, *)
private extension WorkoutLiveActivityNewAttributes {
    static var previewAttributes: WorkoutLiveActivityNewAttributes {
        WorkoutLiveActivityNewAttributes(workoutId: "preview-workout", name: "Upper Body")
    }
}

@available(iOS 16.1, *)
private extension WorkoutLiveActivityNewAttributes.ContentState {
    static var previewState: WorkoutLiveActivityNewAttributes.ContentState {
        WorkoutLiveActivityNewAttributes.ContentState(
            startDate: Date().addingTimeInterval(-600),
            exerciseCount: 5
        )
    }
}

#if DEBUG
@available(iOS 17.0, *)
#Preview("Workout Live Activity", as: .dynamicIsland(.compact), using: WorkoutLiveActivityNewAttributes.previewAttributes) {
    MinimaLogLiveActivity()
} contentStates: {
    WorkoutLiveActivityNewAttributes.ContentState.previewState
}
#endif
