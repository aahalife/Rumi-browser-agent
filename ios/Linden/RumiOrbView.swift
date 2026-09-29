import SwiftUI

/// A pearlescent, ribbon-like orb inspired by the supplied motion reference.
struct RumiOrbView: View {
    let phase: VoiceController.Phase
    let level: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 24, paused: reduceMotion || phase == .off || phase == .approval)) { context in
            let time = reduceMotion ? 0 : context.date.timeIntervalSinceReferenceDate
            let speed = phase == .working || phase == .transcribing ? 1.2 : 0.5
            ZStack {
                Circle().fill(RadialGradient(colors: [.white, Color(hex: 0xEDF1FE), Color(hex: 0xC3D8ED)], center: .topLeading, startRadius: 0, endRadius: 95))
                Canvas { canvas, size in
                    for index in 0..<5 {
                        let fraction = Double(index) / 5
                        let wave = sin(time * speed + fraction * .pi * 2)
                        var ribbon = Path()
                        ribbon.move(to: CGPoint(x: -size.width * 0.2, y: size.height * (0.25 + fraction * 0.12)))
                        ribbon.addCurve(to: CGPoint(x: size.width * 1.2, y: size.height * (0.65 - fraction * 0.08)), control1: CGPoint(x: size.width * 0.4, y: size.height * (-0.5 + wave * 0.25)), control2: CGPoint(x: size.width * 0.55, y: size.height * (1.5 + wave * 0.25)))
                        canvas.stroke(ribbon, with: .linearGradient(Gradient(colors: [Color(hex: 0xE7AACF).opacity(0.65), .white.opacity(0.9), Color(hex: 0x5EAFE5).opacity(0.75)]), startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)), style: StrokeStyle(lineWidth: 9 + level * 9, lineCap: .round))
                    }
                }
                .rotationEffect(.degrees(reduceMotion ? -20 : sin(time * speed * 0.5) * 35 - 20))
                Circle().fill(RadialGradient(colors: [.white.opacity(0.8), .clear], center: .topLeading, startRadius: 0, endRadius: 50))
                Circle().stroke(.white.opacity(0.9), lineWidth: 1.5)
            }
            .clipShape(.circle)
            .scaleEffect(reduceMotion ? 1 : 0.94 + level * 0.06)
        }
        .shadow(color: Color(hex: 0x9CB9DE).opacity(0.35), radius: 12, y: 5)
        .accessibilityHidden(true)
    }
}
