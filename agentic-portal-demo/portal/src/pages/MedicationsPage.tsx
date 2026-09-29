import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { fmtShortDate } from '../lib/format'
import type { Medication } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function MedicationsPage() {
  useTitle('Medications')
  const [items, setItems] = useState<Medication[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Medication[]>('/medications')
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load medications'))
  }, [])

  return (
    <Layout title="Medications">
      {error && <ErrorBox message={error} />}
      {!error && items === null && <Skeleton rows={3} label="Loading medications" />}
      {items && items.length === 0 && (
        <div className="card">
          <p>No current medications on file.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((m) => (
            <li key={m.id}>
              <article>
                <div className="row" style={{ paddingBottom: 6 }}>
                  <div className="row-body">
                    <h2 className="row-title" style={{ fontSize: 'var(--fs-4)', margin: 0 }}>
                      {m.name}
                    </h2>
                    <span className="row-sub">{m.instructions}</span>
                    <span className="row-sub">Prescribed by {m.prescriber.name}</span>
                    <span className="row-sub">{m.pharmacy.name}</span>
                    <span className="row-sub">
                      {m.refills_left} {m.refills_left === 1 ? 'refill' : 'refills'} left, last filled {fmtShortDate(m.last_filled)}
                    </span>
                  </div>
                </div>
                <div className="row-actions">
                  {m.pending_refill ? (
                    <span className="pill pill-done">
                      Refill requested {fmtShortDate(m.pending_refill.created_at)} at {m.pending_refill.pharmacy.name}
                    </span>
                  ) : (
                    <Link className="btn btn-secondary" to={`/medications/${m.id}/refill`}>
                      Request refill
                    </Link>
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}
