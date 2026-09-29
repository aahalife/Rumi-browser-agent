import Foundation

// Mirrors backend/agent/protocol.py. Field names match the wire JSON exactly.

struct Size: Codable {
    var width: Int
    var height: Int
}

struct Point: Codable {
    var x: Int
    var y: Int
}

struct Element: Codable {
    var ref: Int
    var role: String
    var name: String
    var tag: String
    var type: String?
    var value: String?
    var checked: Bool?
    var pressed: Bool?
    var selected: Bool?
    var disabled: Bool?
    var inViewport: Bool?
    var options: [String]?
    var href: String?
    var context: String?
}

struct PageObservation: Codable {
    var url: String
    var title: String
    var viewport: Size
    var scroll: Point
    var pageHeight: Int
    var elements: [Element]
    var text: String
    var dialogs: [String]

    static func placeholder(url: String, note: String) -> PageObservation {
        PageObservation(url: url, title: "", viewport: Size(width: 0, height: 0), scroll: Point(x: 0, y: 0),
                    pageHeight: 0, elements: [], text: note, dialogs: [])
    }
}

enum JSONValue: Codable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let b = try? c.decode(Bool.self) { self = .bool(b) }
        else if let i = try? c.decode(Int.self) { self = .int(i) }
        else if let d = try? c.decode(Double.self) { self = .double(d) }
        else if let s = try? c.decode(String.self) { self = .string(s) }
        else if let a = try? c.decode([JSONValue].self) { self = .array(a) }
        else { self = .object(try c.decode([String: JSONValue].self)) }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let s): try c.encode(s)
        case .int(let i): try c.encode(i)
        case .double(let d): try c.encode(d)
        case .bool(let b): try c.encode(b)
        case .null: try c.encodeNil()
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    var intValue: Int? {
        switch self {
        case .int(let i): return i
        case .double(let d): return Int(d)
        case .string(let s): return Int(s)
        default: return nil
        }
    }

    var stringValue: String? {
        switch self {
        case .string(let s): return s
        case .int(let i): return String(i)
        case .double(let d): return String(d)
        case .bool(let b): return String(b)
        default: return nil
        }
    }

    var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    // For callAsyncJavaScript arguments, which must be plist/JSON-compatible objects.
    var anyValue: Any {
        switch self {
        case .string(let s): return s
        case .int(let i): return i
        case .double(let d): return d
        case .bool(let b): return b
        case .null: return NSNull()
        case .array(let a): return a.map(\.anyValue)
        case .object(let o): return o.mapValues(\.anyValue)
        }
    }
}

// MARK: - Client -> server

enum ClientMessage: Encodable {
    case userMessage(text: String)
    case observation(id: String, observation: PageObservation)
    case actionResult(id: String, ok: Bool, error: String?, observation: PageObservation?)
    case screenshot(id: String, jpegBase64: String)
    case confirmResponse(id: String, allowed: Bool, reason: String?)
    case stop

    private enum Key: String, CodingKey {
        case type, text, id, observation, ok, error, jpeg_base64, allowed, reason
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: Key.self)
        switch self {
        case .userMessage(let text):
            try c.encode("user_message", forKey: .type)
            try c.encode(text, forKey: .text)
        case .observation(let id, let observation):
            try c.encode("observation", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(observation, forKey: .observation)
        case .actionResult(let id, let ok, let error, let observation):
            try c.encode("action_result", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(ok, forKey: .ok)
            try c.encodeIfPresent(error, forKey: .error)
            try c.encodeIfPresent(observation, forKey: .observation)
        case .screenshot(let id, let jpegBase64):
            try c.encode("screenshot", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(jpegBase64, forKey: .jpeg_base64)
        case .confirmResponse(let id, let allowed, let reason):
            try c.encode("confirm_response", forKey: .type)
            try c.encode(id, forKey: .id)
            try c.encode(allowed, forKey: .allowed)
            try c.encodeIfPresent(reason, forKey: .reason)
        case .stop:
            try c.encode("stop", forKey: .type)
        }
    }
}

// MARK: - Server -> client

enum ServerMessage: Decodable {
    case requestObservation(id: String)
    case actionRequest(id: String, action: String, args: [String: JSONValue], highlightRef: Int?)
    case requestScreenshot(id: String)
    case confirmRequest(id: String, summary: String)
    case agentMessage(text: String, delta: Bool)
    case status(state: String, step: Int, maxSteps: Int)
    case done(summary: String)
    case error(message: String, fatal: Bool)
    case unknown(type: String)

    private enum Key: String, CodingKey {
        case type, id, action, args, highlight_ref, summary, text, delta, state, step, max_steps, message, fatal
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Key.self)
        let type = try c.decode(String.self, forKey: .type)
        switch type {
        case "request_observation":
            self = .requestObservation(id: try c.decode(String.self, forKey: .id))
        case "action_request":
            self = .actionRequest(
                id: try c.decode(String.self, forKey: .id),
                action: try c.decode(String.self, forKey: .action),
                args: try c.decodeIfPresent([String: JSONValue].self, forKey: .args) ?? [:],
                highlightRef: try c.decodeIfPresent(Int.self, forKey: .highlight_ref)
            )
        case "request_screenshot":
            self = .requestScreenshot(id: try c.decode(String.self, forKey: .id))
        case "confirm_request":
            self = .confirmRequest(id: try c.decode(String.self, forKey: .id),
                                   summary: try c.decode(String.self, forKey: .summary))
        case "agent_message":
            self = .agentMessage(text: try c.decode(String.self, forKey: .text),
                                 delta: try c.decodeIfPresent(Bool.self, forKey: .delta) ?? false)
        case "status":
            self = .status(state: try c.decode(String.self, forKey: .state),
                           step: try c.decodeIfPresent(Int.self, forKey: .step) ?? 0,
                           maxSteps: try c.decodeIfPresent(Int.self, forKey: .max_steps) ?? 0)
        case "done":
            self = .done(summary: try c.decode(String.self, forKey: .summary))
        case "error":
            self = .error(message: try c.decode(String.self, forKey: .message),
                          fatal: try c.decodeIfPresent(Bool.self, forKey: .fatal) ?? false)
        default:
            self = .unknown(type: type)
        }
    }
}
