import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { fmtShortDate } from '../lib/format'
import type { HealthSummary } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function HealthSummaryPage() {
  useTitle('Health Summary')
  const [data, setData] = useState<HealthSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<HealthSummary>('/health-summary')
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your health summary'))
  }, [])

  return (
    <Layout title="Health Summary">
      {error && <ErrorBox message={error} />}
      {!error && !data && <Skeleton rows={4} label="Loading health summary" />}
      {data && (
        <>
          <section aria-labelledby="hs-allergies">
            <h2 id="hs-allergies">Allergies</h2>
            {data.allergies.length === 0 && (
              <div className="card">
                <p>No known allergies.</p>
              </div>
            )}
            {data.allergies.length > 0 && (
              <ul className="rows">
                {data.allergies.map((a) => (
                  <li key={a.substance} className="row">
                    <span className="row-body">
                      <span className="row-title">{a.substance}</span>
                      <span className="row-sub">
                        {a.reaction}, {a.severity.toLowerCase()}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="hs-immunizations">
            <h2 id="hs-immunizations">Immunizations</h2>
            {data.immunizations.length === 0 && (
              <div className="card">
                <p>No immunizations on file.</p>
              </div>
            )}
            {data.immunizations.length > 0 && (
              <ul className="rows">
                {data.immunizations.map((i) => (
                  <li key={`${i.name}-${i.given_on}`} className="row">
                    <span className="row-body">
                      <span className="row-title">{i.name}</span>
                    </span>
                    <span className="row-side">{fmtShortDate(i.given_on)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="hs-problems">
            <h2 id="hs-problems">Health issues</h2>
            {data.problems.length === 0 && (
              <div className="card">
                <p>No health issues on file.</p>
              </div>
            )}
            {data.problems.length > 0 && (
              <ul className="rows">
                {data.problems.map((p) => (
                  <li key={p.name} className="row">
                    <span className="row-body">
                      <span className="row-title">{p.name}</span>
                    </span>
                    <span className="row-side">since {fmtShortDate(p.since)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <div className="btn-row">
            <Link className="btn btn-secondary" to="/medications">
              Medications
            </Link>
            <Link className="btn btn-secondary" to="/care-team">
              Care Team
            </Link>
          </div>
        </>
      )}
    </Layout>
  )
}
