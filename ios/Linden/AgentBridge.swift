import Foundation
import UIKit
import WebKit

nonisolated enum BridgeError: LocalizedError {
    case noWebView
    case badResult(String)
    case refused(String)
    case timeout(String)

    var errorDescription: String? {
        switch self {
        case .noWebView: return "the browser is not ready"
        case .badResult(let s): return "unexpected result from page: \(s)"
        case .refused(let s): return s
        case .timeout(let s): return s
        }
    }
}

@MainActor
final class AgentBridge {
    static let script: String = {
        guard let url = Bundle.main.url(forResource: "agent-bridge", withExtension: "js"),
              let source = try? String(contentsOf: url, encoding: .utf8) else {
            assertionFailure("agent-bridge.js is missing from the app bundle; check the project.yml resources")
            return ""
        }
        return source
    }()

    let backendOrigin: URL
    let browser: BrowserModel

    init(backendOrigin: URL, browser: BrowserModel) {
        self.backendOrigin = backendOrigin
        self.browser = browser
    }

    private var webView: WKWebView {
        get throws {
            guard browser.loadError == nil else {
                throw BridgeError.refused("The portal is unavailable. Use Try again and review the page before asking Rumi to continue.")
            }
            guard let wv = browser.webView else { throw BridgeError.noWebView }
            guard let url = wv.url, PortalOrigin.allows(url, origin: backendOrigin) else {
                throw BridgeError.refused("The assistant can only access this demo portal.")
            }
            return wv
        }
    }

    // MARK: JS calls

    /// Calls window.agentBridge.<function> with the arguments in the given order.
    /// The JS side catches errors and returns them as text, because WebKit otherwise
    /// collapses every exception into "A JavaScript exception occurred".
    private func call(_ function: String, _ ordered: [(String, Any)]) async throws -> Any? {
        let wv = try webView
        let params = ordered.map(\.0).joined(separator: ", ")
        let body = """
        try {
          const value = await window.agentBridge.\(function)(\(params));
          return JSON.stringify({ ok: true, value: value === undefined ? null : value });
        } catch (e) {
          return JSON.stringify({ ok: false, error: String((e && e.message) || e) });
        }
        """
        let args = Dictionary(uniqueKeysWithValues: ordered)
        let raw = try await wv.callAsyncJavaScript(body, arguments: args, in: nil, contentWorld: .page)
        guard let json = raw as? String, let data = json.data(using: .utf8),
              let result = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw BridgeError.badResult("\(function) returned \(String(describing: raw).prefix(80))")
        }
        if result["ok"] as? Bool != true {
            throw BridgeError.refused(result["error"] as? String ?? "\(function) failed")
        }
        return result["value"]
    }

    func snapshot() async throws -> PageObservation {
        // Serialize on the JS side: handing WebKit's result object to JSONSerialization
        // can raise an NSException, which Swift cannot catch.
        let wv = try webView
        let raw = try await wv.callAsyncJavaScript(
            "return JSON.stringify(await window.agentBridge.snapshot());", arguments: [:], in: nil, contentWorld: .page
        )
        guard let json = raw as? String, let data = json.data(using: .utf8) else {
            throw BridgeError.badResult("snapshot returned \(String(describing: raw).prefix(80))")
        }
        return try JSONDecoder().decode(PageObservation.self, from: data)
    }

    // The bridge is injected at document end, so right after a navigation
    // window.agentBridge may not exist yet. Retry briefly instead of failing.
    func snapshotWithRetry(attempts: Int = 12) async throws -> PageObservation {
        var lastError: Error = BridgeError.timeout("snapshot never became available")
        for _ in 0..<attempts {
            try Task.checkCancellation()
            do { return try await snapshot() } catch { lastError = error }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw lastError
    }

    func fallbackObservation(note: String) -> PageObservation {
        let url = browser.webView?.url?.path ?? ""
        return .placeholder(url: url, note: note)
    }

    func highlight(ref: Int) async throws {
        _ = try await call("highlight", [("ref", ref), ("ms", 400)])
    }

    func waitForSettle() async throws {
        _ = try await call("waitForSettle", [("opts", ["quietMs": 500, "timeoutMs": 5000])])
    }

    // MARK: Actions

    func cancelPendingActions() {
        browser.webView?.evaluateJavaScript("window.agentBridge?.stop?.()", completionHandler: nil)
    }

    func perform(_ action: String, _ args: [String: JSONValue]) async throws {
        try Task.checkCancellation()
        switch action {
        case "click":
            let expected: Any
            if let value = args["expected_page"] {
                expected = try JSONSerialization.jsonObject(with: JSONEncoder().encode(value))
            } else { expected = NSNull() }
            _ = try await call("click", [("ref", try ref(args)), ("expected", expected)])
        case "type_text":
            guard let text = args["text"]?.stringValue else { throw BridgeError.badResult("type_text needs text") }
            _ = try await call("typeText", [("ref", try ref(args)), ("text", text), ("clear", args["clear"]?.boolValue ?? true)])
        case "select_option":
            guard let option = args["option"]?.stringValue else { throw BridgeError.badResult("select_option needs option") }
            _ = try await call("selectOption", [("ref", try ref(args)), ("option", option)])
        case "scroll":
            var arg: [String: Any] = [:]
            if let r = args["ref"]?.intValue { arg["ref"] = r }
            if let d = args["direction"]?.stringValue { arg["direction"] = d }
            _ = try await call("scroll", [("arg", arg)])
        case "go_back":
            let wv = try webView
            guard wv.canGoBack else { throw BridgeError.refused("nothing to go back to") }
            wv.goBack()
            try await waitForLoad()
        case "navigate":
            try await navigate(path: args["path"]?.stringValue ?? "")
        case "wait":
            let ms = min(max(args["ms"]?.intValue ?? 500, 0), 3000)
            try await Task.sleep(for: .milliseconds(ms))
        case "restore_session":
            try await DeviceSignIn.shared.restore(webView: try webView, backendOrigin: backendOrigin)
            try await waitForLoad()
        default:
            throw BridgeError.refused("unknown action \(action)")
        }
        try await settleWithRetry()
    }

    private func ref(_ args: [String: JSONValue]) throws -> Int {
        guard let r = args["ref"]?.intValue else { throw BridgeError.badResult("missing ref") }
        return r
    }

    private func navigate(path: String) async throws {
        guard !path.contains("://"), !path.hasPrefix("//"),
              path == "/portal" || path.hasPrefix("/portal/"),
              let url = URL(string: path, relativeTo: backendOrigin)?.absoluteURL,
              PortalOrigin.allows(url, origin: backendOrigin) else {
            throw BridgeError.refused("navigate is limited to /portal/ paths on the portal origin")
        }
        try webView.load(URLRequest(url: url))
        try await waitForLoad()
    }

    private func waitForLoad() async throws {
        try await Task.sleep(for: .milliseconds(150))
        for _ in 0..<40 {
            try Task.checkCancellation()
            if try !webView.isLoading { return }
            try await Task.sleep(for: .milliseconds(250))
        }
        throw BridgeError.timeout("page did not finish loading")
    }

    private func settleWithRetry() async throws {
        for _ in 0..<8 {
            try Task.checkCancellation()
            do { try await waitForSettle(); return } catch { try await Task.sleep(for: .milliseconds(250)) }
        }
    }

    // MARK: Screenshot

    func screenshotBase64() async throws -> String {
        let current = try await snapshot()
        guard current.title != "Sign in", !current.elements.contains(where: { $0.type == "password" }) else {
            throw BridgeError.refused("Sign-in screens are never sent to the assistant.")
        }
        let wv = try webView
        let config = WKSnapshotConfiguration()
        config.snapshotWidth = 780
        config.afterScreenUpdates = true
        let image = try await wv.takeSnapshot(configuration: config)
        guard let jpeg = image.jpegData(compressionQuality: 0.6) else {
            throw BridgeError.badResult("could not encode screenshot")
        }
        return jpeg.base64EncodedString()
    }
}
