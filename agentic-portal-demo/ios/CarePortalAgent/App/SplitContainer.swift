import SwiftUI

struct SplitContainer<Top: View, Bottom: View>: View {
    @ViewBuilder let top: () -> Top
    @ViewBuilder let bottom: () -> Bottom

    @State private var fraction: CGFloat = 0.6
    @State private var dragStart: CGFloat?
    private let handleHeight: CGFloat = 44
    private let presets: [CGFloat] = [0.35, 0.6, 0.8]

    var body: some View {
        GeometryReader { geo in
            let usable = geo.size.height - handleHeight
            VStack(spacing: 0) {
                top()
                    .frame(height: max(usable * fraction, 120))
                handle(total: usable)
                bottom()
                    .frame(maxHeight: .infinity)
            }
        }
    }

    private func handle(total: CGFloat) -> some View {
        ZStack {
            Color.mist
            Capsule()
                .fill(Color.line)
                .frame(width: 36, height: 5)
        }
        .frame(height: handleHeight)
        .contentShape(Rectangle())
        .gesture(
            DragGesture(minimumDistance: 2)
                .onChanged { value in
                    if dragStart == nil { dragStart = fraction }
                    let next = (dragStart ?? fraction) + value.translation.height / total
                    fraction = min(max(next, 0.2), 0.85)
                }
                .onEnded { _ in
                    dragStart = nil
                    // Settle onto a preset when the drag ends close to one.
                    if let near = presets.first(where: { abs($0 - fraction) < 0.05 }) {
                        withAnimation(.snappy(duration: 0.3)) { fraction = near }
                    }
                }
        )
        .onTapGesture(count: 2) {
            Haptics.tap()
            withAnimation(.snappy(duration: 0.35)) { fraction = fraction > 0.5 ? 0.35 : 0.8 }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Resize panes")
        .accessibilityHint("Double tap to switch between browser focus and chat focus")
        .accessibilityIdentifier("split.handle")
    }
}
