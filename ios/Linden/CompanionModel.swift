import Foundation
import Observation
import WebKit

@Observable
final class CompanionModel {
    var browser: BrowserModel = BrowserModel()
    var session: AgentSession?
    var backendURL: URL?
    var portalURL: URL = HostedEndpoints.portal
    var savedAddress: String { HostedEndpoints.backend.absoluteString }

    init() {
        #if DEBUG
        if CommandLine.arguments.contains("-LindenUITestFresh") { return }
        #endif
        let address = savedAddress
        if let url = Self.validatedURL(address), let key = KeychainStore.load(account: "demo-key:" + url.absoluteString) {
            configure(url: url, key: key)
        }
    }

    nonisolated static func validatedURL(_ address: String) -> URL? {
        guard let parts = URLComponents(string: address.trimmingCharacters(in: .whitespacesAndNewlines)),
              parts.scheme == "https", let host = parts.host, !host.isEmpty,
              parts.user == nil, parts.password == nil, parts.query == nil, parts.fragment == nil,
              parts.path.isEmpty || parts.path == "/" else { return nil }
        return parts.url
    }

    func connect(address: String, key: String) async throws {
        guard let url = Self.validatedURL(address), !key.isEmpty else {
            throw BridgeError.refused("Enter your private demo access code.")
        }
        var request = URLRequest(url: url.appending(path: "demo/status"))
        request.httpMethod = "GET"
        request.timeoutInterval = 15
        request.setValue(key, forHTTPHeaderField: "X-Demo-Key")
        let (_, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw BridgeError.refused("Couldn’t connect. Check your private access code and network, then try again.")
        }
        try KeychainStore.save(key, account: "demo-key:" + url.absoluteString)
        UserDefaults.standard.set(url.absoluteString, forKey: "linden.backend")
        configure(url: url, key: key)
    }

    func removeDemoAccess() async {
        session?.disconnect()
        await DeviceSignIn.shared.forget(backendOrigin: portalURL)
        if let backendURL { KeychainStore.delete(account: "demo-key:" + backendURL.absoluteString) }
        session = nil
        backendURL = nil
        browser = BrowserModel()
        UserDefaults.standard.removeObject(forKey: "linden.backend")
        await WKWebsiteDataStore.default().removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
    }

    private func configure(url: URL, key: String) {
        session?.disconnect()
        browser = BrowserModel()
        browser.privateAccessCode = key
        backendURL = url
        portalURL = HostedEndpoints.portal
        DeviceSignIn.shared.configure(origin: portalURL)
        let bridge = AgentBridge(backendOrigin: portalURL, browser: browser)
        session = AgentSession(backendURL: url, demoKey: key, bridge: bridge)
    }
}
