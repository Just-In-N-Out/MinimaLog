import Foundation
import Capacitor
import ActivityKit

@available(iOS 16.1, *)
actor LiveActivitiesController {
    static let shared = LiveActivitiesController()

    private func sanitizedExerciseCount(_ value: Int) -> Int {
        max(0, value)
    }

    private func activities(matching workoutId: String?) -> [Activity<WorkoutLiveActivityNewAttributes>] {
        let running = Activity<WorkoutLiveActivityNewAttributes>.activities
        guard let workoutId, workoutId.isEmpty == false else {
            return running
        }

        return running.filter { $0.attributes.workoutId == workoutId }
    }

    func startActivity(workoutId: String,
                       workoutName: String,
                       startDate: Date,
                       exerciseCount: Int) async throws -> Activity<WorkoutLiveActivityNewAttributes> {
        let existingActivities = activities(matching: workoutId)
        if existingActivities.isEmpty == false {
            let resetState = WorkoutLiveActivityNewAttributes.ContentState(startDate: Date(), exerciseCount: 0)
            let resetContent = ActivityContent(state: resetState, staleDate: nil)
            for activity in existingActivities {
                await activity.end(resetContent, dismissalPolicy: .immediate)
            }
        }

        let sanitizedCount = sanitizedExerciseCount(exerciseCount)
        let normalizedName = workoutName.trimmingCharacters(in: .whitespacesAndNewlines)
        let attributes = WorkoutLiveActivityNewAttributes(workoutId: workoutId,
                                                          name: normalizedName.isEmpty ? "Workout" : normalizedName)
        let state = WorkoutLiveActivityNewAttributes.ContentState(startDate: startDate,
                                                                  exerciseCount: sanitizedCount)
        let content = ActivityContent(state: state, staleDate: nil)
        return try Activity<WorkoutLiveActivityNewAttributes>.request(attributes: attributes,
                                                                      content: content)
    }

    func updateActivity(workoutId: String?,
                        startDate: Date?,
                        exerciseCount: Int) async {
        let targets = activities(matching: workoutId)
        guard targets.isEmpty == false else { return }

        let sanitizedCount = sanitizedExerciseCount(exerciseCount)
        let state = WorkoutLiveActivityNewAttributes.ContentState(startDate: startDate ?? Date(),
                                                                  exerciseCount: sanitizedCount)
        let content = ActivityContent(state: state, staleDate: nil)

        for activity in targets {
            await activity.update(content)
        }
    }

    func stopActivity(workoutId: String?) async {
        let targets = activities(matching: workoutId)
        guard targets.isEmpty == false else { return }

        let state = WorkoutLiveActivityNewAttributes.ContentState(startDate: Date(), exerciseCount: 0)
        let content = ActivityContent(state: state, staleDate: nil)
        for activity in targets {
            await activity.end(content, dismissalPolicy: .immediate)
        }
    }
}

@objc(LiveActivities)
public class LiveActivitiesPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LiveActivities"
    public let jsName = "LiveActivities"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise)
    ]
    // Existing plugin implementation continues below.
    private lazy var isoFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    @objc func isAvailable(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            let info = ActivityAuthorizationInfo()
            if info.areActivitiesEnabled == false {
                CAPLog.print("[LiveActivitiesPlugin] ActivityKit reports Live Activities disabled; UI may still allow starting.")
            }
            call.resolve(["value": info.areActivitiesEnabled])
        } else {
            call.resolve(["value": false])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        guard let workoutId = call.getString("workoutId"), !workoutId.isEmpty else {
            call.reject("workoutId is required")
            return
        }

        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1 or later")
            return
        }

        let workoutName = call.getString("workoutName") ?? ""
        guard let startDateString = call.getString("startDate"),
              let startDate = parse(dateString: startDateString) else {
            call.reject("startDate must be a valid ISO 8601 string")
            return
        }

        let exerciseCount = call.getInt("exerciseCount") ?? 0

        Task {
            do {
                CAPLog.print("[LiveActivitiesPlugin] request start for workoutId=\(workoutId) name=\(workoutName) count=\(exerciseCount)")
                let activity = try await LiveActivitiesController.shared.startActivity(workoutId: workoutId,
                                                                                       workoutName: workoutName,
                                                                                       startDate: startDate,
                                                                                       exerciseCount: exerciseCount)
                await MainActor.run {
                    CAPLog.print("[LiveActivitiesPlugin] started activity id=\(activity.id)")
                    call.resolve(["activityId": activity.id])
                }
            } catch {
                await MainActor.run {
                    if let authorizationError = error as? ActivityAuthorizationError {
                        CAPLog.print("[LiveActivitiesPlugin] authorization error \(authorizationError.localizedDescription)")
                        call.reject("Live Activities authorization error: \(authorizationError.localizedDescription)")
                    } else {
                        CAPLog.print("[LiveActivitiesPlugin] failed to start: \(error.localizedDescription)")
                        call.reject("Failed to start Live Activity: \(error.localizedDescription)")
                    }
                }
            }
        }
    }

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1 or later")
            return
        }

        let workoutId = call.getString("workoutId")
        let exerciseCount = call.getInt("exerciseCount") ?? 0
        let startDate: Date?
        if let startDateString = call.getString("startDate"),
           let parsedDate = parse(dateString: startDateString) {
            startDate = parsedDate
        } else {
            startDate = nil
        }

        Task {
            await LiveActivitiesController.shared.updateActivity(workoutId: workoutId,
                                                                 startDate: startDate,
                                                                 exerciseCount: exerciseCount)
            await MainActor.run {
                CAPLog.print("[LiveActivitiesPlugin] update sent for workoutId=\(workoutId ?? "nil") count=\(exerciseCount)")
                call.resolve()
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1 or later")
            return
        }

        let workoutId = call.getString("workoutId")

        Task {
            await LiveActivitiesController.shared.stopActivity(workoutId: workoutId)
            await MainActor.run {
                CAPLog.print("[LiveActivitiesPlugin] stop issued for workoutId=\(workoutId ?? "nil")")
                call.resolve()
            }
        }
    }

    private func parse(dateString: String) -> Date? {
        if let isoDate = isoFormatter.date(from: dateString) {
            return isoDate
        }

        if let interval = Double(dateString) {
            return Date(timeIntervalSince1970: interval)
        }

        let fallbackFormatter = ISO8601DateFormatter()
        fallbackFormatter.formatOptions = [.withInternetDateTime]
        return fallbackFormatter.date(from: dateString)
    }
}
