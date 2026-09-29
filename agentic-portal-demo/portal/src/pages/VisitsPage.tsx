import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { VisitCard } from '../components/VisitCard'
import { apiFetch } from '../lib/api'
import type { Appointment } from '../lib/types'
import { useTitle } from '../lib/useTitle'

type Tab = 'upcoming' | 'past'

export function VisitsPage() {
  useTitle('Visits')
  const [params, setParams] = useSearchParams()
  const tab: Tab = params.get('tab') === 'past' ? 'past' : 'upcoming'
  const [items, setItems] = useState<Appointment[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setItems(null)
    setError(null)
    apiFetch<Appointment[]>(`/appointments?status=${tab}`)
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load visits'))
  }, [tab])

  return (
    <Layout title="Visits">
      <div className="tabs" role="tablist" aria-label="Visit lists">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'upcoming'}
          className={tab === 'upcoming' ? 'tab active' : 'tab'}
          onClick={() => setParams({})}
        >
          Upcoming
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'past'}
          className={tab === 'past' ? 'tab active' : 'tab'}
          onClick={() => setParams({ tab: 'past' })}
        >
          Past
        </button>
      </div>

      {error && <ErrorBox message={error} />}
      {!error && items === null && <Skeleton rows={2} label="Loading visits" />}
      {items && items.length === 0 && tab === 'upcoming' && (
        <div className="card">
          <p>No upcoming visits.</p>
          <Link className="btn btn-primary btn-block" to="/schedule">
            Schedule an Appointment
          </Link>
        </div>
      )}
      {items && items.length === 0 && tab === 'past' && (
        <div className="card">
          <p>No past visits on file.</p>
        </div>
      )}
      {items?.map((a) => (
        <VisitCard key={a.id} appt={a} upcoming={tab === 'upcoming'} />
      ))}
    </Layout>
  )
}
