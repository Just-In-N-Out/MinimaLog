import UIKit
import Capacitor
import Dispatch

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {

        print("🔵 [AppDelegate] Application starting...")

        // Set window background to match system appearance (prevents white/black flash)
        if let window = self.window {
            window.backgroundColor = UIColor.systemBackground
        }

        // Register plugin immediately after bridge is ready
        DispatchQueue.main.async {
            if let bridgeVC = self.window?.rootViewController as? CAPBridgeViewController {
                print("✅ [AppDelegate] Found CAPBridgeViewController")

                // Set WebView background to match system appearance (adaptive light/dark)
                bridgeVC.view.backgroundColor = UIColor.systemBackground
                if let webView = bridgeVC.webView {
                    webView.backgroundColor = UIColor.systemBackground
                    webView.isOpaque = false
                    webView.scrollView.backgroundColor = UIColor.systemBackground
                }

                if let bridge = bridgeVC.bridge {
                    print("✅ [AppDelegate] Found bridge, registering LiveActivitiesPlugin...")

                    let plugin = LiveActivitiesPlugin()
                    bridge.registerPluginInstance(plugin)

                    print("✅ [AppDelegate] LiveActivitiesPlugin registered")
                    print("   - identifier: \(plugin.identifier)")
                    print("   - jsName: \(plugin.jsName)")
                } else {
                    print("❌ [AppDelegate] Bridge is nil")
                }
            } else {
                print("❌ [AppDelegate] Could not find CAPBridgeViewController")
            }
        }
        
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {}
    func applicationDidEnterBackground(_ application: UIApplication) {}
    func applicationWillEnterForeground(_ application: UIApplication) {}
    func applicationDidBecomeActive(_ application: UIApplication) {}
    func applicationWillTerminate(_ application: UIApplication) {
        // Clean up live activities when app is force-quit
        print("🔴 [AppDelegate] App terminating, stopping all live activities...")
        if #available(iOS 16.1, *) {
            let semaphore = DispatchSemaphore(value: 0)
            Task.detached(priority: .userInitiated) {
                await LiveActivitiesController.shared.stopActivity(workoutId: nil)
                semaphore.signal()
            }

            let timeoutResult = semaphore.wait(timeout: .now() + 1.0)
            if timeoutResult == .timedOut {
                print("⚠️ [AppDelegate] Timed out before confirming Live Activity shutdown")
            } else {
                print("✅ [AppDelegate] Live activities stopped")
            }
        }
    }

    func application(_ app: UIApplication,
                     open url: URL,
                     options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication,
                     continue userActivity: NSUserActivity,
                     restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application,
                                                           continue: userActivity,
                                                           restorationHandler: restorationHandler)
    }
}
