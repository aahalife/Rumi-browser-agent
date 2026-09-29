import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { CheckinLink } from '../components/CheckinLink'
import { apiFetch } from '../lib/api'
import { fmtLongDate, fmtTime } from '../lib/format'
import type { Appointment } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function VisitDetailPage() {
  useTitle('Visit details')
  const { id } = useParams()
  const [appt, setAppt] = useState<Appointment | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Appointment>(`/appointments/${id}`)
      .then(setAppt)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this visit'))
  }, [id])

  const upcoming = appt?.status === 'scheduled' && new Date(appt.start) >= new Date()

  return (
    <Layout title="Visit details">
      {error && <ErrorBox message={error} />}
      {!error && !appt && <Skeleton rows={2} label="Loading visit" />}
      {appt && (
        <>
          <div className="card">
            <h2 className="visit-provider">{appt.visit_type}</h2>
            {upcoming && appt.checkin_status === 'complete' && <CheckinLink appt={appt} />}
            <dl className="details">
              <dt>Provider</dt>
              <dd>
                {appt.provider.name}, {appt.provider.specialty}
              </dd>
              <dt>Date</dt>
              <dd>{fmtLongDate(appt.start)}</dd>
              <dt>Time</dt>
              <dd>{fmtTime(appt.start)}</dd>
              <dt>Location</dt>
              <dd>
                {appt.location.name}
                <br />
                <span className="muted">{appt.location.address}</span>
              </dd>
              <dt>Status</dt>
              <dd>{appt.status === 'scheduled' ? 'Scheduled' : appt.status === 'canceled' ? 'Canceled' : 'Completed'}</dd>
              {appt.comments && (
                <>
                  <dt>Your comments</dt>
                  <dd>{appt.comments}</dd>
                </>
              )}
              {appt.notes && (
                <>
                  <dt>Notes from the clinic</dt>
                  <dd>{appt.notes}</dd>
                </>
              )}
              {appt.cancel_reason && (
                <>
                  <dt>Cancel reason</dt>
                  <dd>{appt.cancel_reason}</dd>
                </>
              )}
            </dl>
            {upcoming && appt.checkin_status === 'not_available' && (
              <p className="muted">eCheck-in opens 7 days before your visit.</p>
            )}
          </div>
          {upcoming && appt.checkin_status !== 'complete' && appt.checkin_status !== 'not_available' && (
            <div className="btn-row">
              <CheckinLink appt={appt} />
            </div>
          )}
          {upcoming && (
            <Link className="btn btn-danger btn-block" to={`/visits/${appt.id}/cancel`}>
              Cancel appointment
            </Link>
          )}
          <Link className="btn btn-back" to="/visits">
            Back to Visits
          </Link>
        </>
      )}
    </Layout>
  )
}
