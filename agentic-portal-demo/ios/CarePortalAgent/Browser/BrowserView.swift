import SwiftUI
import WebKit

@MainActor
@Observable
final class BrowserModel {
    var title = ""
    var host = ""
    var canGoBack = false
    var isLoading = false
    var progress: Double = 0
    weak var webView: WKWebView?

    func goBack() { webView?.goBack() }
    func reload() { webView?.reload() }
}

struct BrowserView: UIViewRepresentable {
    let model: BrowserModel
    let startURL: URL

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Hard rule 2: portal cookies never leave the WebView. The app never reads
        // HTTPCookieStorage or WKHTTPCookieStore; the default data store just keeps
        // the login across launches.
        config.websiteDataStore = .default()
        // Identifies this app to the portal (device labels) and receives the device sign-in
        // token the portal page hands over after a manual sign-in.
        config.applicationNameForUserAgent = "CarePortalAssistant/1.0"
        config.userContentController.add(DeviceSignIn.shared, name: "careportal")
        config.userContentController.addUserScript(
            WKUserScript(source: AgentBridge.script, injectionTime: .atDocumentEnd, forMainFrameOnly: true)
        )
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.allowsBackForwardNavigationGestures = true
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        model.webView = webView
        context.coordinator.observe(webView)
        let request = URLRequest(url: startURL)
        #if DEBUG
        // UI tests pass -ForgetDevice to drop the saved device sign-in, -ResetWebData to start signed out.
        if CommandLine.arguments.contains("-ForgetDevice") { DeviceSignIn.shared.forgetLocally() }
        if CommandLine.arguments.contains("-ResetWebData") {
            let types = WKWebsiteDataStore.allWebsiteDataTypes()
            config.websiteDataStore.removeData(ofTypes: types, modifiedSince: .distantPast) {
                webView.load(request)
            }
            return webView
        }
        #endif
        webView.load(request)
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(model: model) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: BrowserModel
        private var observers: [NSKeyValueObservation] = []

        init(model: BrowserModel) { self.model = model }

        func observe(_ webView: WKWebView) {
            observers = [
                webView.observe(\.title, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.title ?? ""
                    Task { @MainActor in self?.model.title = value }
                },
                webView.observe(\.url, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.url?.host ?? ""
                    Task { @MainActor in self?.model.host = value }
                },
                webView.observe(\.canGoBack, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.canGoBack
                    Task { @MainActor in self?.model.canGoBack = value }
                },
                webView.observe(\.isLoading, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.isLoading
                    Task { @MainActor in self?.model.isLoading = value }
                },
                webView.observe(\.estimatedProgress, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.estimatedProgress
                    Task { @MainActor in self?.model.progress = value }
                },
            ]
        }
    }
}
