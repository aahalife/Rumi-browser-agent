import Foundation

nonisolated enum PortalOrigin {
    static func allows(_ url: URL, origin: URL) -> Bool {
        let normalized = url.standardized
        return normalized.scheme == origin.scheme && normalized.host == origin.host
            && normalized.port == origin.port && normalized.user == nil && normalized.password == nil
            && (normalized.path == "/portal" || normalized.path.hasPrefix("/portal/"))
            && !normalized.path.hasPrefix("/portal/api")
    }

    static func allowsNavigation(_ url: URL, origin: URL) -> Bool {
        if allows(url, origin: origin) { return true }
        let normalized = url.standardized
        let prefix = origin.host == HostedEndpoints.portal.host ? "/~api" : ""
        let allowed = [prefix + "/portal/api/auth/device-login/complete", "/~api/demo/native-access"]
        return normalized.scheme == origin.scheme && normalized.host == origin.host
            && normalized.port == origin.port && normalized.user == nil && normalized.password == nil
            && allowed.contains(normalized.path)
    }
}
