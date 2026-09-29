import SwiftUI

struct ChatView: View {
    @Bindable var session: AgentSession
    let browser: BrowserModel

    @State private var draft: String = ""
    @FocusState private var focused: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let suggestions = [
        "When is my next appointment?",
        "Check me in for Monday",
        "Refill my lisinopril",
        "What was my last A1c?",
        "Message Dr. Rao's office",
    ]

    private var signedOut: Bool {
        browser.title.localizedCaseInsensitiveContains("Sign in")
    }

    private var showsWelcome: Bool {
        session.messages.isEmpty && (signedOut || browser.title.isEmpty)
    }

    private var draftIsEmpty: Bool {
        draft.trimmingCharacters(in: .whitespaces).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            StatusChip(session: session)
                .padding(.horizontal, 16)
                .padding(.top, 2)
                .padding(.bottom, 6)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 14) {
                        if showsWelcome { welcomeCard }
                        ForEach(session.messages) { message in
                            row(message).id(message.id)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 6)
                }
                .onChange(of: session.messages.count) {
                    if let last = session.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                }
                .onChange(of: session.messages.last?.text) {
                    if let last = session.messages.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }

            if session.state == .idle && !signedOut && !browser.title.isEmpty {
                suggestionChips
                    .transition(.opacity)
            }

            composer
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 10)
        }
        .background(Color.clear)
        .animation(.easeOut(duration: 0.25), value: session.state)
    }

    // MARK: Pieces

    private var welcomeCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Let’s connect your care")
                .font(.headline)
                .foregroundStyle(Color.ink)
            Text("The assistant can book and cancel visits, message your care team, check you in, and request refills.")
                .font(.subheadline)
                .foregroundStyle(Color.ink)
            Text("It never sees your password, and it asks you before every booking, message, or cancellation.")
                .font(.subheadline)
                .foregroundStyle(Color.inkSoft)
            if DeviceSignIn.shared.hasToken {
                Text("This phone remembers your sign-in, so the assistant can sign you back in without your password.")
                    .font(.subheadline)
                    .foregroundStyle(Color.ink)
                    .padding(.top, 4)
                Button("Forget this phone") {
                    Task { await DeviceSignIn.shared.forget(backendOrigin: session.bridge.backendOrigin) }
                }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.river)
                .accessibilityIdentifier("device.forget")
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.shallows, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var suggestionChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(Self.suggestions, id: \.self) { text in
                    Button {
                        session.sendUserMessage(text)
                    } label: {
                        Text(text)
                            .font(.subheadline)
                            .foregroundStyle(Color.riverText)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(Color.shallows, in: Capsule())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .contentMargins(.horizontal, 16)
        .padding(.top, 4)
    }

    private var composer: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Ask Linden anything about your portal", text: $draft, axis: .vertical)
                .lineLimit(1...4)
                .font(.body)
                .foregroundStyle(Color.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(Color.paper, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Color.line, lineWidth: 1))
                .focused($focused)
                .submitLabel(.send)
                .onSubmit(sendDraft)
                .accessibilityIdentifier("chat.input")

            ZStack {
                if session.isRunning {
                    Button(action: session.stop) {
                        Image(systemName: "stop.fill")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.alert, in: Circle())
                    }
                    .accessibilityLabel("Stop")
                    .accessibilityIdentifier("chat.stop")
                    .transition(.scale.combined(with: .opacity))
                } else {
                    Button(action: sendDraft) {
                        Image(systemName: "arrow.up")
                            .font(.body.weight(.bold))
                            .foregroundStyle(.white)
                            .frame(width: 44, height: 44)
                            .background(Color.river, in: Circle())
                    }
                    .disabled(draftIsEmpty || session.state == .disconnected)
                    .opacity(draftIsEmpty || session.state == .disconnected ? 0.45 : 1)
                    .accessibilityLabel("Send")
                    .accessibilityIdentifier("chat.send")
                    .transition(.scale.combined(with: .opacity))
                }
            }
            .animation(reduceMotion ? nil : .snappy(duration: 0.25), value: session.isRunning)
        }
    }

    private func sendDraft() {
        guard session.state != .disconnected, !draftIsEmpty else { return }
        let text = draft
        draft = ""
        session.sendUserMessage(text)
    }

    @ViewBuilder
    private func row(_ message: AgentSession.ChatMessage) -> some View {
        switch message.role {
        case .patient:
            HStack {
                Spacer(minLength: 48)
                Text(message.text)
                    .font(.body)
                    .foregroundStyle(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 10)
                    .background(Color.river, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
        case .assistant:
            if message.text == "Stopped." {
                Text("Stopped.")
                    .font(.subheadline.italic())
                    .foregroundStyle(Color.inkSoft)
                    .padding(.leading, 15)
            } else {
                AssistantRow(text: message.text, streaming: message.streaming)
            }
        case .system:
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.circle")
                    .foregroundStyle(Color.alert)
                Text(message.text)
                    .font(.footnote)
                    .foregroundStyle(Color.alert)
            }
            .padding(.leading, 2)
        }
    }
}

// Assistant text is plain ink with the amber thread on the left: it reads as the
// assistant speaking in the patient's space, not as a second chat participant.
private struct AssistantRow: View {
    let text: String
    let streaming: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            RoundedRectangle(cornerRadius: 1.5)
                .fill(Color.amber)
                .frame(width: 3)
                .frame(maxHeight: .infinity)
            if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && streaming {
                TypingDots()
                    .padding(.vertical, 6)
            } else {
                Text(text)
                    .font(.body)
                    .foregroundStyle(Color.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.trailing, 24)
    }
}

private struct TypingDots: View {
    @State private var phase: Int = 0
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3) { i in
                Circle()
                    .fill(Color.inkSoft)
                    .frame(width: 6, height: 6)
                    .opacity(reduceMotion || phase == i ? 1 : 0.35)
            }
        }
        .accessibilityLabel("Assistant is thinking")
        .task {
            guard !reduceMotion else { return }
            while !Task.isCancelled {
                try? await Task.sleep(for: .milliseconds(350))
                withAnimation(.easeInOut(duration: 0.3)) { phase = (phase + 1) % 3 }
            }
        }
    }
}

private struct StatusChip: View {
    let session: AgentSession
    @State private var pulse: Bool = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(session.state == .disconnected ? Color.alert : (session.state == .idle ? Color.line : Color.amber))
                .frame(width: 8, height: 8)
                .opacity(session.isRunning && pulse && !reduceMotion ? 0.3 : 1)
                .accessibilityHidden(true)
            Text(statusText)
                .font(.footnote)
                .foregroundStyle(session.state == .disconnected ? Color.alert : Color.inkSoft)
                .accessibilityIdentifier("chat.status")
            Spacer()
        }
        .onChange(of: session.isRunning, initial: true) { _, running in
            if running && !reduceMotion {
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) { pulse = true }
            } else {
                withAnimation(.default) { pulse = false }
            }
        }
    }

    private var statusText: String {
        switch session.state {
        case .disconnected: return "Reconnecting to the assistant"
        case .idle: return "Linden is ready to help"
        case .thinking: return "Linden is thinking"
        case .acting: return "Assistant is acting (step \(session.step) of \(session.maxSteps))"
        case .waitingForUser: return "Waiting for you"
        }
    }
}
