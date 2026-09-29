import Foundation
import Security
import WebKit

/// The phone's saved sign-in. The portal page hands us a long-lived device token right after a
/// manual sign-in; we keep it in the Keychain and can open a fresh session with it later.
/// The assistant never sees the token: it only asks us to use it.
@Observable
final class DeviceSignIn: NSObject, WKScriptMessageHandler {
    static let shared = DeviceSignIn()

    private(set) var hasToken = false
    private let service = "com.riversidehealth.careportalagent.device-signin"
    private let account = "careportal"

    override init() {
        super.init()
        hasToken = load() != nil
    }

    // MARK: Keychain

    private var baseQuery: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: service,
         kSecAttrAccount as String: account]
    }

    // The simulator often rejects Keychain writes with errSecMissingEntitlement (-34018).
    // On a device with the keychain entitlement the Keychain is used; otherwise the token
    // is kept in a file inside the app container with complete data protection.
    private var fallbackURL: URL {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appending(path: "device-signin")
    }

    private func load() -> String? {
        var query = baseQuery
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data {
            return String(data: data, encoding: .utf8)
        }
        if let data = try? Data(contentsOf: fallbackURL), !data.isEmpty {
            return String(data: data, encoding: .utf8)
        }
        return nil
    }

    private func save(_ token: String) {
        SecItemDelete(baseQuery as CFDictionary)
        var add = baseQuery
        add[kSecValueData as String] = Data(token.utf8)
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(add as CFDictionary, nil)
        if status == errSecSuccess {
            hasToken = true
            return
        }
        NSLog("[DeviceSignIn] keychain unavailable (%d); using protected file", status)
        do {
            try Data(token.utf8).write(to: fallbackURL, options: [.atomic, .completeFileProtection])
            hasToken = true
        } catch {
            NSLog("[DeviceSignIn] could not store the device sign-in: %@", String(describing: error))
            hasToken = false
        }
    }

    func forgetLocally() {
        SecItemDelete(baseQuery as CFDictionary)
        try? FileManager.default.removeItem(at: fallbackURL)
        hasToken = false
    }

    // MARK: Message from the portal page (the handler only exists inside this app)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              body["type"] as? String == "device_token",
              let token = body["token"] as? String, !token.isEmpty else {
            NSLog("[DeviceSignIn] ignored page message: %@", String(describing: message.body))
            return
        }
        NSLog("[DeviceSignIn] received device token from the portal page")
        save(token)
    }

    // MARK: Sign the patient back in without a password

    func restore(webView: WKWebView, backendOrigin: URL) async throws {
        guard let token = load() else {
            throw BridgeError.refused("No saved sign-in on this phone. Ask the patient to sign in.")
        }
        var request = URLRequest(url: backendOrigin.appending(path: "portal/api/auth/device-login"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["token": token])
        let (data, response) = try await URLSession(configuration: .ephemeral).data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = json["code"] as? String else {
            forgetLocally()
            throw BridgeError.refused("The saved sign-in on this phone is no longer valid. Ask the patient to sign in.")
        }
        // The WebView opens the one-time code itself, so the session cookies are set by a normal
        // navigation and the app never touches the cookie store.
        var components = URLComponents(url: backendOrigin.appending(path: "portal/api/auth/device-login/complete"),
                                       resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "code", value: code), URLQueryItem(name: "next", value: "/portal/home")]
        await MainActor.run { webView.load(URLRequest(url: components.url!)) }
    }

    func forget(backendOrigin: URL) async {
        if let token = load() {
            var request = URLRequest(url: backendOrigin.appending(path: "portal/api/auth/device-login/revoke"))
            request.httpMethod = "POST"
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
            _ = try? await URLSession(configuration: .ephemeral).data(for: request)
        }
        forgetLocally()
    }
}
