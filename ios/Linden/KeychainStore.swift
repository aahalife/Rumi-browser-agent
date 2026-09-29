import Foundation
import Security

nonisolated enum KeychainStore {
    static func load(account: String) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ value: String, account: String) throws {
        var query = base(account)
        let data = Data(value.utf8)
        let update = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if update == errSecSuccess { return }
        guard update == errSecItemNotFound else { throw KeychainError.unavailable }
        query[kSecValueData as String] = data
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        guard SecItemAdd(query as CFDictionary, nil) == errSecSuccess else { throw KeychainError.unavailable }
    }

    static func delete(account: String) { SecItemDelete(base(account) as CFDictionary) }

    private static func base(_ account: String) -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword,
         kSecAttrService as String: "linden.portal", kSecAttrAccount as String: account]
    }
}

nonisolated enum KeychainError: LocalizedError {
    case unavailable
    var errorDescription: String? { "Secure storage is unavailable. Please try again on your device." }
}
