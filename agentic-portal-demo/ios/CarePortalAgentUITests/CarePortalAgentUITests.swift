import XCTest

final class CarePortalAgentUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    // MARK: - Helpers

    private func launch(resetWebData: Bool = false) -> XCUIApplication {
        let app = XCUIApplication()
        if resetWebData { app.launchArguments += ["-ResetWebData"] }
        app.launch()
        return app
    }

    private func browserTitle(_ app: XCUIApplication) -> XCUIElement {
        app.descendants(matching: .any)["browser.title"].firstMatch
    }

    private func waitForTitle(_ app: XCUIApplication, contains needle: String, timeout: TimeInterval = 15,
                              file: StaticString = #filePath, line: UInt = #line) {
        let element = browserTitle(app)
        let predicate = NSPredicate(format: "label CONTAINS[c] %@", needle)
        let ok = XCTWaiter().wait(for: [expectation(for: predicate, evaluatedWith: element)], timeout: timeout)
        XCTAssertEqual(ok, .completed, "title bar never contained \"\(needle)\"; label is \"\(element.label)\"", file: file, line: line)
    }

    private func waitForStatus(_ app: XCUIApplication, equals text: String, timeout: TimeInterval = 20,
                               file: StaticString = #filePath, line: UInt = #line) {
        let status = app.staticTexts["chat.status"]
        let predicate = NSPredicate(format: "label == %@", text)
        let ok = XCTWaiter().wait(for: [expectation(for: predicate, evaluatedWith: status)], timeout: timeout)
        XCTAssertEqual(ok, .completed, "status never became \"\(text)\"; it is \"\(status.label)\"", file: file, line: line)
    }

    private func typeIntoWebField(_ field: XCUIElement, _ text: String) {
        XCTAssertTrue(field.waitForExistence(timeout: 15), "web field not found")
        field.tap()
        // WKWebView fields sometimes need a second tap before they take keyboard focus.
        if !field.hasKeyboardFocusOrKeyboardVisible(in: XCUIApplication()) { field.tap() }
        field.typeText(text)
    }

    private func loginInWebView(_ app: XCUIApplication) {
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15), "web view not found")
        waitForTitle(app, contains: "Sign in")
        typeIntoWebField(web.textFields["Username"], "demo")
        typeIntoWebField(web.secureTextFields["Password"], "demo123")
        web.buttons["Sign in"].tap()
        waitForTitle(app, contains: "Home", timeout: 10)
    }

    /// Signs in only when the app starts on the login page.
    private func ensureLoggedIn(_ app: XCUIApplication) {
        let title = browserTitle(app)
        let loaded = NSPredicate(format: "label CONTAINS[c] 'Sign in' OR label CONTAINS[c] 'Home'")
        _ = XCTWaiter().wait(for: [expectation(for: loaded, evaluatedWith: title)], timeout: 15)
        if title.label.localizedCaseInsensitiveContains("Sign in") {
            loginInWebView(app)
        } else {
            waitForTitle(app, contains: "Home")
        }
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    // MARK: - Tests

    func testLoginInWebViewAndPersistence() {
        var app = launch(resetWebData: true)
        loginInWebView(app)
        XCTAssertTrue(app.webViews.staticTexts["Welcome, Priya"].waitForExistence(timeout: 10))
        attachScreenshot(app, name: "home-after-login")

        app.terminate()
        app = launch()
        waitForTitle(app, contains: "Home", timeout: 10)
        XCTAssertTrue(app.webViews.staticTexts["Welcome, Priya"].waitForExistence(timeout: 10),
                      "login did not persist across relaunch")
    }

    func testChatRoundTrip() {
        let app = launch()
        ensureLoggedIn(app)
        waitForStatus(app, equals: "Ready")

        // A TextField with axis: .vertical is exposed as a text view, so match any element type.
        typeIntoChat(app, "When is my next appointment?")
        app.buttons["chat.send"].tap()

        XCTAssertTrue(app.staticTexts["When is my next appointment?"].waitForExistence(timeout: 5), "patient bubble missing")
        // With a model key the answer names Dr. Rao; without one an error bubble appears.
        let reply = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] 'Rao' OR label CONTAINS[c] 'authentication' OR label CONTAINS[c] 'Error'")
        ).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 60), "no assistant reply")
        waitForStatus(app, equals: "Ready", timeout: 30)
    }

    /// Taps the chat field until it has keyboard focus, then types.
    private func typeIntoChat(_ app: XCUIApplication, _ text: String) {
        let input = app.descendants(matching: .any)["chat.input"].firstMatch
        XCTAssertTrue(input.waitForExistence(timeout: 5), "chat input not found")
        for _ in 0..<3 {
            input.tap()
            if input.hasKeyboardFocusOrKeyboardVisible(in: app) { break }
            usleep(400_000)
        }
        input.typeText(text)
    }

    /// Sends a task; skips the test when the backend has no model key.
    private func sendTaskOrSkip(_ app: XCUIApplication, _ text: String) throws {
        typeIntoChat(app, text)
        app.buttons["chat.send"].tap()
        let noKey = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'authentication'")).firstMatch
        if noKey.waitForExistence(timeout: 6) { throw XCTSkip("backend has no model key") }
    }

    func testLiveBookingWithConfirmation() throws {
        // Start from a known account: the simulator may be signed in as demo2 from manual testing.
        let app = launch(resetWebData: true)
        loginInWebView(app)
        waitForStatus(app, equals: "Ready")
        try sendTaskOrSkip(app, "Book a follow-up with Dr. Rao next week, afternoon if possible.")

        let allow = app.buttons["confirm.allow"]
        let status = app.staticTexts["chat.status"]
        var replies = 0
        let deadline = Date().addingTimeInterval(150)
        while !allow.exists && Date() < deadline {
            if status.label == "Waiting for you" && replies < 2 && !allow.waitForExistence(timeout: 3) {
                // The agent asked something (e.g. about an existing visit the same day). Say yes.
                replies += 1
                typeIntoChat(app, "Yes, go ahead with that.")
                app.buttons["chat.send"].tap()
                sleep(3)
            }
            usleep(500_000)
        }
        XCTAssertTrue(allow.exists, "confirmation sheet never appeared")
        attachScreenshot(app, name: "confirm-sheet")
        allow.tap()

        waitForStatus(app, equals: "Ready", timeout: 90)
        let done = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] 'booked' OR label CONTAINS[c] 'scheduled' OR label CONTAINS[c] 'Oct'")
        ).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "no booking summary in chat")
        attachScreenshot(app, name: "booking-done")
    }

    func testLiveCancelWithConfirmation() throws {
        // Start from a known account: the simulator may be signed in as demo2 from manual testing.
        let app = launch(resetWebData: true)
        loginInWebView(app)
        waitForStatus(app, equals: "Ready")
        try sendTaskOrSkip(app, "Cancel my cardiology appointment, I have a scheduling conflict.")

        let allow = app.buttons["confirm.allow"]
        let status = app.staticTexts["chat.status"]
        var taps = 0
        var replies = 0
        let deadline = Date().addingTimeInterval(150)
        // The agent may ask to confirm the card's Cancel link and then the final Cancel appointment button.
        while taps < 2 && Date() < deadline {
            if allow.exists {
                attachScreenshot(app, name: "cancel-confirm-\(taps + 1)")
                allow.tap()
                taps += 1
                sleep(2)
            } else if status.label == "Ready" && taps > 0 {
                break
            } else if status.label == "Waiting for you" && replies < 2 && !allow.waitForExistence(timeout: 3) {
                // Never say "yes" to a cancel question blindly; send it back to the Visits list.
                replies += 1
                typeIntoChat(app, "Please open Visits, Upcoming tab, and look again for the cardiology visit with Dr. Goldberg.")
                app.buttons["chat.send"].tap()
                sleep(3)
            }
            usleep(500_000)
        }
        XCTAssertGreaterThan(taps, 0, "confirmation sheet never appeared")
        waitForStatus(app, equals: "Ready", timeout: 90)
        let done = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'cancel'")).firstMatch
        XCTAssertTrue(done.waitForExistence(timeout: 5), "no cancel summary in chat")
        attachScreenshot(app, name: "cancel-done")
    }

    /// Manual sign-in stores a device sign-in; after the web session is cleared the assistant
    /// signs the patient back in without a password and answers.
    func testDeviceSignInRestoresSession() throws {
        var app = launch(resetWebData: true)
        loginInWebView(app)
        app.terminate()

        app = XCUIApplication()
        app.launchArguments += ["-ResetWebData"]   // signed out, but the Keychain still has the device sign-in
        app.launch()
        waitForTitle(app, contains: "Sign in")
        XCTAssertTrue(app.buttons["device.forget"].waitForExistence(timeout: 10), "welcome card should offer Forget this phone")
        waitForStatus(app, equals: "Ready")

        try sendTaskOrSkip(app, "When is my next appointment?")
        let reply = app.staticTexts.matching(NSPredicate(format: "label CONTAINS[c] 'Rao'")).firstMatch
        XCTAssertTrue(reply.waitForExistence(timeout: 90), "assistant did not answer after restoring the session")
        waitForTitle(app, contains: "Home", timeout: 5)
        attachScreenshot(app, name: "device-signin-restored")
    }

    func testStopButtonHaltsTask() throws {
        let app = launch()
        ensureLoggedIn(app)
        waitForStatus(app, equals: "Ready")
        try sendTaskOrSkip(app, "Book an annual physical with anyone at Northside, earliest available.")

        let stop = app.buttons["chat.stop"]
        XCTAssertTrue(stop.waitForExistence(timeout: 10), "stop button should replace send while a task runs")
        sleep(6)  // let the agent take a few steps first
        let tapped = Date()
        stop.tap()
        XCTAssertTrue(app.staticTexts["Stopped."].waitForExistence(timeout: 3), "no Stopped bubble within 3 s")
        XCTAssertLessThan(Date().timeIntervalSince(tapped), 3)
        waitForStatus(app, equals: "Ready", timeout: 5)
        attachScreenshot(app, name: "stopped")
    }

    func testSplitHandleDoubleTapTogglesFocus() {
        let app = launch()
        let card = app.otherElements["browser.card"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        let handle = app.otherElements["split.handle"].firstMatch
        XCTAssertTrue(handle.waitForExistence(timeout: 5))

        let h1 = card.frame.height
        handle.doubleTap()
        sleep(1)
        let h2 = card.frame.height
        XCTAssertGreaterThan(abs(h2 - h1), 60, "double tap did not change the browser pane (\(h1) -> \(h2))")

        handle.doubleTap()
        sleep(1)
        let h3 = card.frame.height
        XCTAssertGreaterThan(abs(h3 - h2), 60, "second double tap did not change the browser pane (\(h2) -> \(h3))")
    }

    func testBrowserBackAndReload() {
        let app = launch()
        ensureLoggedIn(app)
        let web = app.webViews.firstMatch
        let visits = web.links["Visits"].firstMatch
        XCTAssertTrue(visits.waitForExistence(timeout: 10))
        visits.tap()
        waitForTitle(app, contains: "Visits")

        let back = app.buttons["browser.back"]
        XCTAssertTrue(back.waitForExistence(timeout: 5))
        XCTAssertTrue(back.isEnabled, "back button should be enabled after in-app navigation")
        back.tap()
        waitForTitle(app, contains: "Home")

        app.buttons["browser.reload"].tap()
        sleep(1)
        waitForTitle(app, contains: "Home")
        XCTAssertTrue(app.webViews.staticTexts["Welcome, Priya"].waitForExistence(timeout: 10))
    }
}

private extension XCUIElement {
    func hasKeyboardFocusOrKeyboardVisible(in app: XCUIApplication) -> Bool {
        (value(forKey: "hasKeyboardFocus") as? Bool ?? false) || app.keyboards.count > 0
    }
}
