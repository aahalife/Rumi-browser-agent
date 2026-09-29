import SwiftUI

struct ConnectionSettingsView: View {
    let companion: CompanionModel
    @Environment(\.dismiss) private var dismiss
    @State private var key: String = ""
    @State private var isConnecting: Bool = false
    @State private var error: String?
    @State private var notice: String?
    @State private var showsRemoveConfirmation: Bool = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Label("Your private Linden demo", systemImage: "leaf").font(.headline)
                    Text("Hosted on Rork for your trusted group. These fictional records are shared with other testers, not connected to a real health system.")
                        .font(.subheadline).foregroundStyle(.secondary)
                }
                Section("Private access") {
                    SecureField("Private access code", text: $key)
                        .textInputAutocapitalization(.never).autocorrectionDisabled()
                        .accessibilityIdentifier("settings.key")
                    Text("Enter the invitation code from your host. It stays in this phone’s Keychain, outside the assistant’s view.")
                        .font(.caption).foregroundStyle(.secondary)
                    if let error { Text(error).foregroundStyle(Color.alert).font(.subheadline).accessibilityIdentifier("settings.error") }
                    Button {
                        isConnecting = true
                        error = nil
                        Task {
                            defer { isConnecting = false }
                            do {
                                try await companion.connect(address: companion.savedAddress, key: key)
                                key = ""
                                dismiss()
                            } catch {
                                self.error = (error as? BridgeError)?.errorDescription ?? "Unable to connect securely. Check your access code and network connection."
                            }
                        }
                    } label: {
                        HStack {
                            Text(isConnecting ? "Checking access…" : "Connect securely")
                            if isConnecting { Spacer(); ProgressView() }
                        }
                    }.disabled(isConnecting || key.isEmpty).accessibilityIdentifier("settings.connect")
                }
                Section("Your sign-in, your control") {
                    Label("Passwords stay in the portal", systemImage: "lock.shield")
                    Label("Device sign-in stays in Keychain", systemImage: "key")
                    Label("Review changes before they happen", systemImage: "hand.raised")
                    Text("Portal text and requested screenshots are sent through Rork AI Cloud to Sonnet 5.5. The hosted assistant does not save transcripts or screenshots. Use fictional information only. After an interruption, review the portal before repeating a change.")
                        .font(.caption).foregroundStyle(.secondary)
                    if DeviceSignIn.shared.hasToken {
                        Button("Forget this phone", role: .destructive) {
                            Task {
                                await DeviceSignIn.shared.forget(backendOrigin: companion.portalURL)
                                notice = DeviceSignIn.shared.storageNotice ?? "Saved sign-in removed. Log out in the portal to end its current session."
                            }
                        }
                    }
                    if companion.session != nil {
                        Button("Remove demo access", role: .destructive) { showsRemoveConfirmation = true }
                            .accessibilityIdentifier("settings.removeAccess")
                    }
                    if let notice { Text(notice).font(.caption) }
                    if let storageNotice = DeviceSignIn.shared.storageNotice { Text(storageNotice).font(.caption).foregroundStyle(Color.alert) }
                }
                Section("Fictional patient sign-in") {
                    Text("Patient: demo\nPassword: demo123").font(.system(.subheadline, design: .monospaced))
                    Text("Enter these in the portal browser, never in the assistant chat.").font(.caption).foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Connection & privacy").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .confirmationDialog("Remove access from this phone?", isPresented: $showsRemoveConfirmation, titleVisibility: .visible) {
                Button("Remove demo access", role: .destructive) {
                    Task { await companion.removeDemoAccess(); dismiss() }
                }
            } message: {
                Text("This stops the assistant, removes saved access and sign-in, and clears this app’s portal data. Shared fictional records are not deleted.")
            }
        }.tint(.river)
    }
}
