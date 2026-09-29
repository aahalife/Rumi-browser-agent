import SwiftUI

@main
struct CarePortalAgentApp: App {
    @State private var browser: BrowserModel
    @State private var session: AgentSession
    private let portalURL: URL

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let backend = URL(string: (info["BackendURL"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "http://localhost:8000")!
        let demoKey = (info["DemoAPIKey"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "change-me"
        let browser = BrowserModel()
        let bridge = AgentBridge(backendOrigin: backend, browser: browser)
        _browser = State(initialValue: browser)
        _session = State(initialValue: AgentSession(backendURL: backend, demoKey: demoKey, bridge: bridge))
        portalURL = backend.appending(path: "portal/")
    }

    var body: some Scene {
        WindowGroup {
            ContentView(browser: browser, session: session, portalURL: portalURL)
        }
    }
}
