export interface Patient {
  id: number
  username: string
  first_name: string
  last_name: string
  date_of_birth: string
  mrn: string
  address: string
  phone: string
  email: string
  insurance: { payer: string; member_id: string }
  emergency_contact: string
  pcp: { id: number; name: string; specialty: string } | null
  unread_messages: number
  new_results: number
}

export interface Provider {
  id: number
  name: string
  specialty: string
  initials: string
}

export interface Location {
  id: number
  name: string
  address: string
}

export type CheckinStatus = 'not_available' | 'available' | 'in_progress' | 'complete'

export interface Appointment {
  id: number
  start: string
  visit_type: string
  status: 'scheduled' | 'canceled' | 'completed'
  provider: Provider
  location: Location
  comments: string
  notes: string
  cancel_reason: string | null
  cancel_comments: string | null
  checkin_status: CheckinStatus
}

export interface VisitReason {
  id: string
  label: string
}

export interface Slot {
  id: number
  start: string
  provider: Provider
  location_id: number
}

export interface Message {
  id: number
  sender: 'patient' | 'office'
  sender_name: string
  body: string
  sent_at: string
}

export interface Conversation {
  id: number
  subject: string
  with: string
  provider: Provider
  last_message_at: string
  last_preview: string
  unread: boolean
  message_count: number
  messages: Message[] | null
}

export interface Recipient {
  id: number
  name: string
  specialty: string
}

export interface ResultRow {
  name: string
  value: string
  unit: string
  reference_range: string
  flag: 'H' | 'L' | null
}

export interface LabPanel {
  id: number
  name: string
  collected_at: string
  provider: Provider
  notes: string
  reviewed: boolean
  abnormal_count: number
  result_count: number
  results: ResultRow[] | null
}

export interface Pharmacy {
  id: number
  name: string
  address: string
}

export interface RefillRequest {
  id: number
  pharmacy: Pharmacy
  status: string
  comments: string
  created_at: string
}

export interface Medication {
  id: number
  name: string
  instructions: string
  prescriber: Provider
  pharmacy: Pharmacy
  refills_left: number
  last_filled: string
  pending_refill: RefillRequest | null
}

export interface CheckinQuestion {
  id: string
  label: string
  type: 'text' | 'yes_no'
}

export type CheckinStep = 'personal_info' | 'insurance' | 'allergies' | 'medications' | 'questionnaire' | 'consent'

export interface CheckinState {
  appointment_id: number
  status: CheckinStatus
  steps: Record<CheckinStep, boolean>
  answers: Record<string, string>
  signature: string | null
  questions: CheckinQuestion[]
  copay: string
  completed_at: string | null
}

export interface Allergy {
  substance: string
  reaction: string
  severity: string
}

export interface Immunization {
  name: string
  given_on: string
}

export interface Problem {
  name: string
  since: string
}

export interface CareTeamMember {
  id: number
  name: string
  specialty: string
  role: string
  location: string
  initials: string
}

export interface HealthSummary {
  allergies: Allergy[]
  immunizations: Immunization[]
  problems: Problem[]
  care_team: CareTeamMember[]
}
