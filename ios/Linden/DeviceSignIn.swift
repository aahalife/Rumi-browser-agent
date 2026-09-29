import Foundation
import WebKit

/// Origin-scoped device sign-in; neither credentials nor browser cookies reach the agent.
@Observable
final class DeviceSignIn: NSObject, WKScriptMessageHandler {
    static let shared = DeviceSignIn()
    private(set) var hasToken: Bool = false
    private(set) var storageNotice: String?
    private var origin: URL?
    private var account: String { "device:" + (origin?.absoluteString ?? "") }

    func configure(origin: URL) {
        self.origin = origin
        hasToken = KeychainStore.load(account: account) != nil
        storageNotice = nil
    }

    func forgetLocally() {
        KeychainStore.delete(account: account)
        hasToken = false
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        Task { @MainActor in
            guard let origin = self.origin, message.frameInfo.isMainFrame,
                  let pageURL = message.frameInfo.request.url,
                  PortalOrigin.allows(pageURL, origin: origin),
                  let body = message.body as? [String: Any], body["type"] as? String == "device_token",
                  let token = body["token"] as? String, !token.isEmpty else { return }
            do {
                try KeychainStore.save(token, account: self.account)
                self.hasToken = true
                self.storageNotice = nil
            } catch {
                self.storageNotice = "Your portal is signed in, but this phone couldn’t save the sign-in securely. You may need to sign in again."
            }
        }
    }

    func restore(webView: WKWebView, backendOrigin: URL) async throws {
        guard origin == backendOrigin, let token = KeychainStore.load(account: account) else {
            throw BridgeError.refused("No saved sign-in on this phone. Ask the patient to sign in.")
        }
        var request = URLRequest(url: HostedEndpoints.portalAPI(origin: backendOrigin, path: "auth/device-login"))
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["token": token])
        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
        if http.statusCode == 401 || http.statusCode == 403 {
            forgetLocally()
            throw BridgeError.refused("Saved sign-in has expired. Please sign in again in the portal.")
        }
        guard http.statusCode == 200,
              let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = json["code"] as? String,
              var parts = URLComponents(url: HostedEndpoints.portalAPI(origin: backendOrigin, path: "auth/device-login/complete"), resolvingAgainstBaseURL: false) else {
            throw BridgeError.refused("The portal couldn’t restore your sign-in. Please try again.")
        }
        parts.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "next", value: "/portal/home")]
        guard let url = parts.url else { throw URLError(.badURL) }
        webView.load(URLRequest(url: url))
    }

    func forget(backendOrigin: URL) async {
        guard origin == backendOrigin else { return }
        storageNotice = nil
        if let token = KeychainStore.load(account: account) {
            var request = URLRequest(url: HostedEndpoints.portalAPI(origin: backendOrigin, path: "auth/device-login/revoke"))
            request.httpMethod = "POST"
            request.timeoutInterval = 15
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
            do {
                let (_, response) = try await URLSession(configuration: .ephemeral).data(for: request)
                guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
            } catch {
                storageNotice = "Removed from this phone. The server couldn’t confirm revocation; revoke this device in the portal when it is available."
            }
        }
        forgetLocally()
    }
}
