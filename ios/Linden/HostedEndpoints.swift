import Foundation

/// Public hosted locations only. Access codes and saved sign-in are held in Keychain.
nonisolated enum HostedEndpoints {
    static let portal = URL(string: "https://3pxarh5thg13j2zk4f873-web-linden-portal.rork.live")!
    static var backend: URL {
        let configured = Config.EXPO_PUBLIC_RORK_FUNCTIONS_URL
        return CompanionModel.validatedURL(configured) ?? URL(string: "https://care-pilot-backend.rork.app")!
    }
    static func portalAPI(origin: URL, path: String) -> URL {
        origin.appending(path: origin.host == portal.host ? "~api/portal/api/\(path)" : "portal/api/\(path)")
    }
}
