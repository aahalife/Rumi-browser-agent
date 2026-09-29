import SwiftUI

struct TodayView: View {
    let isConfigured: Bool
    let openPortal: () -> Void
    let startTask: (String) -> Void

    var body: some View {
        ScrollView(showsIndicators: false) {
            VStack(alignment: .leading, spacing: 25) {
                greeting
                hero
                portalCard
                HStack {
                    Text("Let’s lighten your day").font(.system(.title3, design: .serif))
                    Spacer()
                    Text("WITH LINDEN").font(.system(size: 9, weight: .semibold)).tracking(1.3).foregroundStyle(Color.inkSoft)
                }
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 145), spacing: 12)], spacing: 12) {
                    taskCard("Appointments", subtitle: "Make room for care", symbol: "calendar", color: .mint, task: "When is my next appointment?")
                    taskCard("Medications", subtitle: "One less thing to track", symbol: "pills", color: .blush, task: "Show my medications and which have refills available.")
                    taskCard("Test results", subtitle: "Your records, at hand", symbol: "waveform.path.ecg", color: .sunshine, task: "What was my most recent A1c result? Read it exactly as listed.")
                    taskCard("Care team", subtitle: "Stay in touch", symbol: "bubble.left.and.bubble.right", color: .mint, task: "Who is on my care team?")
                }
                Button { startTask("Help me prepare for my next appointment and check whether eCheck-in is available.") } label: {
                    HStack(spacing: 15) {
                        Image(systemName: "checklist").font(.title2).foregroundStyle(Color.river)
                        VStack(alignment: .leading, spacing: 4) {
                            Text("A calmer next appointment").font(.subheadline.weight(.medium))
                            Text("Let’s get your check-in ready.").font(.caption).foregroundStyle(Color.inkSoft)
                        }
                        Spacer()
                        Image(systemName: "arrow.up.right").font(.subheadline)
                    }.padding(22).frostedCard()
                }.buttonStyle(.plain)
                HStack(spacing: 8) {
                    Image(systemName: "hand.raised").font(.caption)
                    Text("You’re always in control. Linden asks before making changes.").font(.caption)
                }.foregroundStyle(Color.inkSoft).padding(.horizontal, 5)
                Text("DEMO EXPERIENCE · NOT MEDICAL ADVICE").font(.system(size: 9, weight: .medium)).tracking(1.4)
                    .foregroundStyle(Color.inkSoft).frame(maxWidth: .infinity).padding(.vertical, 7)
            }.padding(.horizontal, 24).padding(.top, 20).padding(.bottom, 20)
                .frame(maxWidth: 720).frame(maxWidth: .infinity)
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.abbreviated).day()).uppercased())
                .font(.system(size: 10, weight: .medium)).tracking(1.8).foregroundStyle(Color.inkSoft)
            Text("A little help.\nA healthier day.")
                .font(.system(size: 39, weight: .regular, design: .serif)).tracking(-1.5)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 9) {
                    Label("HERE FOR THE LITTLE THINGS", systemImage: "sparkles")
                        .font(.system(size: 9, weight: .semibold)).tracking(0.9)
                    Text("More living.\nLess life admin.")
                        .font(.system(size: 29, weight: .regular, design: .serif)).tracking(-0.6)
                }
                Spacer(minLength: 2)
                leafOrb
            }
            Text("Appointments, refills, and answers from your portal. We’ll take it one step at a time.")
                .font(.subheadline).foregroundStyle(Color.riverDeep.opacity(0.75)).lineSpacing(3)
            Button(action: openPortal) {
                HStack {
                    Text("What can I help with?").font(.subheadline.weight(.medium))
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.subheadline.weight(.semibold))
                }.padding(.horizontal, 20).padding(.vertical, 16)
                    .foregroundStyle(.white).background(Color.riverDeep, in: .capsule)
            }.buttonStyle(.plain).accessibilityIdentifier("home.companion")
        }
        .padding(23)
        .background {
            RoundedRectangle(cornerRadius: 28).fill(
                LinearGradient(colors: [Color(hex: 0xD6EEE3), Color(hex: 0xEAF0D9), Color(hex: 0xF5E5D7)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        .overlay(RoundedRectangle(cornerRadius: 28).stroke(.white.opacity(0.9), lineWidth: 1))
    }

    private var leafOrb: some View {
        ZStack {
            Circle().fill(.white.opacity(0.45))
                .overlay(Circle().stroke(.white.opacity(0.75), lineWidth: 1))
                .shadow(color: .river.opacity(0.12), radius: 15, y: 10)
            Ellipse().fill(LinearGradient(colors: [.mint, .riverDeep], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 25, height: 48).rotationEffect(.degrees(-32)).offset(x: -9, y: -1)
            Ellipse().fill(LinearGradient(colors: [.white, .mint, .river], startPoint: .topLeading, endPoint: .bottomTrailing))
                .frame(width: 23, height: 43).rotationEffect(.degrees(-32)).offset(x: 11, y: 7)
        }.frame(width: 79, height: 79).accessibilityHidden(true)
    }

    private var portalCard: some View {
        Button(action: openPortal) {
            HStack(spacing: 13) {
                Image(systemName: "cross.case").font(.system(size: 22, weight: .light))
                    .frame(width: 47, height: 47).background(Color.mint.opacity(0.13), in: .rect(cornerRadius: 15))
                VStack(alignment: .leading, spacing: 5) {
                    Text("Your patient portal").font(.subheadline.weight(.semibold))
                    HStack(spacing: 5) {
                        Circle().fill(isConfigured ? Color.mint : Color.amber).frame(width: 5, height: 5)
                        Text(isConfigured ? "CarePortal demo · Open to sign in" : "Connect once. Let us help from there.")
                            .font(.caption).foregroundStyle(Color.inkSoft)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption)
            }.padding(18).frostedCard()
        }.buttonStyle(.plain)
    }

    private func taskCard(_ title: String, subtitle: String, symbol: String, color: Color, task: String) -> some View {
        Button { startTask(task) } label: {
            VStack(alignment: .leading, spacing: 15) {
                HStack {
                    Image(systemName: symbol).font(.system(size: 21, weight: .light))
                        .frame(width: 41, height: 41).background(color.opacity(0.28), in: .circle)
                    Spacer()
                    Image(systemName: "arrow.up.right").font(.system(size: 11)).foregroundStyle(Color.inkSoft)
                }
                VStack(alignment: .leading, spacing: 5) {
                    Text(title).font(.subheadline.weight(.medium))
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(Color.inkSoft)
                }
            }.padding(18).frame(maxWidth: .infinity, alignment: .leading).frostedCard()
        }.buttonStyle(.plain)
    }
}
