import SwiftUI

// The assistant stops here before anything that matters. Amber marks the moment;
// the words say exactly what will happen.
struct ConfirmSheet: View {
    let summary: String
    let stop: () -> Void
    let respond: (_ allowed: Bool, _ reason: String?) -> Void

    @State private var declining: Bool = false
    @State private var reason: String = ""
    @FocusState private var reasonFocused: Bool

    private var actionLine: String {
        summary.split(separator: "\n", omittingEmptySubsequences: true).first.map(String.init) ?? "Continue"
    }

    private var detailLines: [String] {
        let rest = summary.split(separator: "\n", omittingEmptySubsequences: true).dropFirst()
        return rest
            .flatMap { $0.components(separatedBy: " · ") }
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Capsule()
                .fill(Color.amber)
                .frame(height: 3)
                .padding(.horizontal, 20)
                .padding(.top, 14)

            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Before I continue")
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.ink)
                    Spacer()
                    Button(action: stop) {
                        Label("Stop", systemImage: "stop.fill")
                            .font(.caption.weight(.semibold))
                            .frame(minWidth: 44, minHeight: 44)
                    }
                    .foregroundStyle(Color.alert)
                    .accessibilityIdentifier("confirm.stop")
                }

                Text(actionLine)
                    .font(.headline)
                    .foregroundStyle(Color.ink)

                if !detailLines.isEmpty {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 6) {
                            ForEach(Array(detailLines.enumerated()), id: \.offset) { _, line in
                                Text(line)
                                    .font(.body)
                                    .foregroundStyle(Color.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                        .padding(14)
                    }
                    .frame(maxHeight: 150)
                    .background(Color.mist, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                }

                if declining {
                    TextField("Reason (optional)", text: $reason, axis: .vertical)
                        .lineLimit(1...3)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 11)
                        .background(Color.paper, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.line))
                        .focused($reasonFocused)
                    Button {
                        Haptics.tap()
                        respond(false, reason)
                    } label: {
                        Text("Don't allow")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Color.alert, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .accessibilityIdentifier("confirm.deny.confirm")
                    Button("Back") { withAnimation(.snappy) { declining = false } }
                        .font(.body)
                        .foregroundStyle(Color.riverText)
                        .frame(maxWidth: .infinity)
                } else {
                    Button {
                        Haptics.notice(.success)
                        respond(true, nil)
                    } label: {
                        Text("Allow")
                            .font(.headline)
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 50)
                            .background(Color.river, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .accessibilityIdentifier("confirm.allow")
                    Button {
                        withAnimation(.snappy) { declining = true }
                        reasonFocused = true
                    } label: {
                        Text("Don't allow")
                            .font(.body)
                            .foregroundStyle(Color.riverText)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                    }
                    .accessibilityIdentifier("confirm.deny")
                }
                Spacer(minLength: 0)
            }
            .padding(20)
        }
        .presentationContentInteraction(.scrolls)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(true)
        .onAppear { Haptics.notice(.warning) }
    }
}
