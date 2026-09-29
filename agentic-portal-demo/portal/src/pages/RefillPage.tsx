import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { CheckCircleIcon } from '../components/Icons'
import { apiFetch, post } from '../lib/api'
import type { Medication, Pharmacy, RefillRequest } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function RefillPage() {
  useTitle('Request refill')
  const { id } = useParams()
  const [med, setMed] = useState<Medication | null>(null)
  const [pharmacies, setPharmacies] = useState<Pharmacy[]>([])
  const [pharmacyId, setPharmacyId] = useState('')
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<RefillRequest | null>(null)

  useEffect(() => {
    Promise.all([apiFetch<Medication>(`/medications/${id}`), apiFetch<Pharmacy[]>('/pharmacies')])
      .then(([m, p]) => {
        setMed(m)
        setPharmacies(p)
        setPharmacyId(String(m.pharmacy.id))
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this medication'))
  }, [id])

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!pharmacyId) return setError('Please choose a pharmacy.')
    setError(null)
    setBusy(true)
    try {
      setDone(await post<RefillRequest>(`/medications/${id}/refill`, { pharmacy_id: Number(pharmacyId), comments }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not request the refill')
    } finally {
      setBusy(false)
    }
  }

  if (done && med) {
    return (
      <Layout title="Refill requested">
        <div className="hero success">
          <div className="success-mark">
            <CheckCircleIcon />
            <p className="success-title">Refill requested</p>
          </div>
          <p className="summary-line summary-type">{med.name}</p>
          <p className="summary-line">
            {done.pharmacy.name}
            <br />
            <span className="muted">{done.pharmacy.address}</span>
          </p>
          <p className="detail-line">
            The pharmacy will contact you when it is ready, usually within 2 business days. If your prescriber needs to
            approve the refill first, the office will message you.
          </p>
        </div>
        <Link className="btn btn-primary btn-block" to="/medications">
          Back to Medications
        </Link>
      </Layout>
    )
  }

  return (
    <Layout title="Request refill">
      {error && !med && <ErrorBox message={error} />}
      {!error && !med && <Skeleton rows={2} label="Loading medication" />}
      {med && med.pending_refill && (
        <div className="card">
          <p>A refill request for this medication is already pending.</p>
          <Link className="btn btn-back" to="/medications">
            Back to Medications
          </Link>
        </div>
      )}
      {med && !med.pending_refill && (
        <form className="card form" onSubmit={onSubmit}>
          <h2>Refill request</h2>
          <p className="summary-line summary-type">{med.name}</p>
          <p className="summary-line">{med.instructions}</p>
          <p className="summary-line">Prescribed by {med.prescriber.name}</p>
          <label htmlFor="pharmacy">Pharmacy</label>
          <select id="pharmacy" name="pharmacy" value={pharmacyId} onChange={(e) => setPharmacyId(e.target.value)} required>
            {pharmacies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <label htmlFor="refill-comments">Comments (optional)</label>
          <textarea
            id="refill-comments"
            name="comments"
            rows={3}
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />
          {error && <ErrorBox message={error} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
            {busy ? 'Requesting…' : 'Request refill'}
          </button>
          <Link className="btn btn-back" to="/medications">
            Back
          </Link>
        </form>
      )}
    </Layout>
  )
}
