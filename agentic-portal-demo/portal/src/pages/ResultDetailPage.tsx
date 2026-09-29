import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import { fmtLongDate } from '../lib/format'
import type { LabPanel, ResultRow as LabResult } from '../lib/types'
import { useTitle } from '../lib/useTitle'

// Where the value sits against its reference range, as fractions of the bar.
function rangeGeometry(r: LabResult): { okStart: number; okEnd: number; mark: number } | null {
  const value = parseFloat(r.value)
  if (Number.isNaN(value)) return null
  const ref = r.reference_range.trim()
  let lo: number | null = null
  let hi: number | null = null
  const between = ref.match(/^(-?[\d.]+)\s*[-–]\s*(-?[\d.]+)$/)
  if (between) {
    lo = parseFloat(between[1])
    hi = parseFloat(between[2])
  } else if (/^<\s*[\d.]+$/.test(ref)) {
    hi = parseFloat(ref.slice(1))
  } else if (/^>\s*[\d.]+$/.test(ref)) {
    lo = parseFloat(ref.slice(1))
  } else {
    return null
  }
  let min: number
  let max: number
  if (lo !== null && hi !== null) {
    const pad = (hi - lo) * 0.6
    min = Math.min(lo - pad, value)
    max = Math.max(hi + pad, value)
  } else if (hi !== null) {
    min = 0
    max = Math.max(hi * 1.6, value * 1.1)
  } else {
    min = 0
    max = Math.max((lo as number) * 2.2, value * 1.1)
  }
  const span = max - min || 1
  const f = (x: number) => Math.min(1, Math.max(0, (x - min) / span))
  return { okStart: f(lo ?? min), okEnd: f(hi ?? max), mark: f(value) }
}

function RangeBar({ r }: { r: LabResult }) {
  const g = rangeGeometry(r)
  if (!g) return null
  return (
    <div className="range" aria-hidden="true">
      <span className="range-ok" style={{ left: `${g.okStart * 100}%`, width: `${(g.okEnd - g.okStart) * 100}%` }} />
      <span className={r.flag ? 'range-mark flag' : 'range-mark'} style={{ left: `${g.mark * 100}%` }} />
    </div>
  )
}

export function ResultDetailPage() {
  useTitle('Test result')
  const { id } = useParams()
  const [panel, setPanel] = useState<LabPanel | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<LabPanel>(`/results/${id}`)
      .then(setPanel)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this result'))
  }, [id])

  return (
    <Layout title={panel?.name ?? 'Test result'}>
      {error && <ErrorBox message={error} />}
      {!error && !panel && <Skeleton rows={3} label="Loading result" />}
      {panel && (
        <>
          <p className="lead">
            Collected {fmtLongDate(panel.collected_at)}. Ordered by {panel.provider.name}, {panel.provider.specialty}.
          </p>
          <div className="rows" role="list" aria-label="Results">
            {panel.results?.map((r) => (
              <div key={r.name} className="result-row" role="listitem">
                <div className="result-top">
                  <span className="result-name">{r.name}</span>
                  <span className="result-value">
                    {r.value}
                    {r.unit && <span className="result-unit">{r.unit}</span>}
                  </span>
                </div>
                <RangeBar r={r} />
                <div className="result-foot">
                  <span>Reference range {r.reference_range}</span>
                  {r.flag === 'H' && <span className="pill pill-flag">High</span>}
                  {r.flag === 'L' && <span className="pill pill-flag">Low</span>}
                  {!r.flag && <span>In range</span>}
                </div>
              </div>
            ))}
          </div>
          {panel.notes && (
            <div className="card">
              <p className="detail-label">Comment from {panel.provider.name}</p>
              <p>{panel.notes}</p>
            </div>
          )}
          <p className="notice">
            Questions about a result?{' '}
            <Link to={`/messages/new?to=${panel.provider.id}`}>Send a message to your care team</Link>.
          </p>
          <Link className="btn btn-back" to="/results">
            Back to Test Results
          </Link>
        </>
      )}
    </Layout>
  )
}
