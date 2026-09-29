import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { ChevronIcon } from '../components/Icons'
import { apiFetch } from '../lib/api'
import { fmtShortDate } from '../lib/format'
import type { LabPanel } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function ResultsPage() {
  useTitle('Test Results')
  const [items, setItems] = useState<LabPanel[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<LabPanel[]>('/results')
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load results'))
  }, [])

  return (
    <Layout title="Test Results">
      {error && <ErrorBox message={error} />}
      {!error && items === null && <Skeleton rows={4} label="Loading results" />}
      {items && items.length === 0 && (
        <div className="card">
          <p>No test results yet. Results appear here as soon as the lab reports them.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((p) => (
            <li key={p.id}>
              <Link to={`/results/${p.id}`} className="row">
                <span className="row-body">
                  <span className="row-title">{p.name}</span>
                  <span className="row-sub">
                    {fmtShortDate(p.collected_at)}, ordered by {p.provider.name}
                  </span>
                  <span className="row-sub" style={{ marginTop: 6 }}>
                    {!p.reviewed && <span className="pill">New</span>}
                    {!p.reviewed && p.abnormal_count > 0 && ' '}
                    {p.abnormal_count > 0 && <span className="pill pill-flag">{p.abnormal_count} out of range</span>}
                    {p.reviewed && p.abnormal_count === 0 && `${p.result_count} ${p.result_count === 1 ? 'test' : 'tests'}, all in range`}
                  </span>
                </span>
                <ChevronIcon />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}
