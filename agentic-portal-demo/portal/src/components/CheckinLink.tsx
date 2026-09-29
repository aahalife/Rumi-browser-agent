import { Link } from 'react-router-dom'
import type { Appointment } from '../lib/types'

export function CheckinLink({ appt }: { appt: Appointment }) {
  if (appt.status !== 'scheduled') return null
  if (appt.checkin_status === 'complete') return <span className="pill pill-done">Checked in</span>
  if (appt.checkin_status === 'available') {
    return (
      <Link className="btn btn-primary" to={`/visits/${appt.id}/checkin`}>
        eCheck-in
      </Link>
    )
  }
  if (appt.checkin_status === 'in_progress') {
    return (
      <Link className="btn btn-primary" to={`/visits/${appt.id}/checkin`}>
        Continue eCheck-in
      </Link>
    )
  }
  return null
}
