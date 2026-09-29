import { Link } from 'react-router-dom'
import type { Appointment } from '../lib/types'
import { fmtTime, parseLocal } from '../lib/format'
import { CheckinLink } from './CheckinLink'

export function DateBlock({ iso }: { iso: string }) {
  const d = parseLocal(iso)
  return (
    <div className="date-block" aria-hidden="true">
      <span className="day">{d.getDate()}</span>
      <span className="mon">
        {d.toLocaleDateString('en-US', { weekday: 'short' })}
        <br />
        {d.toLocaleDateString('en-US', { month: 'short' })}
      </span>
    </div>
  )
}

export function VisitCard({ appt, upcoming, hero }: { appt: Appointment; upcoming: boolean; hero?: boolean }) {
  const canCheckin = upcoming && (appt.checkin_status === 'available' || appt.checkin_status === 'in_progress')
  const when = parseLocal(appt.start).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return (
    <article className={hero ? 'hero visit' : 'card visit'}>
      <DateBlock iso={appt.start} />
      <div className="visit-body">
        <p className="visit-provider">{appt.provider.name}</p>
        <p className="visit-line">{appt.provider.specialty}</p>
        <p className="visit-line strong">
          <span className="sr-date">{when}, </span>
          {fmtTime(appt.start)}
        </p>
        <p className="visit-line">{appt.location.name}</p>
        <p className="visit-type">
          {appt.visit_type}
          {appt.status === 'canceled' && (
            <span className="pill pill-quiet" style={{ marginLeft: 8 }}>
              Canceled
            </span>
          )}
          {upcoming && appt.checkin_status === 'complete' && (
            <span style={{ marginLeft: 8 }}>
              <CheckinLink appt={appt} />
            </span>
          )}
        </p>
      </div>
      {upcoming && (
        <>
          {canCheckin && (
            <div className="visit-actions">
              <CheckinLink appt={appt} />
            </div>
          )}
          <div className="visit-actions">
            <Link className="btn btn-secondary" to={`/visits/${appt.id}`}>
              {hero ? 'View details' : 'Details'}
            </Link>
            <Link className="btn btn-quiet danger" to={`/visits/${appt.id}/cancel`}>
              Cancel
            </Link>
          </div>
        </>
      )}
    </article>
  )
}
