import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { CheckCircleIcon, CheckIcon } from '../components/Icons'
import { AppointmentSummary } from '../components/AppointmentSummary'
import { apiFetch, post } from '../lib/api'
import { dateKey, fmtTime, parseLocal } from '../lib/format'
import type { Appointment, Location, Provider, Slot, VisitReason } from '../lib/types'
import { useTitle } from '../lib/useTitle'

type Step = 'reason' | 'provider' | 'location' | 'time' | 'review' | 'done'
const STEPS: Step[] = ['reason', 'provider', 'location', 'time', 'review']

const ANY = 'any'

export function SchedulePage() {
  useTitle('Schedule an Appointment')
  const [params, setParams] = useSearchParams()

  const step = (params.get('step') as Step) || 'reason'
  const reasonId = params.get('reason')
  const providerId = params.get('provider')
  const locationId = params.get('location')
  const dateParam = params.get('date')
  const slotId = params.get('slot')
  const period = params.get('period') === 'morning' ? 'morning' : 'afternoon'

  const [reasons, setReasons] = useState<VisitReason[] | null>(null)
  const [providers, setProviders] = useState<Provider[] | null>(null)
  const [locations, setLocations] = useState<Location[] | null>(null)
  const [slots, setSlots] = useState<Slot[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [comments, setComments] = useState('')
  const [booking, setBooking] = useState(false)
  const [booked, setBooked] = useState<Appointment | null>(null)
  const [bookError, setBookError] = useState<string | null>(null)

  function go(next: Partial<Record<string, string | null>>) {
    const merged = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) {
      if (v === null || v === undefined) merged.delete(k)
      else merged.set(k, v)
    }
    setParams(merged)
  }

  useEffect(() => {
    apiFetch<VisitReason[]>('/scheduling/reasons')
      .then(setReasons)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load reasons'))
  }, [])

  useEffect(() => {
    if (!reasonId) return
    setProviders(null)
    apiFetch<Provider[]>(`/scheduling/providers?reason=${encodeURIComponent(reasonId)}`)
      .then(setProviders)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load providers'))
  }, [reasonId])

  useEffect(() => {
    if (step !== 'location' && step !== 'time' && step !== 'review') return
    if (locations) return
    apiFetch<Location[]>('/scheduling/locations')
      .then(setLocations)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load locations'))
  }, [step, locations])

  useEffect(() => {
    if (!reasonId || !providerId || !locationId) return
    if (step !== 'time' && step !== 'review') return
    setSlots(null)
    const from = dateKey(new Date())
    const q = new URLSearchParams({ provider_id: providerId, location_id: locationId, reason: reasonId, from, days: '14' })
    apiFetch<Slot[]>(`/scheduling/slots?${q.toString()}`)
      .then(setSlots)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load available times'))
  }, [step, reasonId, providerId, locationId])

  const days = useMemo(() => {
    const out: Date[] = []
    const base = new Date()
    base.setHours(0, 0, 0, 0)
    for (let i = 0; i < 14; i++) {
      const d = new Date(base)
      d.setDate(base.getDate() + i)
      out.push(d)
    }
    return out
  }, [])

  const slotsByDay = useMemo(() => {
    const map = new Map<string, Slot[]>()
    for (const s of slots ?? []) {
      const k = dateKey(parseLocal(s.start))
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(s)
    }
    return map
  }, [slots])

  const firstOpenDay = days.find((d) => (slotsByDay.get(dateKey(d))?.length ?? 0) > 0)
  const selectedDay = dateParam ?? (firstOpenDay ? dateKey(firstOpenDay) : null)

  const reason = reasons?.find((r) => r.id === reasonId) ?? null
  const provider = providerId === ANY ? null : (providers?.find((p) => String(p.id) === providerId) ?? null)
  const location = locations?.find((l) => String(l.id) === locationId) ?? null
  const slot = slots?.find((s) => String(s.id) === slotId) ?? null

  const stepIndex = STEPS.indexOf(step)

  async function schedule() {
    if (!slot || !reasonId) return
    setBookError(null)
    setBooking(true)
    try {
      const appt = await post<Appointment>('/appointments', { slot_id: slot.id, reason: reasonId, comments })
      setBooked(appt)
      go({ step: 'done' })
    } catch (e) {
      setBookError(e instanceof Error ? e.message : 'Could not schedule this appointment')
    } finally {
      setBooking(false)
    }
  }

  if (step === 'done' && booked) {
    return (
      <Layout title="Schedule an Appointment">
        <div className="hero success">
          <div className="success-mark">
            <CheckCircleIcon />
            <p className="success-title">You're scheduled!</p>
          </div>
          <AppointmentSummary
            visitType={booked.visit_type}
            providerName={booked.provider.name}
            specialty={booked.provider.specialty}
            start={booked.start}
            locationName={booked.location.name}
          />
          {booked.comments && <p className="muted">Your comments: {booked.comments}</p>}
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
    <Layout title="Schedule an Appointment">
      <ol className="stepper" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i === stepIndex ? 'current' : i < stepIndex ? 'done' : ''} aria-current={i === stepIndex ? 'step' : undefined}>
            <span className="step-dot">{i < stepIndex ? <CheckIcon /> : i + 1}</span>
          </li>
        ))}
      </ol>
      <p className="step-caption">Step {stepIndex + 1} of {STEPS.length}</p>
      {(reason || provider || providerId === ANY || location) && step !== 'reason' && (
        <div className="choices" aria-label="Your choices so far">
          {reason && <span className="pill">{reason.label}</span>}
          {step !== 'provider' && (provider || providerId === ANY) && <span className="pill">{provider ? provider.name : 'Any provider'}</span>}
          {step !== 'provider' && step !== 'location' && location && <span className="pill">{location.name}</span>}
        </div>
      )}
      {error && <ErrorBox message={error} />}

      {step === 'reason' && (
        <section>
          <h2>What is the reason for your visit?</h2>
          {!reasons && <Skeleton rows={4} label="Loading" />}
          <ul className="option-list">
            {reasons?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="option"
                  aria-pressed={r.id === reasonId}
                  onClick={() => go({ reason: r.id, provider: null, location: null, date: null, slot: null, step: 'provider' })}
                >
                  <span className="option-text">
                    <span className="option-title">{r.label}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'provider' && (
        <section>
          <h2>Choose a provider</h2>
          {!providers && <Skeleton rows={4} label="Loading providers" />}
          <ul className="option-list">
            <li>
              <button
                type="button"
                className="option"
                aria-pressed={providerId === ANY}
                onClick={() => go({ provider: ANY, date: null, slot: null, step: 'location' })}
              >
                <span className="avatar avatar-lg" aria-hidden="true">
                  Any
                </span>
                <span className="option-text">
                  <span className="option-title">Any provider</span>
                  <span className="muted">First available</span>
                </span>
              </button>
            </li>
            {providers?.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="option"
                  aria-pressed={String(p.id) === providerId}
                  onClick={() => go({ provider: String(p.id), date: null, slot: null, step: 'location' })}
                >
                  <span className="avatar avatar-lg" aria-hidden="true">
                    {p.initials}
                  </span>
                  <span className="option-text">
                    <span className="option-title">{p.name}</span>
                    <span className="muted">{p.specialty}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-back" onClick={() => go({ step: 'reason' })}>
            Back
          </button>
        </section>
      )}

      {step === 'location' && (
        <section>
          <h2>Choose a location</h2>
          {!locations && <Skeleton rows={2} label="Loading locations" />}
          <ul className="option-list">
            {locations?.map((l) => (
              <li key={l.id}>
                <button
                  type="button"
                  className="option"
                  aria-pressed={String(l.id) === locationId}
                  onClick={() => go({ location: String(l.id), date: null, slot: null, step: 'time' })}
                >
                  <span className="option-text">
                    <span className="option-title">{l.name}</span>
                    <span className="muted">{l.address}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn-back" onClick={() => go({ step: 'provider' })}>
            Back
          </button>
        </section>
      )}

      {step === 'time' && (
        <section>
          <h2>Choose a time</h2>
          {!slots && <Skeleton rows={3} label="Finding open times" />}
          {slots && (
            <>
              <div className="date-strip" role="group" aria-label="Choose a date">
                {days.map((d) => {
                  const k = dateKey(d)
                  const count = slotsByDay.get(k)?.length ?? 0
                  return (
                    <button
                      key={k}
                      type="button"
                      className="date-chip"
                      disabled={count === 0}
                      aria-pressed={k === selectedDay}
                      onClick={() => go({ date: k, slot: null })}
                    >
                      <span className="date-chip-dow">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                      <span className="date-chip-day">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </button>
                  )
                })}
              </div>
              <div className="toggle" role="group" aria-label="Time of day">
                <button type="button" aria-pressed={period === 'morning'} onClick={() => go({ period: 'morning' })}>
                  Morning
                </button>
                <button type="button" aria-pressed={period === 'afternoon'} onClick={() => go({ period: 'afternoon' })}>
                  Afternoon
                </button>
              </div>
              {selectedDay ? (
                <>
                  <h3>{parseLocal(selectedDay + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
                  <SlotGrid
                    slots={(slotsByDay.get(selectedDay) ?? []).filter((s) => {
                      const h = parseLocal(s.start).getHours()
                      return period === 'morning' ? h < 12 : h >= 12
                    })}
                    showProvider={providerId === ANY}
                    onPick={(s) => go({ date: selectedDay, slot: String(s.id), step: 'review' })}
                  />
                </>
              ) : (
                <div className="card">
                  <p>No open times in the next 14 days. Try another provider or location.</p>
                </div>
              )}
            </>
          )}
          <button type="button" className="btn btn-back" onClick={() => go({ step: 'location' })}>
            Back
          </button>
        </section>
      )}

      {step === 'review' && (
        <section>
          <h2>Review and schedule</h2>
          {(!slots || !locations || !reasons) && <Skeleton rows={2} label="Loading" />}
          {slots && !slot && (
            <div className="card">
              <p>That time is no longer available.</p>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => go({ slot: null, step: 'time' })}>
                Choose another time
              </button>
            </div>
          )}
          {slot && reason && location && (
            <form
              className="card form"
              onSubmit={(e) => {
                e.preventDefault()
                void schedule()
              }}
            >
              <AppointmentSummary
                visitType={reason.label}
                providerName={slot.provider.name}
                specialty={slot.provider.specialty}
                start={slot.start}
                locationName={location.name}
              />
              <label htmlFor="visit-comments">Reason for visit (comments)</label>
              <textarea
                id="visit-comments"
                name="comments"
                rows={3}
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="Anything your provider should know?"
              />
              {bookError && (
                <div className="error-box" role="alert">
                  {bookError}{' '}
                  <button type="button" className="link-btn" onClick={() => go({ slot: null, step: 'time' })}>
                    Choose another time
                  </button>
                </div>
              )}
              <button type="submit" className="btn btn-primary btn-block" disabled={booking}>
                {booking ? 'Scheduling…' : 'Schedule'}
              </button>
              <button type="button" className="btn btn-back" onClick={() => go({ step: 'time' })}>
            Back
          </button>
            </form>
          )}
        </section>
      )}
    </Layout>
  )
}

function SlotGrid({ slots, showProvider, onPick }: { slots: Slot[]; showProvider: boolean; onPick: (s: Slot) => void }) {
  if (slots.length === 0) {
    return (
      <div className="card">
        <p>No open times in this part of the day. Try the other part of the day or another date.</p>
      </div>
    )
  }
  return (
    <div className={showProvider ? 'slot-list' : 'slot-grid'}>
      {slots.map((s) => (
        <button key={s.id} type="button" className="slot" onClick={() => onPick(s)}>
          {showProvider ? `${fmtTime(s.start)} – ${s.provider.name}` : fmtTime(s.start)}
        </button>
      ))}
    </div>
  )
}
