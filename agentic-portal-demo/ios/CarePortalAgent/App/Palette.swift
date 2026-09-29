import SwiftUI
import UIKit

// Tokens from DESIGN.md. Amber belongs to the assistant only.
extension Color {
    static let river = Color(light: 0x0E5E6F, dark: 0x0E5E6F)
    static let riverText = Color(light: 0x0E5E6F, dark: 0x6CC3D4)
    static let riverDeep = Color(light: 0x0A4552, dark: 0x0A4552)
    static let ink = Color(light: 0x16232B, dark: 0xE8EEF0)
    static let inkSoft = Color(light: 0x4E5D66, dark: 0xA7B4BB)
    static let mist = Color(light: 0xF3F7F8, dark: 0x0F1A1F)
    static let paper = Color(light: 0xFFFFFF, dark: 0x16232B)
    static let shallows = Color(light: 0xDCEEF1, dark: 0x1C3A42)
    static let line = Color(light: 0xD6E0E4, dark: 0x2A3A42)
    static let amber = Color(light: 0xE8A33D, dark: 0xE8A33D)
    static let amberInk = Color(light: 0x8A5A00, dark: 0xF0BE6A)
    static let alert = Color(light: 0xB3261E, dark: 0xF28B82)
    static let success = Color(light: 0x2E7D5B, dark: 0x6FCF97)

    init(light: UInt32, dark: UInt32) {
        self.init(uiColor: UIColor { traits in
            UIColor(hex: traits.userInterfaceStyle == .dark ? dark : light)
        })
    }
}

extension UIColor {
    convenience init(hex: UInt32) {
        self.init(
            red: CGFloat((hex >> 16) & 0xFF) / 255,
            green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255,
            alpha: 1
        )
    }
}

enum Haptics {
    static func notice(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }

    static func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
}
