//
//  MinimaLogExtensionBundle.swift
//  MinimaLogExtension
//
//  Created by Justin Issa on 27/10/2025.
//

import WidgetKit
import SwiftUI

@main
struct MinimaLogExtensionBundle: WidgetBundle {
    var body: some Widget {
        MinimaLogExtension()
        MinimaLogExtensionControl()
        MinimaLogExtensionLiveActivity()
    }
}
