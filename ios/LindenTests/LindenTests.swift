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

    @Test func privateAccessRetriesTemporaryFailureAndTrimsPaste() async throws {
        var attempts = 0
        let code = try await PrivateAccessConnection.validate(key: "  test-invitation\n", status: { code in
            #expect(code == "test-invitation")
            attempts += 1
            return attempts < 3 ? 503 : 200
        }, pause: { _ in })
        #expect(code == "test-invitation")
        #expect(attempts == 3)
    }

    @Test func privateAccessDoesNotRetryRejectedCodesOrRateLimits() async {
        for status in [403, 429] {
            var attempts = 0
            do {
                _ = try await PrivateAccessConnection.validate(key: "test-invitation", status: { _ in
                    attempts += 1
                    return status
                }, pause: { _ in Issue.record("Must not retry rejected access") })
                Issue.record("Must reject access")
            } catch let error as BridgeError {
                #expect(error.errorDescription?.contains(status == 403 ? "wasn’t accepted" : "Too many") == true)
            } catch { Issue.record("Unexpected error type") }
            #expect(attempts == 1)
        }
    }

    @Test func privateAccessStopsAfterThreeServerFailures() async {
        var attempts = 0
        do {
            _ = try await PrivateAccessConnection.validate(key: "test-invitation", status: { _ in
                attempts += 1
                return 503
            }, pause: { _ in })
            Issue.record("Must report server unavailable")
        } catch let error as BridgeError {
            #expect(error.errorDescription?.contains("temporarily unavailable") == true)
        } catch { Issue.record("Unexpected error type") }
        #expect(attempts == 3)
    }

    @Test func privateAccessRejectsEmptyInputWithoutRequest() async {
        do {
            _ = try await PrivateAccessConnection.validate(key: " \n", status: { _ in
                Issue.record("Empty codes must not reach the server")
                return 200
            })
            Issue.record("Must reject empty input")
        } catch let error as BridgeError {
            #expect(error.errorDescription == "Enter your private demo access code.")
        } catch { Issue.record("Unexpected error type") }
    }

    @Test func privateAccessRetriesNetworkInterruption() async throws {
        var attempts = 0
        _ = try await PrivateAccessConnection.validate(key: "test-invitation", status: { _ in
            attempts += 1
            if attempts == 1 { throw URLError(.networkConnectionLost) }
            return 200
        }, pause: { _ in })
        #expect(attempts == 2)
    }

    @Test func portal503KeepsBootstrapAvailableUntilSuccessfulPageLoad() {
        let browser = BrowserModel()
        browser.privateAccessCode = "test-invitation"
        let home = HostedEndpoints.portal.appending(path: "portal/home")
        let first = browser.request(for: home)
        #expect(first.httpMethod == "POST")
        #expect(first.url?.path == "/~api/demo/native-access")
        #expect(browser.privateAccessCode == "test-invitation")
        #expect(!browser.acceptResponse(status: 503))
        #expect(browser.loadError?.contains("has not been rejected") == true)
        browser.finishLoading(url: home)
        #expect(browser.privateAccessCode == "test-invitation")
        let retry = browser.request(for: home)
        #expect(retry.value(forHTTPHeaderField: "X-Demo-Key") == "test-invitation")
        browser.loadError = nil
        #expect(browser.acceptResponse(status: 200))
        browser.finishLoading(url: home)
        #expect(browser.privateAccessCode == nil)
        let reload = browser.request(for: home)
        #expect(reload.httpMethod == "GET")
        #expect(reload.httpBody == nil)
        #expect(reload.value(forHTTPHeaderField: "X-Demo-Key") == nil)
    }

    @Test func portalAccessCodeNeverSentToOtherOrigins() throws {
        let browser = BrowserModel()
        browser.privateAccessCode = "test-invitation"
        let url = try #require(URL(string: "https://other.example/portal/home"))
        let request = browser.request(for: url)
        #expect(request.httpMethod == "GET")
        #expect(request.value(forHTTPHeaderField: "X-Demo-Key") == nil)
        browser.finishLoading(url: url)
        #expect(browser.privateAccessCode == "test-invitation")
    }

    @Test func assistantCannotObservePortalWhileHostingErrorIsVisible() async {
        let browser = BrowserModel()
        _ = browser.acceptResponse(status: 503)
        let bridge = AgentBridge(backendOrigin: HostedEndpoints.portal, browser: browser)
        do {
            _ = try await bridge.snapshot()
            Issue.record("An unavailable portal must not reach the assistant")
        } catch let error as BridgeError {
            #expect(error.errorDescription?.contains("portal is unavailable") == true)
        } catch { Issue.record("Unexpected error type") }
    }

    @Test func bridgeResourceIsBundled() { #expect(AgentBridge.script.contains("snapshot")) }
}
