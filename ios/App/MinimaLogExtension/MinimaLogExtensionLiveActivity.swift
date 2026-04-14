//
//  MinimaLogExtensionLiveActivity.swift
//  MinimaLogExtension
//
//  Created by Justin Issa on 27/10/2025.
//

import ActivityKit
import WidgetKit
import SwiftUI

struct MinimaLogExtensionAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        // Dynamic stateful properties about your activity go here!
        var emoji: String
    }

    // Fixed non-changing properties about your activity go here!
    var name: String
}

struct MinimaLogExtensionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: MinimaLogExtensionAttributes.self) { context in
            // Lock screen/banner UI goes here
            VStack {
                Text("Hello \(context.state.emoji)")
            }
            .activityBackgroundTint(Color.cyan)
            .activitySystemActionForegroundColor(Color.black)

        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded UI goes here.  Compose the expanded UI through
                // various regions, like leading/trailing/center/bottom
                DynamicIslandExpandedRegion(.leading) {
                    Text("Leading")
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text("Trailing")
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Bottom \(context.state.emoji)")
                    // more content
                }
            } compactLeading: {
                Text("L")
            } compactTrailing: {
                Text("T \(context.state.emoji)")
            } minimal: {
                Text(context.state.emoji)
            }
            .widgetURL(URL(string: "http://www.apple.com"))
            .keylineTint(Color.red)
        }
    }
}

extension MinimaLogExtensionAttributes {
    fileprivate static var preview: MinimaLogExtensionAttributes {
        MinimaLogExtensionAttributes(name: "World")
    }
}

extension MinimaLogExtensionAttributes.ContentState {
    fileprivate static var smiley: MinimaLogExtensionAttributes.ContentState {
        MinimaLogExtensionAttributes.ContentState(emoji: "😀")
     }
     
     fileprivate static var starEyes: MinimaLogExtensionAttributes.ContentState {
         MinimaLogExtensionAttributes.ContentState(emoji: "🤩")
     }
}

#Preview("Notification", as: .content, using: MinimaLogExtensionAttributes.preview) {
   MinimaLogExtensionLiveActivity()
} contentStates: {
    MinimaLogExtensionAttributes.ContentState.smiley
    MinimaLogExtensionAttributes.ContentState.starEyes
}
