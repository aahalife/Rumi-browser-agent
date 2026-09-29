import Foundation
import Testing
@testable import Linden

@MainActor
struct LindenTests {
    @Test func requiresHTTPSOriginWithoutCredentials() {
        #expect(CompanionModel.validatedURL("https://demo.example") != nil)
        #expect(CompanionModel.validatedURL("http://demo.example") == nil)
        #expect(CompanionModel.validatedURL("https://user:secret@demo.example") == nil)
        #expect(CompanionModel.validatedURL("https://demo.example/portal") == nil)
        #expect(CompanionModel.validatedURL("https://demo.example?token=secret") == nil)
    }

    @Test func portalOriginPreventsCrossSiteAndPathEscape() throws {
        let origin = try #require(URL(string: "https://demo.example"))
        #expect(PortalOrigin.allows(try #require(URL(string: "https://demo.example/portal/home")), origin: origin))
        #expect(!PortalOrigin.allows(try #require(URL(string: "https://other.example/portal/home")), origin: origin))
        #expect(!PortalOrigin.allows(try #require(URL(string: "https://demo.example/portal/../agent")), origin: origin))
        #expect(!PortalOrigin.allows(try #require(URL(string: "http://demo.example/portal/home")), origin: origin))
    }

    @Test func decodesBrowserActionAndHighlight() throws {
        let data = Data(#"{"type":"action_request","id":"r1","action":"click","args":{"ref":7},"highlight_ref":7}"#.utf8)
        let message = try JSONDecoder().decode(ServerMessage.self, from: data)
        guard case .actionRequest(let id, let action, let args, let highlight) = message else {
            Issue.record("Expected browser action"); return
        }
        #expect(id == "r1")
        #expect(action == "click")
        #expect(args["ref"]?.intValue == 7)
        #expect(highlight == 7)
    }

    @Test func encodesApprovalWithoutPortalSecrets() throws {
        let data = try JSONEncoder().encode(ClientMessage.confirmResponse(id: "approval1", allowed: false, reason: "Wrong visit"))
        let json = try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
        #expect(json["type"] as? String == "confirm_response")
        #expect(json["allowed"] as? Bool == false)
        #expect(json["reason"] as? String == "Wrong visit")
        #expect(json["token"] == nil)
    }

    @Test func disconnectedSessionDoesNotPretendToSend() throws {
        let url = try #require(URL(string: "https://demo.example"))
        let session = AgentSession(backendURL: url, demoKey: "test-only", bridge: AgentBridge(backendOrigin: url, browser: BrowserModel()))
        session.sendUserMessage("Show my appointments")
        #expect(session.messages.isEmpty)
        #expect(session.state == .disconnected)
    }

    @Test func secureStoragePersistsAndRemovesDeviceSignIn() throws {
        let account = "test-device:" + UUID().uuidString
        defer { KeychainStore.delete(account: account) }
        try KeychainStore.save("fictional-device-token", account: account)
        #expect(KeychainStore.load(account: account) == "fictional-device-token")
        try KeychainStore.save("rotated-fictional-token", account: account)
        #expect(KeychainStore.load(account: account) == "rotated-fictional-token")
        KeychainStore.delete(account: account)
        #expect(KeychainStore.load(account: account) == nil)
    }

    @Test func hostedAuthNavigationDoesNotGrantAgentAccess() throws {
        let origin = HostedEndpoints.portal
        let complete = HostedEndpoints.portalAPI(origin: origin, path: "auth/device-login/complete")
        #expect(PortalOrigin.allowsNavigation(complete, origin: origin))
        #expect(!PortalOrigin.allows(complete, origin: origin))
        let access = origin.appending(path: "~api/demo/native-access")
        #expect(PortalOrigin.allowsNavigation(access, origin: origin))
        #expect(!PortalOrigin.allows(access, origin: origin))
        #expect(!PortalOrigin.allowsNavigation(origin.appending(path: "~api/portal/api/me"), origin: origin))
    }

    @Test func approvalKeepsGlobalStopAvailable() throws {
        let url = HostedEndpoints.backend
        let session = AgentSession(backendURL: url, demoKey: "test-only", bridge: AgentBridge(backendOrigin: HostedEndpoints.portal, browser: BrowserModel()))
        session.state = .waitingForUser
        session.pendingConfirm = .init(id: "test", summary: "Review booking")
        #expect(session.isRunning)
        session.pendingConfirm = nil
        #expect(!session.isRunning)
    }

    @Test func voiceStartsOffAndCannotActWithoutExplicitEnable() {
        let voice = VoiceController()
        voice.working()
        voice.requireApproval()
        voice.reply("No automatic playback")
        #expect(!voice.isEnabled)
        #expect(voice.phase == .off)
        #expect(voice.level == 0)
        voice.stop()
        #expect(voice.phase == .off)
    }

    @Test func disconnectedVoiceRequestFailsWithoutNetwork() async throws {
        let url = HostedEndpoints.backend
        let session = AgentSession(backendURL: url, demoKey: "test-only", bridge: AgentBridge(backendOrigin: HostedEndpoints.portal, browser: BrowserModel()))
        do {
            _ = try await session.voiceRequest(path: "voice/speech", body: Data(), contentType: "application/json")
            Issue.record("Voice must reject a disconnected session")
        } catch let error as VoiceRequestError {
            #expect(error.message == "Reconnect to use voice.")
        }
    }

    @Test func bridgeResourceIsBundled() { #expect(AgentBridge.script.contains("snapshot")) }
}
