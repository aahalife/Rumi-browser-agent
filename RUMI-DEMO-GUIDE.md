# Rumi + AmalgamRx Hospitals

## What this demo does

Rumi is an iPhone care-administration companion. It works beside a visible AmalgamRx Hospitals patient portal, reading the same screens and using the same controls as the patient. This is a private, shared fictional-data showcase—not an Epic integration, a live health system, or a service for real patient information.

The portal follows the supplied MyChart-style visual reference: blue hospital header, purple icons, six rounded shortcut tiles, green actions, and appointment/results cards. It uses its own branding and has no Epic affiliation.

### Available portal features

- Schedule, inspect, cancel, and move appointments. Moving is a new booking followed by a separately approved cancellation.
- Read and send messages; reply in existing conversations.
- Read laboratory results with original values, ranges, and provider comments.
- Review medications and request refills at a selected pharmacy.
- Complete eligible eCheck-in: personal information, insurance, allergies, medications, questions, and signed consent.
- Review the care team, allergies, conditions, and immunizations.
- Explore an illustrative billing statement and its breakdown. No real balance or payment processing.
- Use a video-visit preparation checklist. No clinician connection or camera activation; checklist state is temporary.

## How the agent works

1. A typed or transcribed patient request enters the existing Sonnet 5.5 browser-agent session through Rork AI Cloud.
2. Rumi observes the current page: title, readable text, labeled controls, options, and stable references to visible elements. Sign-in fields are redacted.
3. Sonnet chooses one browser action at a time: click, type into a non-credential field, select an option, scroll, go back, navigate within the portal, wait, or request a screenshot.
4. The iPhone performs that action in its real browser and returns a fresh observation. Screenshots are refused on sign-in screens.
5. Rumi can ask a clarifying question, request patient approval, or finish with a factual summary. It must inspect the saved outcome before claiming success.

The agent has **no direct patient API or database tools**. The portal itself uses its normal authenticated API. Browser automation and test-only saved-outcome assertions are deliberately separate.

### Approval and Stop

- Consequential actions—including submitting forms—require the native approval sheet even if the model forgets to mark them consequential.
- The sheet includes the page/form context. Approval expires, is bound to that page, and is checked again immediately before the browser clicks.
- Denial ends that action. Rumi must not find another route to submit it.
- Stop cancels pending work, speech, and recording. It cannot undo a request already received by the portal.
- Interrupted or uncertain submissions are never automatically replayed. Inspect the portal before asking again.
- Hidden instructions inside records are untrusted content. Rumi quotes results but does not interpret them or prescribe treatment.

## Voice mode

Voice is available in the native iPhone companion, not in the standalone web portal.

- Tap the microphone, read the disclosure, and explicitly enable voice and microphone permission.
- Speak a short request. After about 1.5 seconds of silence, Rumi sends the recording to ElevenLabs **Scribe v2**. Recording is limited to 25 seconds per turn and pauses after 15 seconds with no detected speech.
- The transcript goes to the same Sonnet browser agent—not to a second agent with independent authority.
- Final replies and clarification questions are read by **ElevenLabs v4** (`eleven_v4`). The server checks account model availability and never silently substitutes an older model.
- Speech formatting adds `[warm]`, removes presentation markup, and neutralizes incoming square-bracket audio tags without rewriting clinical facts. v4 uses audio tags and punctuation, not SSML. Stability is 0.6 and similarity is 0.75; unsupported v4 speed/style settings are not sent.
- A default warm/calm premade voice is selected from the account's voice catalog. An optional server-only `ELEVENLABS_VOICE_ID` can select a particular voice.
- The pearlescent pink/blue ribbon orb loops while active, changes pace for work/transcription, and responds to microphone or playback levels. Reduce Motion is respected.
- Listening pauses while the agent works, speaks, or awaits approval. It resumes after a spoken reply. This is **turn-based hands-free voice**, not full-duplex speech interruption or an ElevenLabs Conversational Agents deployment.
- During browser work or speech, use the on-screen Stop button; the microphone is not listening for a wake word. Approvals remain on screen, never inferred from ambient speech.
- Voice stops when leaving the companion, opening settings, backgrounding the app, losing the agent connection, or receiving an audio interruption. Re-enable it explicitly afterward.

Temporary audio files are removed after capture/transcription or cancellation. The server does not persist audio or transcripts. ElevenLabs provider retention policies still apply; zero retention is not assumed. Never speak passwords, private access codes, or real health information.

### Credentials and limits

`ELEVENLABS_API_KEY` is configured as a server-only Rork secret. It is never included in the iPhone/web bundle or Sonnet context. Voice requires a valid one-hour agent ticket, checks origin, bounds audio to 1 MB and speech text to 6,000 characters, and enforces 20 voice requests per session/minute and 600 globally/day. Both STT and TTS consume those limits. Provider billing is through the configured ElevenLabs account.

## End-to-end demo walkthrough

### 1. Enter the private showcase

Open Rumi → Connection & privacy → enter your host's private access code → Connect securely. In the portal browser, sign in as `demo` / `demo123` for Priya Sharma, or `demo2` / `demo123` for James Walker. These are fictional patient credentials behind the private gate; never enter the private host code in chat.

### 2. Explore the portal

Open Companion. Verify the hospital header, six shortcuts, upcoming visit, and newest result. Open Billing → View statement to expand the sample breakdown. Open Video Visits and check a preparation step. Return Home; appointment and result data come from the actual fictional patient records.

### 3. Start with a read-only task

Ask: “When is my next appointment?” Watch Rumi inspect the portal. Compare its answer with the visit card. No approval or patient-record changes should occur.

### 4. Try voice

After signing in, tap the microphone and enable voice. Say: “What was my most recent A1c result?” Pause, then watch the orb transition through listening, understanding, working, and speaking. Compare the spoken answer with the visible result. Wait for listening to resume before asking another question.

### 5. Book with explicit approval

Ask: “Book an additional follow-up with Dr. Rao next week, in the afternoon. Keep my existing appointment.” Watch the schedule workflow. Inspect the provider, location, and date/time in the approval sheet. Approve once, then verify the new visit appears in Visits. Shared showcase changes are visible to other testers.

### 6. Demonstrate denial

Ask to cancel a visit. At the approval sheet choose Don't allow. Verify the visit is still scheduled. Rumi should not try another way to cancel it.

### 7. Demonstrate Stop

Begin another request and tap Stop before approving the final submission. Verify the expected portal state. If a submission had already been sent, inspect its outcome rather than repeating it blindly.

### 8. Try the other workflows

- “Request a refill of my lisinopril at Northside Drugs.” Review the medication and pharmacy before approval.
- “Message Dr. Rao's office that I will be ten minutes late.” Inspect the message before sending.
- “Help me check in for my next eligible visit.” Review each step; never let Rumi invent changed personal details or sign consent without approval.
- “Who is my primary care doctor, and when was my last flu shot?” Compare the response with Health Summary.

### 9. Saved sign-in and cleanup

Log out in the portal, then ask Rumi to return to your appointments. If this phone has a valid saved-device credential, Rumi can request restoration without seeing a password. If not, it asks you to sign in manually. Connection & privacy → Forget this phone revokes saved restoration. Remove demo access stops the session, removes local access/sign-in, and clears portal browser data; it does not delete shared fictional records.

## Implementation map

- `ios/Linden`: active SwiftUI app; displayed as Rumi. `AgentSession` owns the browser-agent connection and voice lifecycle. `VoiceController` handles permission, short recordings, metering, REST speech/transcription, playback, and cancellation. Internal target and storage identifiers remain unchanged to preserve compatibility.
- `web-linden-portal`: registered hosted portal, private gate, screenshot-style dashboard, billing/video demos, and theme. It reuses the established patient workflow screens from `agentic-portal-demo/portal`.
- `functions`: hosted Worker, persistent SQLite portal actor, separate auth/usage gate, transient browser-agent actor, and server-only ElevenLabs adapter.
- `agentic-portal-demo/backend/harness`: real browser-driven hosted evaluation and isolated persisted-outcome assertions. Original Python backend/iOS code is a reference, not the active hosted app.

Persistent showcase records are separate from signed, expiring test workspaces. Private access is distinct from patient authentication. Saved-device credentials stay in Keychain; portal cookies stay in the browser. AI transcripts/screenshots remain transient in the agent service, though provider processing policies still apply.

## Verification status

Verified during this update:
- Hosted web static checks/build passed.
- iOS simulator build passed; device/Release build not verified.
- 46 backend tests plus TypeScript passed; the web test command passed its 2 existing tests.
- 13 native logic/setup UI tests passed. These are not connected native acceptance tests.
- Live ElevenLabs v4 speech returned MPEG audio; Scribe v2 correctly transcribed an appointment question; unauthenticated voice returned 401.
- Hosted mobile/wide layout checks, billing expansion, and video checklist passed without browser page errors.
- All fourteen live hosted browser-agent scenarios have passing saved-outcome evidence across this update's runs: next appointment, A1c, booking, cancellation, annual scheduling, moving a visit, messaging, refill, full eCheck-in, care team, injected-note defense, saved-device restoration, signed-out/no-token, and medical-advice safeguards. Annual scheduling and moving a visit passed on separate fresh-workspace runs after pre-task hosting failures; this was not a single uninterrupted clean run.
- A further safety rerun emitted passing denial, Stop, and screenshot assertions before the terminal command's 60-second timeout; the overall safety command is not reported as completed.
- An isolated message, authenticated portal session, and saved-device restoration survived a real backend deployment version change. No showcase records were reset.

Still required before calling the complete migration accepted:
- Monitor intermittent hosting 503s. Hosting logs identified an unavailable old deployment bundle during the earlier setup failures; those tasks later passed in fresh isolated workspaces. Never solve this by automatically replaying an uncertain patient submission.
- Native connected login, saved restoration, approved/denied submissions, Stop, interruption/reconnect, and access removal.
- Native microphone → transcription → browser action → spoken reply, including denied permission, silence/noise, route changes, and interrupted playback on a real device.
- Native compact/wide visual verification.

All demos use fictional information. This guide does not claim production healthcare, PHI, payment, or Epic integration readiness.
