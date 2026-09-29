import Foundation
import Observation

@MainActor
@Observable
final class AgentSession {
    enum State: String {
        case disconnected, idle, thinking, acting, waitingForUser

        init(wire: String) {
            switch wire {
            case "thinking": self = .thinking
            case "acting": self = .acting
            case "waiting_for_user": self = .waitingForUser
            default: self = .idle
            }
        }
    }

    struct ChatMessage: Identifiable {
        enum Role { case patient, assistant, system }
        let id = UUID()
        var role: Role
        var text: String
        var streaming = false
    }

    struct PendingConfirm: Identifiable {
        let id: String
        let summary: String
    }

    var messages: [ChatMessage] = []
    var state: State = .disconnected
    var step = 0
    var maxSteps = 30
    var pendingConfirm: PendingConfirm?
    var connectionNote: String?

    var isRunning: Bool { state == .thinking || state == .acting }

    let bridge: AgentBridge
    let backendURL: URL
    private let demoKey: String
    private var sessionID: String?
    private var socket: URLSessionWebSocketTask?
    private var connectTask: Task<Void, Never>?
    private var actionTask: Task<Void, Never>?
    private var backoff: TimeInterval = 1
    private var handshakeDone = false
    // Separate from the WebView: this session never carries portal cookies.
    private let urlSession = URLSession(configuration: .ephemeral)

    init(backendURL: URL, demoKey: String, bridge: AgentBridge) {
        self.backendURL = backendURL
        self.demoKey = demoKey
        self.bridge = bridge
    }

    // MARK: Connection

    func start() {
        guard connectTask == nil else { return }
        connectTask = Task { await connectLoop() }
    }

    private func connectLoop() async {
        while !Task.isCancelled {
            do {
                if sessionID == nil {
                    sessionID = try await createSession()
                }
                try await runSocket(sessionID: sessionID!)
            } catch {
                if (socket?.closeCode.rawValue ?? 0) == 4004 || !handshakeDone {
                    // The backend restarted and forgot this session (4004), or the handshake
                    // itself failed; either way get a new session next time.
                    sessionID = nil
                }
                connectionNote = "Reconnecting to the assistant… (\(error.localizedDescription))"
            }
            state = .disconnected
            socket = nil
            try? await Task.sleep(for: .seconds(backoff))
            backoff = min(backoff * 2, 15)
        }
    }

    private func createSession() async throws -> String {
        var request = URLRequest(url: backendURL.appending(path: "agent/sessions"))
        request.httpMethod = "POST"
        request.setValue(demoKey, forHTTPHeaderField: "X-Demo-Key")
        let (data, response) = try await urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        struct Created: Decodable { let session_id: String }
        return try JSONDecoder().decode(Created.self, from: data).session_id
    }

    private func runSocket(sessionID: String) async throws {
        var components = URLComponents(url: backendURL.appending(path: "agent/ws"), resolvingAgainstBaseURL: false)!
        components.scheme = components.scheme == "https" ? "wss" : "ws"
        components.queryItems = [URLQueryItem(name: "session_id", value: sessionID)]
        let task = urlSession.webSocketTask(with: components.url!)
        socket = task
        handshakeDone = false
        task.resume()
        try await ping(task)
        handshakeDone = true
        backoff = 1
        connectionNote = nil
        if state == .disconnected { state = .idle }
        sendAutoTaskIfRequested()
        while !Task.isCancelled {
            let message = try await task.receive()
            switch message {
            case .string(let text): handle(text)
            case .data(let data): handle(String(decoding: data, as: UTF8.self))
            @unknown default: break
            }
        }
    }

    private func ping(_ task: URLSessionWebSocketTask) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            task.sendPing { error in
                if let error { cont.resume(throwing: error) } else { cont.resume() }
            }
        }
    }

    private func send(_ message: ClientMessage) async {
        guard let socket else { return }
        do {
            let data = try JSONEncoder().encode(message)
            try await socket.send(.string(String(decoding: data, as: UTF8.self)))
        } catch {
            connectionNote = "Send failed: \(error.localizedDescription)"
        }
    }

    // MARK: Patient actions

    func sendUserMessage(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        finishStreamingBubble()
        messages.append(ChatMessage(role: .patient, text: trimmed))
        if !isRunning { state = .thinking }
        Task { await send(.userMessage(text: trimmed)) }
    }

    func stop() {
        actionTask?.cancel()
        actionTask = nil
        Task { await send(.stop) }
    }

    func respondToConfirm(allowed: Bool, reason: String?) {
        guard let pending = pendingConfirm else { return }
        pendingConfirm = nil
        let trimmed = reason?.trimmingCharacters(in: .whitespacesAndNewlines)
        Task { await send(.confirmResponse(id: pending.id, allowed: allowed, reason: trimmed?.isEmpty == false ? trimmed : nil)) }
    }

    // MARK: Server messages

    private func handle(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(ServerMessage.self, from: data) else {
            return
        }
        switch message {
        case .requestObservation(let id):
            runAction {
                let obs: PageObservation
                do { obs = try await self.bridge.snapshotWithRetry() } catch {
                    obs = self.bridge.fallbackObservation(note: "The page is still loading: \(error.localizedDescription)")
                }
                await self.send(.observation(id: id, observation: obs))
            }
        case .actionRequest(let id, let action, let args, _):
            runAction {
                var ok = true
                var errorText: String?
                do {
                    try await self.bridge.perform(action, args)
                } catch is CancellationError {
                    return
                } catch {
                    ok = false
                    errorText = error.localizedDescription
                }
                if Task.isCancelled { return }
                let obs = (try? await self.bridge.snapshotWithRetry())
                    ?? self.bridge.fallbackObservation(note: "The page is still loading.")
                await self.send(.actionResult(id: id, ok: ok, error: errorText, observation: obs))
            }
        case .requestScreenshot(let id):
            runAction {
                let b64 = (try? await self.bridge.screenshotBase64()) ?? ""
                await self.send(.screenshot(id: id, jpegBase64: b64))
            }
        case .confirmRequest(let id, let summary):
            pendingConfirm = PendingConfirm(id: id, summary: summary)
            state = .waitingForUser
        case .agentMessage(let text, let delta):
            if delta {
                if let last = messages.indices.last, messages[last].role == .assistant, messages[last].streaming {
                    messages[last].text += text
                } else {
                    messages.append(ChatMessage(role: .assistant, text: text, streaming: true))
                }
            } else {
                finishStreamingBubble()
                messages.append(ChatMessage(role: .assistant, text: text))
            }
        case .status(let wire, let newStep, let newMax):
            state = State(wire: wire)
            step = newStep
            maxSteps = newMax
            if !isRunning { finishStreamingBubble() }
        case .done(let summary):
            finishStreamingBubble()
            messages.append(ChatMessage(role: .assistant, text: summary))
            state = .idle
        case .error(let text, let fatal):
            finishStreamingBubble()
            messages.append(ChatMessage(role: .system, text: "Error: \(text)"))
            if fatal { state = .idle }
        case .unknown:
            break
        }
    }

    // Debug hook for simulator smoke tests: `simctl launch ... -AutoTask "text"` sends one
    // message once connected, since simctl cannot tap the UI.
    private var autoTaskSent = false
    private func sendAutoTaskIfRequested() {
        #if DEBUG
        guard !autoTaskSent, let text = UserDefaults.standard.string(forKey: "AutoTask") else { return }
        autoTaskSent = true
        Task {
            try? await Task.sleep(for: .seconds(3))
            sendUserMessage(text)
        }
        #endif
    }

    private func runAction(_ body: @escaping @MainActor () async -> Void) {
        actionTask?.cancel()
        actionTask = Task { await body() }
    }

    private func finishStreamingBubble() {
        if let last = messages.indices.last, messages[last].streaming {
            messages[last].streaming = false
            if messages[last].text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                messages.remove(at: last)
            }
        }
    }
}
