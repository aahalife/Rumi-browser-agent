import SwiftUI

struct RumiVoiceView: View {
    let session: AgentSession
    let canStart: Bool
    @State private var showsConsent: Bool = false
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 12) {
                RumiOrbView(phase: session.voice.phase, level: session.voice.level)
                    .frame(width: 52, height: 52)
                VStack(alignment: .leading, spacing: 3) {
                    Text(session.voice.label).font(.subheadline.weight(.semibold))
                    Text(session.voice.isEnabled ? "Mic pauses while Rumi works or speaks" : "Hands-free conversation · ElevenLabs v4")
                        .font(.caption2).foregroundStyle(Color.inkSoft)
                }
                Spacer(minLength: 0)
                Button {
                    if session.voice.isEnabled { session.stop() } else { showsConsent = true }
                } label: {
                    Image(systemName: session.voice.isEnabled ? "stop.fill" : "mic.fill")
                        .font(.body.weight(.semibold))
                        .frame(width: 44, height: 44)
                }
                .lindenGlass()
                .disabled(!session.voice.isEnabled && (!canStart || session.isRunning || session.state == .disconnected))
                .accessibilityLabel(session.voice.isEnabled ? "Stop voice and assistant" : "Start voice conversation")
                .accessibilityIdentifier("voice.toggle")
            }
            if let notice = session.voice.notice {
                Text(notice).font(.caption).foregroundStyle(Color.alert).accessibilityIdentifier("voice.notice")
            }
        }
        .padding(.horizontal, 16).padding(.vertical, 6)
        .confirmationDialog("Talk with Rumi?", isPresented: $showsConsent, titleVisibility: .visible) {
            Button("Enable microphone & voice") { if canStart { session.voice.start(session: session) } }
            Button("Keep typing", role: .cancel) {}
        } message: {
            Text("Short recordings go to ElevenLabs for transcription, then to the same browser assistant. Replies go to ElevenLabs to be spoken aloud. Use fictional information only; never say passwords or access codes. Provider retention policies apply. Changes still require on-screen approval. Listening pauses during replies and while Rumi works; use Stop to interrupt.")
        }
        .onChange(of: canStart) { _, allowed in if !allowed { session.voice.stop() } }
        .onChange(of: scenePhase) { _, phase in if phase != .active { session.voice.stop() } }
        .onDisappear { session.voice.stop() }
    }
}
