import Foundation

/// Retries only the read-only private-access check, never portal submissions or agent actions.
enum PrivateAccessConnection {
    static func validate(
        key: String,
        status: (String) async throws -> Int,
        pause: (Int) async throws -> Void = { attempt in
            try await Task.sleep(for: .seconds(attempt + 1))
        }
    ) async throws -> String {
        let code = key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !code.isEmpty else { throw BridgeError.refused("Enter your private demo access code.") }
        for attempt in 0..<3 {
            try Task.checkCancellation()
            let response: Int
            do {
                response = try await status(code)
            } catch let error as URLError {
                if [.timedOut, .networkConnectionLost, .cannotConnectToHost].contains(error.code), attempt < 2 {
                    try await pause(attempt)
                    continue
                }
                throw BridgeError.refused("The demo server couldn’t be reached. Check your internet connection and try again; your access code has not been rejected.")
            }
            if response == 200 { return code }
            if [502, 503, 504].contains(response), attempt < 2 {
                try await pause(attempt)
                continue
            }
            switch response {
            case 401, 403:
                throw BridgeError.refused("That private access code wasn’t accepted. Enter your invitation code here, not the portal password.")
            case 429:
                throw BridgeError.refused("Too many connection attempts. Please wait 10 minutes before trying again.")
            case 500...599:
                throw BridgeError.refused("The demo server is temporarily unavailable. Please try again shortly; this does not mean your access code is wrong.")
            default:
                throw BridgeError.refused("The connection service returned an unexpected response. Please try again shortly.")
            }
        }
        throw BridgeError.refused("The demo server is temporarily unavailable. Please try again shortly.")
    }
}
