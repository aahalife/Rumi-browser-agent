import SwiftUI
import UIKit

extension Color {
    static let river = Color(hex: 0x126952)
    static let riverText = Color(hex: 0x125B49)
    static let riverDeep = Color(hex: 0x002D23)
    static let ink = Color(hex: 0x183B31)
    static let inkSoft = Color(hex: 0x63736B)
    static let mist = Color(hex: 0xF7F8F4)
    static let paper = Color.white
    static let shallows = Color(hex: 0xE1F3EA)
    static let line = Color(hex: 0xD7E4DD)
    static let amber = Color(hex: 0xE5BF53)
    static let amberInk = Color(hex: 0x795D15)
    static let alert = Color(hex: 0xA63F47)
    static let success = Color(hex: 0x247653)
    static let mint = Color(hex: 0x4BC4A6)
    static let blush = Color(hex: 0xF2BCB8)
    static let sunshine = Color(hex: 0xFFE682)

    init(hex: UInt32) {
        self.init(red: Double((hex >> 16) & 255) / 255,
                  green: Double((hex >> 8) & 255) / 255, blue: Double(hex & 255) / 255)
    }

    init(light: UInt32, dark: UInt32) { self.init(hex: light) }
}

enum Haptics {
    static func notice(_ type: UINotificationFeedbackGenerator.FeedbackType) {
        UINotificationFeedbackGenerator().notificationOccurred(type)
    }
    static func tap(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .light) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }
}

struct LindenBackground: View {
    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color.mist
                Ellipse().fill(Color.mint.opacity(0.23))
                    .frame(width: geometry.size.width * 0.85, height: 370)
                    .blur(radius: 65).offset(x: geometry.size.width * 0.38, y: -80)
                Ellipse().fill(Color.blush.opacity(0.32))
                    .frame(width: geometry.size.width * 0.9, height: 320)
                    .blur(radius: 75).offset(x: -100, y: 160)
                Ellipse().fill(Color.sunshine.opacity(0.28))
                    .frame(width: 300, height: 240)
                    .blur(radius: 60).offset(x: 100, y: 280)
            }.frame(width: geometry.size.width, height: geometry.size.height).clipped()
        }.ignoresSafeArea().allowsHitTesting(false)
    }
}

extension View {
    func frostedCard() -> some View {
        self.background(.regularMaterial, in: .rect(cornerRadius: 26))
            .overlay(RoundedRectangle(cornerRadius: 26).stroke(.white.opacity(0.85), lineWidth: 1))
            .shadow(color: Color.riverDeep.opacity(0.04), radius: 18, y: 8)
    }

    @ViewBuilder func lindenGlass() -> some View {
        if #available(iOS 26.0, *) { self.glassEffect(.regular, in: .capsule) }
        else { self.background(.ultraThinMaterial, in: .capsule) }
    }
}
