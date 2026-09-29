import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { VisitCard } from '../components/VisitCard'
import { CalendarIcon, ChevronIcon, EnvelopeIcon, FlaskIcon, HeartIcon, ListIcon, PillIcon } from '../components/Icons'
import { useAuth } from '../lib/auth'
import { apiFetch } from '../lib/api'
import type { Appointment, Patient } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function HomePage() {
  useTitle('Home')
  const { patient } = useAuth()
  const [upcoming, setUpcoming] = useState<Appointment[] | null>(null)
  const [me, setMe] = useState<Patient | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Appointment[]>('/appointments?status=upcoming')
      .then(setUpcoming)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load appointments'))
    apiFetch<Patient>('/me').then(setMe).catch(() => setMe(null))
  }, [])

  const now = new Date()
  const next = upcoming?.[0]
  const unread = me?.unread_messages ?? 0
  const newResults = me?.new_results ?? 0

  return (
    <Layout
      title={`Welcome, ${patient?.first_name ?? ''}`}
      subtitle={now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
      greeting
    >
      <section aria-labelledby="next-appt">
        <h2 id="next-appt">Next appointment</h2>
        {error && <ErrorBox message={error} />}
        {!error && upcoming === null && <Skeleton rows={1} label="Loading appointments" />}
        {upcoming && !next && (
          <div className="card">
            <p>No upcoming visits. When you need one, schedule it below.</p>
          </div>
        )}
        {next && <VisitCard appt={next} upcoming hero />}
      </section>

      {(unread > 0 || newResults > 0) && (
        <section aria-labelledby="updates">
          <h2 id="updates">Updates</h2>
          <ul className="rows">
            {unread > 0 && (
              <li>
                <Link to="/messages" className="row">
                  <span className="dot" aria-hidden="true" />
                  <span className="row-body">
                    <span className="row-title">
                      You have {unread} unread {unread === 1 ? 'message' : 'messages'}
                    </span>
                  </span>
                  <ChevronIcon />
                </Link>
              </li>
            )}
            {newResults > 0 && (
              <li>
                <Link to="/results" className="row">
                  <span className="dot" aria-hidden="true" />
                  <span className="row-body">
                    <span className="row-title">
                      {newResults} new test {newResults === 1 ? 'result' : 'results'}
                    </span>
                  </span>
                  <ChevronIcon />
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      <section aria-labelledby="quick-actions">
        <h2 id="quick-actions">Quick actions</h2>
        <nav className="quick-grid" aria-label="Quick actions">
          <Link className="tile tile-primary" to="/schedule">
            <CalendarIcon />
            Schedule an Appointment
          </Link>
          <Link className="tile" to="/visits">
            <ListIcon />
            Visits
          </Link>
          <Link className="tile" to="/messages">
            <EnvelopeIcon />
            Messages
          </Link>
          <Link className="tile" to="/results">
            <FlaskIcon />
            Test Results
          </Link>
          <Link className="tile" to="/medications">
            <PillIcon />
            Medications
          </Link>
          <Link className="tile" to="/health-summary">
            <HeartIcon />
            Health Summary
          </Link>
        </nav>
      </section>
    </Layout>
  )
}
