import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { CheckCircleIcon, CheckIcon } from '../components/Icons'
import { AppointmentSummary } from '../components/AppointmentSummary'
import { apiFetch, post } from '../lib/api'
import { fmtDate } from '../lib/format'
import type { Appointment, CheckinState, CheckinStep, HealthSummary, Medication, Patient } from '../lib/types'
import { useTitle } from '../lib/useTitle'

type Step = CheckinStep | 'review'
const STEPS: Step[] = ['personal_info', 'insurance', 'allergies', 'medications', 'questionnaire', 'consent', 'review']
const TITLES: Record<Step, string> = {
  personal_info: 'Personal information',
  insurance: 'Insurance',
  allergies: 'Allergies',
  medications: 'Medications',
  questionnaire: 'A few questions',
  consent: 'Consent',
  review: 'Review and finish',
}

export function CheckinPage() {
  useTitle('eCheck-in')
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const step = (STEPS.includes(params.get('step') as Step) ? params.get('step') : 'personal_info') as Step

  const [appt, setAppt] = useState<Appointment | null>(null)
  const [state, setState] = useState<CheckinState | null>(null)
  const [me, setMe] = useState<Patient | null>(null)
  const [health, setHealth] = useState<HealthSummary | null>(null)
  const [meds, setMeds] = useState<Medication[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stepError, setStepError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [address, setAddress] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [payer, setPayer] = useState('')
  const [memberId, setMemberId] = useState('')
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [agreed, setAgreed] = useState(false)
  const [signature, setSignature] = useState('')

  useEffect(() => {
    Promise.all([
      apiFetch<Appointment>(`/appointments/${id}`),
      apiFetch<CheckinState>(`/appointments/${id}/checkin`),
      apiFetch<Patient>('/me'),
      apiFetch<HealthSummary>('/health-summary'),
      apiFetch<Medication[]>('/medications'),
    ])
      .then(([a, s, m, h, md]) => {
        setAppt(a)
        setState(s)
        setMe(m)
        setHealth(h)
        setMeds(md)
        setAddress(m.address)
        setPhone(m.phone)
        setEmail(m.email)
        setPayer(m.insurance.payer)
        setMemberId(m.insurance.member_id)
        setAnswers(s.answers)
        if (s.signature) setSignature(s.signature)
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load eCheck-in'))
  }, [id])

  function go(next: Step) {
    setStepError(null)
    setParams({ step: next })
    window.scrollTo(0, 0)
  }

  const index = STEPS.indexOf(step)
  const prev = index > 0 ? STEPS[index - 1] : null
  const nextStep = index < STEPS.length - 1 ? STEPS[index + 1] : 'review'

  async function save(stepName: CheckinStep, body: Record<string, unknown>) {
    setStepError(null)
    setBusy(true)
    try {
      const s = await apiFetch<CheckinState>(`/appointments/${id}/checkin/${stepName}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      })
      setState(s)
      go(nextStep)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Could not save this step')
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    setStepError(null)
    setBusy(true)
    try {
      setState(await post<CheckinState>(`/appointments/${id}/checkin/complete`))
      window.scrollTo(0, 0)
    } catch (err) {
      setStepError(err instanceof Error ? err.message : 'Could not finish check-in')
    } finally {
      setBusy(false)
    }
  }

  function submit(stepName: CheckinStep, body: Record<string, unknown>) {
    return (e: FormEvent) => {
      e.preventDefault()
      void save(stepName, body)
    }
  }

  if (error) {
    return (
      <Layout title="eCheck-in">
        <ErrorBox message={error} />
      </Layout>
    )
  }
  if (!appt || !state || !me || !health || !meds) {
    return (
      <Layout title="eCheck-in">
        <Skeleton rows={3} label="Loading eCheck-in" />
      </Layout>
    )
  }

  const summary = (
    <AppointmentSummary
      visitType={appt.visit_type}
      providerName={appt.provider.name}
      specialty={appt.provider.specialty}
      start={appt.start}
      locationName={appt.location.name}
      locationAddress={appt.location.address}
    />
  )

  if (state.status === 'complete') {
    return (
      <Layout title="eCheck-in">
        <div className="hero success">
          <div className="success-mark">
            <CheckCircleIcon />
            <p className="success-title">You're checked in!</p>
          </div>
          {summary}
          <p className="detail-line">
            When you arrive, go straight to the front desk and give your name. Your copay of ${state.copay} is due at
            the visit.
          </p>
        </div>
        <Link className="btn btn-primary btn-block" to="/home">
          Back to Home
        </Link>
        <Link className="btn btn-secondary btn-block" to={`/visits/${appt.id}`}>
          Visit details
        </Link>
      </Layout>
    )
  }

  if (state.status === 'not_available') {
    return (
      <Layout title="eCheck-in">
        <div className="card">
          {summary}
          <p>eCheck-in opens 7 days before your visit.</p>
          <Link className="btn btn-back" to={`/visits/${appt.id}`}>
            Back to visit
          </Link>
        </div>
      </Layout>
    )
  }

  const backLink = prev ? (
    <Link className="btn btn-back" to={`/visits/${appt.id}/checkin?step=${prev}`}>
      Back
    </Link>
  ) : (
    <Link className="btn btn-back" to={`/visits/${appt.id}`}>
      Back to visit
    </Link>
  )

  return (
    <Layout title="eCheck-in">
      <p className="lead">
        {appt.provider.name}, {fmtDate(appt.start)}
      </p>
      <ol className="stepper compact" aria-label="Progress">
        {STEPS.map((s, i) => (
          <li key={s} className={i === index ? 'current' : i < index ? 'done' : ''} aria-current={i === index ? 'step' : undefined}>
            <span className="step-dot">{i < index ? <CheckIcon /> : i + 1}</span>
          </li>
        ))}
      </ol>
      <p className="step-caption">Step {index + 1} of {STEPS.length}</p>

      {step === 'personal_info' && (
        <form className="card form" onSubmit={submit('personal_info', { confirmed: true, address, phone, email })}>
          <h2>{TITLES.personal_info}</h2>
          <p className="muted">Check that we can reach you. Edit anything that changed.</p>
          <p className="detail-line">
            <span className="detail-label">Name on file:</span> {me.first_name} {me.last_name} (contact the office to change your name)
          </p>
          <p className="detail-line">
            <span className="detail-label">Date of birth:</span> {me.date_of_birth}
          </p>
          {me.emergency_contact && (
            <p className="detail-line">
              <span className="detail-label">Emergency contact:</span> {me.emergency_contact}
            </p>
          )}
          <label htmlFor="ci-address">Home address</label>
          <input id="ci-address" name="address" type="text" value={address} onChange={(e) => setAddress(e.target.value)} />
          <label htmlFor="ci-phone">Phone</label>
          <input id="ci-phone" name="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <label htmlFor="ci-email">Email</label>
          <input id="ci-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            This is correct
          </button>
          {backLink}
        </form>
      )}

      {step === 'insurance' && (
        <form className="card form" onSubmit={submit('insurance', { confirmed: true, insurance_payer: payer, insurance_member_id: memberId })}>
          <h2>{TITLES.insurance}</h2>
          <label htmlFor="ci-payer">Insurance plan</label>
          <input id="ci-payer" name="insurance_payer" type="text" value={payer} onChange={(e) => setPayer(e.target.value)} />
          <label htmlFor="ci-member">Member ID</label>
          <input id="ci-member" name="insurance_member_id" type="text" value={memberId} onChange={(e) => setMemberId(e.target.value)} />
          <p className="muted">Bring your insurance card and a photo ID to the visit.</p>
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            This is correct
          </button>
          {backLink}
        </form>
      )}

      {step === 'allergies' && (
        <form className="card form" onSubmit={submit('allergies', { confirmed: true })}>
          <h2>{TITLES.allergies}</h2>
          {health.allergies.length === 0 && <p>No known allergies.</p>}
          {health.allergies.length > 0 && (
            <ul className="plain-list">
              {health.allergies.map((a) => (
                <li key={a.substance}>
                  <strong>{a.substance}</strong> — {a.reaction} ({a.severity})
                </li>
              ))}
            </ul>
          )}
          <p className="muted">If something is missing, tell the care team at your visit.</p>
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            No changes
          </button>
          {backLink}
        </form>
      )}

      {step === 'medications' && (
        <form className="card form" onSubmit={submit('medications', { confirmed: true })}>
          <h2>{TITLES.medications}</h2>
          {meds.length === 0 && <p>No current medications.</p>}
          {meds.length > 0 && (
            <ul className="plain-list">
              {meds.map((m) => (
                <li key={m.id}>
                  <strong>{m.name}</strong> — {m.instructions}
                </li>
              ))}
            </ul>
          )}
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            No changes
          </button>
          {backLink}
        </form>
      )}

      {step === 'questionnaire' && (
        <form className="card form" onSubmit={submit('questionnaire', { answers })}>
          <h2>{TITLES.questionnaire}</h2>
          {state.questions.map((q) =>
            q.type === 'text' ? (
              <div key={q.id}>
                <label htmlFor={`q-${q.id}`}>{q.label}</label>
                <input
                  id={`q-${q.id}`}
                  name={q.id}
                  type="text"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })}
                />
              </div>
            ) : (
              <fieldset key={q.id} className="question">
                <legend>{q.label}</legend>
                <div className="radio-row">
                  {['Yes', 'No'].map((opt) => (
                    <label key={opt} className="radio">
                      <input
                        type="radio"
                        name={q.id}
                        value={opt}
                        aria-label={`${q.label} ${opt}`}
                        checked={answers[q.id] === opt}
                        onChange={() => setAnswers({ ...answers, [q.id]: opt })}
                      />
                      {opt}
                    </label>
                  ))}
                </div>
              </fieldset>
            ),
          )}
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Continue
          </button>
          {backLink}
        </form>
      )}

      {step === 'consent' && (
        <form className="card form" onSubmit={submit('consent', { agreed, signature })}>
          <h2>{TITLES.consent}</h2>
          <div className="consent-text">
            <p>
              I consent to examination and treatment by Riverside Health providers and staff at this visit. I understand
              that I can ask questions about any test or treatment before it is done, and that I may decline any part of
              my care.
            </p>
            <p>
              I have been offered the Riverside Health Notice of Privacy Practices, which explains how my health
              information may be used and shared. I agree that my insurance may be billed for services at this visit
              and that I am responsible for any copay or balance my plan does not cover.
            </p>
          </div>
          <label className="check">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> I have read and agree
          </label>
          <p className="detail-line">
            <span className="detail-label">Name on file:</span> {me.first_name} {me.last_name}. Type it exactly as shown to sign.
          </p>
          <label htmlFor="ci-signature">Type your full name to sign</label>
          <input
            id="ci-signature"
            name="signature"
            type="text"
            autoComplete="off"
            placeholder={`${me.first_name} ${me.last_name}`}
            value={signature}
            onChange={(e) => setSignature(e.target.value)}
          />
          {stepError && <ErrorBox message={stepError} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            Sign and continue
          </button>
          {backLink}
        </form>
      )}

      {step === 'review' && (
        <div className="card form">
          <h2>{TITLES.review}</h2>
          {summary}
          <div className="review-list">
            {(['personal_info', 'insurance', 'allergies', 'medications', 'questionnaire', 'consent'] as CheckinStep[]).map((s) => (
              <div key={s}>
                {state.steps[s] ? <CheckIcon /> : <span className="todo" aria-hidden="true">○</span>}
                <span className={state.steps[s] ? '' : 'todo'}>{TITLES[s]}</span>
                {!state.steps[s] && <Link to={`/visits/${appt.id}/checkin?step=${s}`}>Finish this step</Link>}
              </div>
            ))}
          </div>
          <p className="detail-line">
            <span className="detail-label">Copay due at visit:</span> ${state.copay} (pay at the front desk)
          </p>
          {stepError && <ErrorBox message={stepError} />}
          <button type="button" className="btn btn-primary btn-block" disabled={busy} onClick={() => void finish()}>
            Finish check-in
          </button>
          {backLink}
        </div>
      )}
    </Layout>
  )
}
