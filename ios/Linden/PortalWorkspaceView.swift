import SwiftUI

struct PortalWorkspaceView: View {
    let browser: BrowserModel
    let session: AgentSession
    let portalURL: URL

    var body: some View {
        GeometryReader { geometry in
            if geometry.size.width > 700 {
                HStack(spacing: 16) {
                    browserCard.frame(maxWidth: .infinity)
                    ChatView(session: session, browser: browser).frame(maxWidth: .infinity)
                }.padding(16)
            } else {
                SplitContainer {
                    browserCard.padding(.horizontal, 16)
                } bottom: {
                    ChatView(session: session, browser: browser)
                }
            }
        }
        .onAppear { session.start() }
    }

    private var browserCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 8) {
                Button(action: browser.goBack) {
                    Image(systemName: "chevron.left").frame(width: 44, height: 44)
                }.disabled(!browser.canGoBack).accessibilityLabel("Back").accessibilityIdentifier("browser.back")
                VStack(alignment: .leading, spacing: 3) {
                    Label("AmalgamRx Hospitals · Demo", systemImage: "lock.fill").font(.caption.weight(.semibold))
                    Text(portalURL.host ?? "Patient portal").font(.system(size: 10)).foregroundStyle(Color.inkSoft).lineLimit(1)
                }
                Spacer()
                if session.isRunning { ProgressView().tint(.river) }
                Button(action: browser.reload) {
                    Image(systemName: "arrow.clockwise").frame(width: 44, height: 44)
                }.accessibilityLabel("Reload portal").accessibilityIdentifier("browser.reload")
            }.padding(.horizontal, 5).background(.regularMaterial)
            if browser.isLoading { ProgressView(value: browser.progress).tint(.mint) }
            ZStack {
                BrowserView(model: browser, startURL: portalURL)
                if let error = browser.loadError {
                    VStack(spacing: 14) {
                        Image(systemName: "wifi.exclamationmark").font(.largeTitle)
                        Text(error).font(.subheadline).multilineTextAlignment(.center)
                        Button("Try again", action: browser.reload).buttonStyle(.borderedProminent)
                    }.padding(24).frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.mist)
                }
            }
        }
        .clipShape(.rect(cornerRadius: 23))
        .overlay(RoundedRectangle(cornerRadius: 23).stroke(session.isRunning ? Color.amber : .white, lineWidth: session.isRunning ? 2 : 1))
        .accessibilityIdentifier("browser.card")
    }
}
