import SwiftUI

struct ContentView: View {
    @State private var companion = CompanionModel()
    @State private var selection: Int = 0
    @State private var showsSettings: Bool = false

    var body: some View {
        ZStack {
            LindenBackground()
            VStack(spacing: 0) {
                header
                ZStack {
                    if let session = companion.session {
                        PortalWorkspaceView(browser: companion.browser, session: session, portalURL: companion.portalURL.appending(path: "portal/"))
                            .id(ObjectIdentifier(session))
                            .opacity(selection == 1 ? 1 : 0)
                            .allowsHitTesting(selection == 1)
                            .accessibilityHidden(selection != 1)
                    }
                    if selection == 0 {
                        TodayView(isConfigured: companion.session != nil, openPortal: openPortal, startTask: startTask)
                    } else if selection == 1 && companion.session == nil {
                        setupState
                    } else if selection == 2 {
                        activity
                    }
                }
                navigation
            }
        }
        .foregroundStyle(Color.ink)
        .tint(.river)
        .preferredColorScheme(.light)
        .sheet(isPresented: $showsSettings) {
            ConnectionSettingsView(companion: companion)
        }
        .sheet(item: Binding(get: { companion.session?.pendingConfirm }, set: { _ in })) { pending in
            ConfirmSheet(summary: pending.summary, stop: { companion.session?.stop() }) { allowed, reason in
                companion.session?.respondToConfirm(allowed: allowed, reason: reason)
            }
        }
        .onChange(of: selection) { _, selected in
            if selected != 1 { companion.session?.voice.stop() }
        }
        .onChange(of: showsSettings) { _, presented in
            if presented { companion.session?.voice.stop() }
        }
        .onChange(of: companion.session?.pendingConfirm?.id) { _, id in
            if id != nil { selection = 1 }
        }
    }

    private var header: some View {
        HStack {
            HStack(spacing: 5) {
                Image(systemName: "leaf.fill").font(.title3).rotationEffect(.degrees(-25))
                Text("rumi").font(.system(.title2, design: .rounded, weight: .semibold)).tracking(-1)
            }.foregroundStyle(Color.riverDeep)
            Spacer()
            if companion.session?.isRunning == true {
                Button { companion.session?.stop() } label: {
                    Label("Stop", systemImage: "stop.fill").font(.caption.weight(.semibold))
                        .padding(.horizontal, 14).frame(height: 44)
                }.foregroundStyle(Color.alert).lindenGlass().accessibilityIdentifier("agent.stop.global")
            } else {
                Text("YOUR CARE COMPANION").font(.system(size: 9, weight: .semibold)).tracking(1.6).foregroundStyle(Color.inkSoft)
            }
            Button { showsSettings = true } label: {
                Image(systemName: "person.crop.circle").font(.title3).frame(width: 44, height: 44)
            }.lindenGlass().accessibilityLabel("Connection and privacy settings").accessibilityIdentifier("settings.open")
        }.padding(.horizontal, 24).padding(.vertical, 8)
    }

    private var navigation: some View {
        HStack(spacing: 0) {
            tab("Today", symbol: "square.grid.2x2", index: 0)
            tab("Companion", symbol: "sparkles", index: 1)
            tab("Activity", symbol: "clock.arrow.circlepath", index: 2)
        }.padding(6).lindenGlass().padding(.horizontal, 28).padding(.top, 8).padding(.bottom, 8)
    }

    private func tab(_ title: String, symbol: String, index: Int) -> some View {
        Button {
            Haptics.tap()
            selection = index
        } label: {
            VStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 19, weight: .medium))
                Text(title).font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(selection == index ? Color.riverDeep : Color.inkSoft)
            .frame(maxWidth: .infinity).frame(height: 51)
            .background(selection == index ? Color.mint.opacity(0.18) : Color.clear, in: .capsule)
        }.buttonStyle(.plain).accessibilityIdentifier("tab.\(index)")
        .accessibilityAddTraits(selection == index ? .isSelected : [])
    }

    private var setupState: some View {
        VStack(spacing: 22) {
            Image(systemName: "network.badge.shield.half.filled").font(.system(size: 50, weight: .ultraLight)).foregroundStyle(Color.river)
            Text("Your portal,\nwith a helping hand.").font(.system(.largeTitle, design: .serif)).multilineTextAlignment(.center)
            Text("Enter your private access code to sign in to AmalgamRx Hospitals and watch Rumi take care of the little things.")
                .foregroundStyle(Color.inkSoft).multilineTextAlignment(.center)
            Button("Enter private demo") { showsSettings = true }
                .buttonStyle(.borderedProminent).controlSize(.large).accessibilityIdentifier("setup.connect")
            Text("Demo only · Fictional patient records").font(.caption).foregroundStyle(Color.inkSoft)
        }.padding(30).frame(maxWidth: 520).frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var activity: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("A little less to do.").font(.system(.largeTitle, design: .serif))
                Text("Your conversation this session. Nothing is marked complete until the agent reports back.")
                    .font(.subheadline).foregroundStyle(Color.inkSoft)
                if let messages = companion.session?.messages, !messages.isEmpty {
                    ForEach(messages) { message in
                        VStack(alignment: .leading, spacing: 8) {
                            Label(message.role == .patient ? "You" : message.role == .assistant ? "Rumi" : "Connection", systemImage: message.role == .patient ? "person" : "sparkles")
                                .font(.caption.weight(.semibold)).foregroundStyle(Color.river)
                            Text(message.text).font(.subheadline).textSelection(.enabled)
                        }.padding(20).frame(maxWidth: .infinity, alignment: .leading).frostedCard()
                    }
                } else {
                    VStack(spacing: 16) {
                        Image(systemName: "checklist").font(.system(size: 38, weight: .light)).foregroundStyle(Color.river)
                        Text("A fresh start").font(.title3)
                        Text("Your requests and Rumi’s replies will appear here as you use your portal.")
                            .font(.subheadline).foregroundStyle(Color.inkSoft).multilineTextAlignment(.center)
                        Button("Open companion", action: openPortal).buttonStyle(.bordered)
                    }.padding(30).frame(maxWidth: .infinity).frostedCard()
                }
            }.padding(24).frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
    }

    private func openPortal() { selection = 1 }
    private func startTask(_ task: String) {
        selection = 1
        guard let session = companion.session else { showsSettings = true; return }
        guard session.state != .disconnected else { return }
        session.sendUserMessage(task)
    }
}
