import SwiftUI
import WebKit

@MainActor
@Observable
final class BrowserModel {
    var loadError: String?
    var privateAccessCode: String?
    var title = ""
    var host = ""
    var path = ""
    var canGoBack = false
    var isLoading = false
    var progress: Double = 0
    weak var webView: WKWebView?

    func goBack() { webView?.goBack() }
    /// Reload a page with GET, or retry only the access bootstrap while it is pending.
    func reload() {
        let destination = loadError == nil ? webView?.url : nil
        loadError = nil
        let url = destination.flatMap { PortalOrigin.allows($0, origin: HostedEndpoints.portal) ? $0 : nil }
            ?? HostedEndpoints.portal.appending(path: "portal/home")
        webView?.load(request(for: url))
    }

    func request(for url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let code = privateAccessCode, PortalOrigin.allowsNavigation(url, origin: HostedEndpoints.portal) {
            request.url = HostedEndpoints.portal.appending(path: "~api/demo/native-access")
            request.httpMethod = "POST"
            request.setValue(code, forHTTPHeaderField: "X-Demo-Key")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data("{}".utf8)
        }
        return request
    }

    func acceptResponse(status: Int) -> Bool {
        guard status < 400 else {
            loadError = status >= 500
                ? "The demo hosting service is temporarily unavailable (\(status)). Your access code has not been rejected. Tap Try again shortly."
                : "The portal could not open (\(status)). Try again, or reconnect in Connection & Privacy."
            return false
        }
        return true
    }

    func finishLoading(url: URL?) {
        guard loadError == nil, let url, PortalOrigin.allows(url, origin: HostedEndpoints.portal) else { return }
        privateAccessCode = nil
    }
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
        let request = model.request(for: startURL)
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

    func makeCoordinator() -> Coordinator { Coordinator(model: model, origin: startURL) }

    final class Coordinator: NSObject, WKNavigationDelegate {
        let model: BrowserModel
        private var observers: [NSKeyValueObservation] = []

        let origin: URL
        init(model: BrowserModel, origin: URL) { self.model = model; self.origin = origin }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            guard let url = action.request.url, PortalOrigin.allowsNavigation(url, origin: origin) else {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
            if response.isForMainFrame, let http = response.response as? HTTPURLResponse,
               !model.acceptResponse(status: http.statusCode) {
                decisionHandler(.cancel)
                return
            }
            decisionHandler(.allow)
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            model.finishLoading(url: webView.url)
        }

        func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation!) { model.loadError = nil }
        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { model.loadError = "We couldn’t load your demo portal. Check the server connection and try again." }
        }
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            if (error as NSError).code != NSURLErrorCancelled { model.loadError = "The portal connection was interrupted. Please try again." }
        }

        func observe(_ webView: WKWebView) {
            observers = [
                webView.observe(\.title, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.title ?? ""
                    Task { @MainActor in self?.model.title = value }
                },
                webView.observe(\.url, options: [.initial, .new]) { [weak self] wv, _ in
                    let value = wv.url?.host ?? ""
                    let path = wv.url?.path ?? ""
                    Task { @MainActor in self?.model.host = value; self?.model.path = path }
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
