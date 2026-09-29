import XCTest

final class LindenUITests: XCTestCase {
    @MainActor
    func testCompanionShowsHonestConnectionState() {
        let app = XCUIApplication()
        app.launchArguments = ["-LindenUITestFresh"]
        app.launch()
        XCTAssertTrue(app.buttons["home.companion"].waitForExistence(timeout: 10))
        app.buttons["home.companion"].tap()
        XCTAssertTrue(app.buttons["setup.connect"].waitForExistence(timeout: 5))
        app.buttons["setup.connect"].tap()
        XCTAssertTrue(app.secureTextFields["settings.key"].waitForExistence(timeout: 5))
        XCTAssertFalse(app.textFields["settings.address"].exists)
        XCTAssertFalse(app.buttons["settings.connect"].isEnabled)
        app.secureTextFields["settings.key"].tap()
        app.secureTextFields["settings.key"].typeText("test-only-invalid-code")
        XCTAssertTrue(app.buttons["settings.connect"].isEnabled)
    }

    @MainActor
    func testActivityStartsEmptyAndCanOpenCompanion() {
        let app = XCUIApplication()
        app.launchArguments = ["-LindenUITestFresh"]
        app.launch()
        XCTAssertTrue(app.buttons["tab.2"].waitForExistence(timeout: 10))
        app.buttons["tab.2"].tap()
        XCTAssertTrue(app.staticTexts["A fresh start"].waitForExistence(timeout: 5))
        app.buttons["Open companion"].tap()
        XCTAssertTrue(app.buttons["setup.connect"].waitForExistence(timeout: 5))
    }
}
