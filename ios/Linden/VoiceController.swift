import AVFoundation
import Foundation
import Observation

/// Turn-based hands-free voice. Only AgentSession can submit browser-agent requests.
@MainActor
@Observable
final class VoiceController {
    enum Phase: String { case off, listening, transcribing, working, speaking, approval }
    private(set) var phase: Phase = .off
    private(set) var isEnabled: Bool = false
    private(set) var level: Double = 0
    private(set) var notice: String?
    private weak var session: AgentSession?
    private var task: Task<Void, Never>?
    private var interruptionTask: Task<Void, Never>?
    private var recorder: AVAudioRecorder?
    private var player: AVAudioPlayer?
    private var recordingURL: URL?
    private var generation: UUID = UUID()

    var label: String {
        switch phase {
        case .off: return "Talk with Rumi"
        case .listening: return "Listening…"
        case .transcribing: return "Understanding…"
        case .working: return "Working in your portal…"
        case .speaking: return "Rumi is speaking"
        case .approval: return "Review the change on screen"
        }
    }

    func start(session: AgentSession) {
        stop()
        self.session = session
        notice = nil
        let current = generation
        task = Task {
            let allowed = await AVAudioApplication.requestRecordPermission()
            guard !Task.isCancelled, generation == current else { return }
            guard allowed else { notice = "Microphone access is off. Enable it in Settings or keep typing."; return }
            guard session.state != .disconnected, !session.isRunning else { return }
            isEnabled = true
            interruptionTask = Task {
                for await _ in NotificationCenter.default.notifications(named: AVAudioSession.interruptionNotification) {
                    guard !Task.isCancelled else { return }
                    stop()
                    notice = "Voice paused after an audio interruption. Tap the microphone to resume."
                    return
                }
            }
            listen()
        }
    }

    func stop() {
        generation = UUID()
        task?.cancel(); task = nil
        interruptionTask?.cancel(); interruptionTask = nil
        clearAudio()
        isEnabled = false
        phase = .off
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    func working() {
        guard isEnabled else { return }
        generation = UUID()
        task?.cancel(); task = nil
        clearAudio()
        phase = .working
    }

    func requireApproval() {
        working()
        if isEnabled { phase = .approval }
    }

    func reply(_ text: String) {
        guard isEnabled, let session, !text.isEmpty else { return }
        working()
        let current = generation
        task = Task {
            do {
                let audio = try await session.voiceRequest(path: "voice/speech", body: JSONSerialization.data(withJSONObject: ["text": text]), contentType: "application/json")
                try Task.checkCancellation()
                guard generation == current, isEnabled else { return }
                let audioSession = AVAudioSession.sharedInstance()
                try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try audioSession.setActive(true)
                let playback = try AVAudioPlayer(data: audio)
                playback.isMeteringEnabled = true
                player = playback
                phase = .speaking
                guard playback.play() else { throw URLError(.cannotDecodeContentData) }
                let deadline = Date().addingTimeInterval(180)
                while playback.isPlaying && Date() < deadline {
                    try await Task.sleep(for: .milliseconds(80))
                    playback.updateMeters()
                    level = min(1, max(0, Double(playback.averagePower(forChannel: 0) + 50) / 50))
                }
                try Task.checkCancellation()
                guard generation == current else { return }
                clearAudio()
                listen()
            } catch is CancellationError { return }
            catch { fail(error, generation: current) }
        }
    }

    private func listen() {
        guard isEnabled, let session, !session.isRunning, session.state != .disconnected else { return }
        let current = generation
        task = Task {
            do {
                guard await session.canRecordVoice() else {
                    stop(); notice = "Sign in to your portal before starting voice. Never speak passwords or access codes."; return
                }
                try Task.checkCancellation()
                guard generation == current, isEnabled else { return }
                let audioSession = AVAudioSession.sharedInstance()
                try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetoothHFP])
                try audioSession.setActive(true)
                let url = FileManager.default.temporaryDirectory.appendingPathComponent("rumi-\(UUID().uuidString).m4a")
                recordingURL = url
                let capture = try AVAudioRecorder(url: url, settings: [AVFormatIDKey: Int(kAudioFormatMPEG4AAC), AVSampleRateKey: 22050, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 64000])
                capture.isMeteringEnabled = true
                recorder = capture
                guard capture.record() else { throw URLError(.cannotCreateFile) }
                phase = .listening
                var heardSpeech = false
                var speechFrames = 0
                var lastSpeech = Date()
                let started = Date()
                while Date().timeIntervalSince(started) < 25 {
                    try await Task.sleep(for: .milliseconds(80))
                    capture.updateMeters()
                    let power = capture.averagePower(forChannel: 0)
                    level = min(1, max(0, Double(power + 50) / 50))
                    if power > -35 {
                        speechFrames += 1
                        if speechFrames >= 4 { heardSpeech = true }
                        lastSpeech = Date()
                    }
                    if heardSpeech && Date().timeIntervalSince(lastSpeech) > 1.5 { break }
                    if !heardSpeech && Date().timeIntervalSince(started) > 15 { break }
                }
                capture.stop(); recorder = nil; level = 0
                guard heardSpeech else {
                    stop(); notice = "Voice paused while it was quiet. Tap the microphone when you’re ready."; return
                }
                let data = try Data(contentsOf: url)
                try? FileManager.default.removeItem(at: url); recordingURL = nil
                guard await session.canRecordVoice() else { stop(); return }
                try Task.checkCancellation()
                phase = .transcribing
                let response = try await session.voiceRequest(path: "voice/transcribe", body: data, contentType: "audio/mp4")
                try Task.checkCancellation()
                guard generation == current, isEnabled, !session.isRunning, session.state != .disconnected else { return }
                let result = try JSONDecoder().decode(VoiceTranscript.self, from: response)
                let text = result.text.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { listen(); return }
                if text.lowercased().trimmingCharacters(in: .punctuationCharacters) == "stop" { session.stop(); return }
                phase = .working
                session.sendUserMessage(text)
            } catch is CancellationError { return }
            catch { fail(error, generation: current) }
        }
    }

    private func clearAudio() {
        recorder?.stop(); recorder = nil
        player?.stop(); player = nil
        if let recordingURL { try? FileManager.default.removeItem(at: recordingURL) }
        recordingURL = nil
        level = 0
    }

    private func fail(_ error: Error, generation current: UUID) {
        guard generation == current else { return }
        stop()
        notice = (error as? VoiceRequestError)?.message ?? "Voice couldn’t connect. Please try again or type your request."
    }
}
