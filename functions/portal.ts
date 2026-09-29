import { PortalAuth, type AuthEnv } from './auth';
import { HTTPError, bodyJSON, integer, json, stringField } from './http';
import { RecordStore } from './store';
import { cancelReasons, reasons, seed } from './seed';
import type { AppointmentRecord, CheckinRecord, CheckinState, ConversationRecord, HealthRecord, Location, MedicationRecord, PanelRecord, PatientRecord, Pharmacy, Provider, SlotRecord } from './models';

const steps = ['personal_info', 'insurance', 'allergies', 'medications', 'questionnaire', 'consent'] as const;
const questions: CheckinState['questions'] = [
  { id: 'reason', label: 'In a few words, what would you like to discuss at this visit?', type: 'text' },
  { id: 'new_symptoms', label: 'Any new symptoms since your last visit?', type: 'yes_no' },
  { id: 'tobacco', label: 'Do you currently use tobacco?', type: 'yes_no' },
  { id: 'falls', label: 'Have you fallen in the past 6 months?', type: 'yes_no' },
];
function withoutOwner<T extends { patient_id: number }>(record: T): Omit<T, 'patient_id'> {
  const { patient_id: _owner, ...publicRecord } = record;
  return publicRecord;
}
/** Portable portal API. No agent/model access to this class or its data store is provided. */
export class PortalService {
  private readonly auth: PortalAuth;
  constructor(private readonly store: RecordStore, env: AuthEnv, private readonly now: () => number = Date.now) {
    this.auth = new PortalAuth(store, env, now);
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await bodyJSON(request);
      const context = await this.auth.context(request);
      // Do not materialize patient records for unauthenticated probes.
      if (context.privateAccess) seed(this.store, new Date(this.now()));
      const authResponse = await this.auth.handle(request, body, context);
      if (authResponse) return authResponse;
      if (!context.privateAccess) throw new HTTPError(403, 'Enter the private demo access code.');
      if (!context.patient) throw new HTTPError(401, 'Not signed in');
      return this.store.transaction(() => this.route(new URL(request.url), request.method, body, context.patient!));
    } catch (error) {
      if (error instanceof HTTPError) return json({ detail: error.message }, error.status);
      console.error('portal_request_failed');
      return json({ detail: 'Unable to complete this request. Review the portal before trying a change again.' }, 500);
    }
  }
  private own<T extends { patient_id: number }>(kind: string, id: number, patient: number): T {
    const row = this.store.get<T>(kind, id);
    if (!row || row.patient_id !== patient) throw new HTTPError(404, 'Record not found');
    return row;
  }
  private checkin(appt: AppointmentRecord): CheckinRecord {
    const saved = this.store.get<CheckinRecord>('checkin', appt.id);
    if (saved?.status === 'complete') return saved;
    const open = appt.status === 'scheduled' && Date.parse(appt.start) >= this.now() && Date.parse(appt.start) <= this.now() + 7 * 86400000;
    return {
      id: appt.id, appointment_id: appt.id, status: open ? saved?.status ?? 'available' : 'not_available',
      steps: saved?.steps ?? { personal_info: false, insurance: false, allergies: false, medications: false, questionnaire: false, consent: false },
      answers: saved?.answers ?? {}, signature: saved?.signature ?? null, questions, copay: '25.00', completed_at: saved?.completed_at ?? null,
    };
  }
  private appointment(appt: AppointmentRecord) {
    const { slot_id: _slot, ...result } = withoutOwner(appt);
    // Stored UTC digits represent the fictional clinic's wall clock, as in the reference portal.
    return { ...result, start: result.start.replace(/Z$/, ''), checkin_status: this.checkin(appt).status };
  }
  private careTeam(patient: PatientRecord) {
    const appts = this.store.all<AppointmentRecord>('appointment').filter(a => a.patient_id === patient.id).sort((a, b) => b.start.localeCompare(a.start));
    const ids = [...new Set([...(patient.pcp ? [patient.pcp.id] : []), ...appts.map(a => a.provider.id)])];
    return ids.map(id => {
      const provider = this.store.get<Provider>('provider', id)!;
      return { ...provider, role: id === patient.pcp?.id ? 'Primary care provider' : provider.specialty, location: appts.find(a => a.provider.id === id)?.location.name ?? 'Riverside Main Campus' };
    });
  }
  private route(url: URL, method: string, body: Record<string, unknown>, patientID: number): Response {
    const path = url.pathname.replace(/^\/portal\/api/, '');
    const patient = this.store.get<PatientRecord>('patient', patientID);
    if (!patient) throw new HTTPError(401, 'Not signed in');
    const parts = path.split('/').filter(Boolean);
    const [resource, rawID, action, step] = parts;
    const read = method === 'GET';
    const post = method === 'POST';
    const owned = <T extends { patient_id: number }>(kind: string): T[] => this.store.all<T>(kind).filter(r => r.patient_id === patientID);
    if (path === '/me' && read) return json({ ...patient, unread_messages: owned<ConversationRecord>('conversation').filter(c => c.unread).length, new_results: owned<PanelRecord>('panel').filter(p => !p.reviewed).length });
    if (path === '/cancel-reasons' && read) return json(cancelReasons);
    if (path === '/care-team' && read) return json(this.careTeam(patient));
    if (path === '/health-summary' && read) {
      const health = this.store.get<HealthRecord>('health', patientID)!;
      return json({ allergies: health.allergies, immunizations: health.immunizations, problems: [...health.problems].sort((a, b) => b.since.localeCompare(a.since)), care_team: this.careTeam(patient) });
    }
    if (resource === 'scheduling' && read && parts.length === 2) {
      const reason = url.searchParams.get('reason');
      if (reason && !reasons.some(r => r.id === reason)) throw new HTTPError(422, 'Unknown visit reason');
      const providers = this.store.all<Provider>('provider').filter(p => !reason || reason === 'follow_up' || p.specialty === 'Family Medicine');
      if (rawID === 'reasons') return json(reasons);
      if (rawID === 'providers') return json(providers);
      if (rawID === 'locations') return json(this.store.all<Location>('location'));
      if (rawID === 'slots') {
        const location = integer(url.searchParams.get('location_id'), 'location');
        const provider = url.searchParams.get('provider_id') ?? 'any';
        if (provider !== 'any') integer(provider, 'provider');
        const single = url.searchParams.get('date');
        const start = single ?? url.searchParams.get('from') ?? new Date(this.now()).toISOString().slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(Date.parse(start)) || new Date(start).toISOString().slice(0, 10) !== start) throw new HTTPError(422, 'Invalid date');
        const days = single ? 1 : integer(url.searchParams.get('days') ?? 14, 'days');
        if (days > 31) throw new HTTPError(422, 'Choose 1 to 31 days');
        const begin = Date.parse(start + 'T00:00:00Z');
        const occupied = new Set(owned<AppointmentRecord>('appointment').filter(a => a.status === 'scheduled').map(a => a.start));
        const slots = this.store.all<SlotRecord>('slot').filter(s => !occupied.has(s.start) && s.status === 'open' && s.location_id === location && Date.parse(s.start) >= begin && Date.parse(s.start) < begin + days * 86400000 && Date.parse(s.start) > this.now() && (provider === 'any' || s.provider.id === Number(provider)) && providers.some(p => p.id === s.provider.id));
        return json(slots.sort((a, b) => a.start.localeCompare(b.start) || a.provider.id - b.provider.id).map(({ status: _status, ...slot }) => ({ ...slot, start: slot.start.replace(/Z$/, '') })));
      }
    }
    if (resource === 'appointments') {
      if (!rawID && read) {
        const status = url.searchParams.get('status') ?? 'upcoming';
        if (!['upcoming', 'past'].includes(status)) throw new HTTPError(422, 'Invalid appointment status');
        const ascending = status === 'upcoming';
        return json(owned<AppointmentRecord>('appointment').filter(a => (a.status === 'scheduled' && Date.parse(a.start) >= this.now()) === ascending).sort((a, b) => ascending ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)).map(a => this.appointment(a)));
      }
      if (!rawID && post) {
        const reason = reasons.find(r => r.id === stringField(body, 'reason', 40));
        if (!reason) throw new HTTPError(422, 'Unknown visit reason');
        const slot = this.store.get<SlotRecord>('slot', integer(body.slot_id));
        if (!slot) throw new HTTPError(404, 'Slot not found');
        if (slot.status !== 'open' || Date.parse(slot.start) <= this.now()) throw new HTTPError(409, 'That time is no longer available. Please choose another time.');
        if (reason.id !== 'follow_up' && slot.provider.specialty !== 'Family Medicine') throw new HTTPError(422, 'This provider does not offer that visit type.');
        const comments = stringField(body, 'comments', 4000, '');
        if (owned<AppointmentRecord>('appointment').some(a => a.start === slot.start && a.status === 'scheduled')) throw new HTTPError(409, 'You already have an appointment at this time.');
        const appt: AppointmentRecord = { id: this.store.next('appointment'), patient_id: patientID, slot_id: slot.id, start: slot.start, provider: slot.provider, location: this.store.get<Location>('location', slot.location_id)!, visit_type: reason.label, comments, notes: '', status: 'scheduled', checkin_status: 'not_available', cancel_reason: null, cancel_comments: null };
        this.store.put('slot', { ...slot, status: 'booked' });
        return json(this.appointment(this.store.put('appointment', appt)), 201);
      }
      if (rawID) {
        const appt = this.own<AppointmentRecord>('appointment', integer(rawID), patientID);
        if (parts.length === 2 && read) return json(this.appointment(appt));
        if (action === 'cancel' && parts.length === 3 && post) {
          const reason = stringField(body, 'reason', 80);
          if (!cancelReasons.includes(reason)) throw new HTTPError(422, 'Unknown cancel reason');
          if (appt.status !== 'scheduled') throw new HTTPError(409, 'This appointment is not scheduled');
          appt.status = 'canceled'; appt.cancel_reason = reason; appt.cancel_comments = stringField(body, 'comments', 4000, '');
          if (appt.slot_id) {
            const slot = this.store.get<SlotRecord>('slot', appt.slot_id);
            if (slot) this.store.put('slot', { ...slot, status: 'open' });
          }
          return json(this.appointment(this.store.put('appointment', appt)));
        }
        if (action === 'checkin') {
          const state = this.checkin(appt);
          if (!step && read) return json(state);
          if (parts.length !== 4 || (method !== 'PUT' && !(post && step === 'complete'))) throw new HTTPError(405, 'Method not allowed');
          if (state.status === 'not_available') throw new HTTPError(409, 'eCheck-in is not open for this visit.');
          if (state.status === 'complete') throw new HTTPError(409, 'eCheck-in is already complete.');
          if (step === 'complete') {
            if (!steps.every(s => state.steps[s])) throw new HTTPError(422, 'Please complete every check-in step first.');
            state.status = 'complete'; state.completed_at = new Date(this.now()).toISOString();
            return json(this.store.put('checkin', state));
          }
          if (!steps.some(s => s === step)) throw new HTTPError(404, 'Unknown step');
          if (step === 'personal_info') {
            for (const field of ['address', 'phone', 'email'] as const) if (body[field] !== undefined && body[field] !== null && body[field] !== '') patient[field] = stringField(body, field, 256);
          } else if (step === 'insurance') {
            if (body.insurance_payer !== undefined && body.insurance_payer !== null && body.insurance_payer !== '') patient.insurance.payer = stringField(body, 'insurance_payer', 256);
            if (body.insurance_member_id !== undefined && body.insurance_member_id !== null && body.insurance_member_id !== '') patient.insurance.member_id = stringField(body, 'insurance_member_id', 128);
          } else if (step === 'questionnaire') {
            if (!body.answers || typeof body.answers !== 'object' || Array.isArray(body.answers)) throw new HTTPError(422, 'Please answer every question.');
            const answers = body.answers as Record<string, unknown>;
            const clean: Record<string, string> = {};
            for (const q of questions) {
              clean[q.id] = stringField(answers, q.id, 1000);
              if (q.type === 'yes_no' && !['yes', 'no'].includes(clean[q.id].toLowerCase())) throw new HTTPError(422, 'Choose yes or no for each question.');
            }
            state.answers = clean;
          } else if (step === 'consent') {
            const signature = stringField(body, 'signature', 256);
            if (body.agreed !== true || signature.toLowerCase() !== `${patient.first_name} ${patient.last_name}`.toLowerCase()) throw new HTTPError(422, 'Agree to the consent and type your full name exactly as shown.');
            state.signature = signature;
          } else if (body.confirmed === false) throw new HTTPError(422, 'Please confirm this step.');
          state.steps[step as typeof steps[number]] = true; state.status = 'in_progress';
          this.store.put('patient', patient);
          return json(this.store.put('checkin', state));
        }
      }
    }
    if (resource === 'messages') {
      if (rawID === 'recipients' && read && parts.length === 2) return json(this.store.all<Provider>('provider').map(p => ({ id: p.id, name: `${p.name}'s office`, specialty: p.specialty })));
      if (!rawID && read) return json(owned<ConversationRecord>('conversation').sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)).map(c => ({ ...withoutOwner(c), messages: null })));
      if ((!rawID && post) || (rawID && action === 'reply' && post && parts.length === 3)) {
        const text = stringField(body, 'body');
        let conv: ConversationRecord;
        if (rawID) conv = this.own<ConversationRecord>('conversation', integer(rawID), patientID);
        else {
          const provider = this.store.get<Provider>('provider', integer(body.recipient_id));
          if (!provider) throw new HTTPError(404, 'Recipient not found');
          conv = { id: this.store.next('conversation'), patient_id: patientID, provider, subject: stringField(body, 'subject', 128), with: `${provider.name}'s office`, last_message_at: '', last_preview: '', unread: false, message_count: 0, messages: [] };
        }
        const sent_at = new Date(this.now()).toISOString();
        const id = Math.max(0, ...this.store.all<ConversationRecord>('conversation').flatMap(c => c.messages.map(m => m.id))) + 1;
        conv.messages.push({ id, sender: 'patient', sender_name: `${patient.first_name} ${patient.last_name}`, body: text, sent_at });
        conv.last_message_at = sent_at; conv.last_preview = text.slice(0, 90); conv.unread = false; conv.message_count = conv.messages.length;
        return json(withoutOwner(this.store.put('conversation', conv)), 201);
      }
      if (rawID && read && parts.length === 2) {
        const conv = this.own<ConversationRecord>('conversation', integer(rawID), patientID);
        conv.unread = false;
        return json(withoutOwner(this.store.put('conversation', conv)));
      }
    }
    if (resource === 'results' && read) {
      if (!rawID) return json(owned<PanelRecord>('panel').sort((a, b) => b.collected_at.localeCompare(a.collected_at) || a.id - b.id).map(p => ({ ...withoutOwner(p), results: null })));
      if (parts.length === 2) {
        const panel = this.own<PanelRecord>('panel', integer(rawID), patientID);
        panel.reviewed = true;
        return json(withoutOwner(this.store.put('panel', panel)));
      }
    }
    if (path === '/pharmacies' && read) return json(this.store.all<Pharmacy>('pharmacy'));
    if (resource === 'medications') {
      if (!rawID && read) return json(owned<MedicationRecord>('medication').sort((a, b) => a.name.localeCompare(b.name)).map(withoutOwner));
      if (rawID) {
        const med = this.own<MedicationRecord>('medication', integer(rawID), patientID);
        if (read && parts.length === 2) return json(withoutOwner(med));
        if (post && action === 'refill' && parts.length === 3) {
          if (med.pending_refill) throw new HTTPError(409, 'A refill request for this medication is already pending.');
          const pharmacy = this.store.get<Pharmacy>('pharmacy', integer(body.pharmacy_id));
          if (!pharmacy) throw new HTTPError(404, 'Pharmacy not found');
          const refill = { id: this.store.next('refill'), pharmacy, status: 'requested', comments: stringField(body, 'comments', 4000, ''), created_at: new Date(this.now()).toISOString() };
          this.store.put('refill', { ...refill, patient_id: patientID, medication_id: med.id });
          med.pending_refill = refill;
          this.store.put('medication', med);
          return json(refill, 201);
        }
      }
    }
    throw new HTTPError(404, 'Not found');
  }
}
