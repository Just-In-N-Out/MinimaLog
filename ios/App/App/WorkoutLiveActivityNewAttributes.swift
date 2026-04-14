import Foundation
import ActivityKit

@available(iOS 16.1, *)
public struct WorkoutLiveActivityNewAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        public let startDate: Date
        public let exerciseCount: Int

        public init(startDate: Date, exerciseCount: Int) {
            self.startDate = startDate
            self.exerciseCount = exerciseCount
        }
    }

    public let workoutId: String
    public let name: String

    public init(workoutId: String, name: String) {
        self.workoutId = workoutId
        self.name = name
    }
}
