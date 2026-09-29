import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch } from '../lib/api'
import type { CareTeamMember } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function CareTeamPage() {
  useTitle('Care Team')
  const [team, setTeam] = useState<CareTeamMember[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<CareTeamMember[]>('/care-team')
      .then(setTeam)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your care team'))
  }, [])

  return (
    <Layout title="Care Team">
      {error && <ErrorBox message={error} />}
      {!error && !team && <Skeleton rows={3} label="Loading care team" />}
      {team && (
        <ul className="rows team">
          {team.map((m) => (
            <li key={m.id}>
              <article>
                <div className="row">
                  <span className="avatar avatar-lg" aria-hidden="true">
                    {m.initials}
                  </span>
                  <div className="row-body">
                    <h2 className="row-title" style={{ fontSize: 'var(--fs-4)', margin: 0 }}>
                      {m.name}
                    </h2>
                    <span className="row-sub">{m.role === m.specialty ? m.specialty : `${m.role}, ${m.specialty}`}</span>
                    <span className="row-sub">{m.location}</span>
                  </div>
                </div>
                <div className="row-actions">
                  <Link className="btn btn-secondary" to={`/messages/new?to=${m.id}`}>
                    Message
                  </Link>
                  <Link className="btn btn-quiet" to="/schedule">
                    Schedule
                  </Link>
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </Layout>
  )
}
