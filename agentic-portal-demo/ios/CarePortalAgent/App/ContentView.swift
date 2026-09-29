import SwiftUI

struct ContentView: View {
    let browser: BrowserModel
    let session: AgentSession
    let portalURL: URL

    var body: some View {
        SplitContainer {
            BrowserCard(browser: browser, isAgentActive: session.isRunning, startURL: portalURL)
                .padding(.horizontal, 12)
                .padding(.top, 8)
        } bottom: {
            ChatView(session: session, browser: browser)
        }
        .background(Color.mist.ignoresSafeArea())
        .sheet(item: Binding(get: { session.pendingConfirm }, set: { _ in })) { pending in
            ConfirmSheet(summary: pending.summary) { allowed, reason in
                session.respondToConfirm(allowed: allowed, reason: reason)
            }
        }
        .onAppear { session.start() }
    }
}

// The patient's portal in a real window. While the assistant works, the frame
// carries the one piece of motion in the app: a slow amber flow around the edge.
struct BrowserCard: View {
    let browser: BrowserModel
    let isAgentActive: Bool
    let startURL: URL

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var flowAngle: Double = 0

    private let shape = RoundedRectangle(cornerRadius: 20, style: .continuous)

    var body: some View {
        VStack(spacing: 0) {
            titleBar
            loadingBar
            BrowserView(model: browser, startURL: startURL)
        }
        .background(Color.paper)
        .clipShape(shape)
        .overlay(frame)
        .shadow(color: Color(light: 0x0E5E6F, dark: 0x000000).opacity(0.10), radius: 10, y: 6)
        .shadow(color: Color.amber.opacity(isAgentActive ? 0.30 : 0), radius: 16)
        .animation(.easeOut(duration: 0.6), value: isAgentActive)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("browser.card")
    }

    @ViewBuilder
    private var frame: some View {
        if isAgentActive {
            if reduceMotion {
                shape.stroke(Color.amber, lineWidth: 3)
            } else {
                Rectangle()
                    .fill(AngularGradient(
                        colors: [.amber, .amber.opacity(0.15), .amber, .amber.opacity(0.15), .amber],
                        center: .center
                    ))
                    .scaleEffect(2.2)
                    .rotationEffect(.degrees(flowAngle))
                    .mask(shape.stroke(lineWidth: 3))
                    .onAppear {
                        flowAngle = 0
                        withAnimation(.linear(duration: 6).repeatForever(autoreverses: false)) { flowAngle = 360 }
                    }
            }
        } else {
            shape.stroke(Color.line, lineWidth: 1)
        }
    }

    private var titleBar: some View {
        HStack(spacing: 10) {
            Button(action: browser.goBack) {
                Image(systemName: "chevron.left")
                    .font(.body.weight(.semibold))
                    .frame(width: 32, height: 32)
            }
            .disabled(!browser.canGoBack)
            .foregroundStyle(browser.canGoBack ? Color.riverText : Color.inkSoft.opacity(0.35))
            .accessibilityLabel("Back")
            .accessibilityIdentifier("browser.back")

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.caption2)
                    .foregroundStyle(Color.inkSoft)
                    .accessibilityHidden(true)
                Text(browser.host.isEmpty ? "localhost" : browser.host)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.ink)
                if !browser.title.isEmpty {
                    Text(browser.title)
                        .font(.subheadline)
                        .foregroundStyle(Color.inkSoft)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("browser.title")

            Spacer(minLength: 0)

            Button(action: browser.reload) {
                Image(systemName: "arrow.clockwise")
                    .font(.body.weight(.semibold))
                    .frame(width: 32, height: 32)
            }
            .foregroundStyle(Color.riverText)
            .accessibilityLabel("Reload")
            .accessibilityIdentifier("browser.reload")
        }
        .padding(.horizontal, 8)
        .frame(height: 44)
        .background(Color.paper)
    }

    private var loadingBar: some View {
        ZStack(alignment: .leading) {
            Color.line
            GeometryReader { geo in
                Color.river
                    .frame(width: geo.size.width * max(browser.progress, browser.isLoading ? 0.08 : 0))
                    .animation(.easeOut(duration: 0.25), value: browser.progress)
            }
            .opacity(browser.isLoading ? 1 : 0)
            .animation(.easeOut(duration: 0.3), value: browser.isLoading)
        }
        .frame(height: 2)
        .accessibilityHidden(true)
    }
}
