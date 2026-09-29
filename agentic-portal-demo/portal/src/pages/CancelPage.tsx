import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { CheckCircleIcon } from '../components/Icons'
import { AppointmentSummary } from '../components/AppointmentSummary'
import { apiFetch, post } from '../lib/api'
import type { Appointment } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function CancelPage() {
  useTitle('Cancel appointment')
  const { id } = useParams()
  const [appt, setAppt] = useState<Appointment | null>(null)
  const [reasons, setReasons] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    Promise.all([apiFetch<Appointment>(`/appointments/${id}`), apiFetch<string[]>('/cancel-reasons')])
      .then(([a, r]) => {
        setAppt(a)
        setReasons(r)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this visit'))
  }, [id])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!reason) {
      setError('Please choose a reason.')
      return
    }
    setError(null)
    setBusy(true)
    try {
      await post(`/appointments/${id}/cancel`, { reason, comments })
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel this appointment')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Layout title="Appointment canceled">
        <div className="hero success">
          <div className="success-mark">
            <CheckCircleIcon />
            <p className="success-title">Your appointment has been canceled</p>
          </div>
          {appt && (
            <AppointmentSummary
              visitType={appt.visit_type}
              providerName={appt.provider.name}
              specialty={appt.provider.specialty}
              start={appt.start}
              locationName={appt.location.name}
              locationAddress={appt.location.address}
            />
          )}
          <p className="detail-line">
            A confirmation of this cancellation is recorded on your Visits page under Past. To book a new time,
            choose Schedule an Appointment.
          </p>
        </div>
        <Link className="btn btn-primary btn-block" to="/home">
          Back to Home
        </Link>
        <Link className="btn btn-secondary btn-block" to="/visits">
          View Visits
        </Link>
      </Layout>
    )
  }

  return (
    <Layout title="Cancel appointment">
      {error && !appt && <ErrorBox message={error} />}
      {!error && !appt && <Skeleton rows={2} label="Loading visit" />}
      {appt && appt.status !== 'scheduled' && (
        <div className="card">
          <p>This appointment is no longer scheduled.</p>
          <Link className="btn btn-back" to="/visits">
            Back to Visits
          </Link>
        </div>
      )}
      {appt && appt.status === 'scheduled' && (
        <form className="card form" onSubmit={onSubmit}>
          <h2>You are canceling</h2>
          <AppointmentSummary
            visitType={appt.visit_type}
            providerName={appt.provider.name}
            specialty={appt.provider.specialty}
            start={appt.start}
            locationName={appt.location.name}
            locationAddress={appt.location.address}
          />
          {appt.comments && (
            <p className="detail-line">
              <span className="detail-label">Your note when booking:</span> {appt.comments}
            </p>
          )}
          {appt.notes && (
            <p className="detail-line">
              <span className="detail-label">Notes from the clinic:</span> {appt.notes}
            </p>
          )}
          <p className="detail-line">
            <span className="detail-label">What happens next:</span> the time is released so another patient can
            use it. There is no fee for canceling. If you still need to be seen, choose Schedule an Appointment
            after you cancel. Please cancel at least 24 hours before the visit when you can.
          </p>
          <label htmlFor="cancel-reason">Reason for canceling</label>
          <select id="cancel-reason" name="reason" value={reason} onChange={(e) => setReason(e.target.value)} required>
            <option value="">Choose a reason</option>
            {reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <label htmlFor="cancel-comments">Comments (optional)</label>
          <textarea
            id="cancel-comments"
            name="comments"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          {error && <ErrorBox message={error} />}
          <button type="submit" className="btn btn-danger-solid btn-block" disabled={busy}>
            {busy ? 'Canceling…' : 'Cancel appointment'}
          </button>
          <Link className="btn btn-secondary btn-block" to={`/visits/${appt.id}`}>
            Keep appointment
          </Link>
        </form>
      )}
    </Layout>
  )
}
