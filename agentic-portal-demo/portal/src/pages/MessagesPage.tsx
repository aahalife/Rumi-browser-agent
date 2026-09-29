import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { ChevronIcon } from '../components/Icons'
import { apiFetch } from '../lib/api'
import { fmtShortDate } from '../lib/format'
import type { Conversation } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function MessagesPage() {
  useTitle('Messages')
  const [items, setItems] = useState<Conversation[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Conversation[]>('/messages')
      .then(setItems)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load messages'))
  }, [])

  return (
    <Layout title="Messages">
      <Link className="btn btn-primary btn-block" to="/messages/new" style={{ marginTop: 0, marginBottom: 16 }}>
        New message
      </Link>
      {error && <ErrorBox message={error} />}
      {!error && items === null && <Skeleton rows={3} label="Loading messages" />}
      {items && items.length === 0 && (
        <div className="card">
          <p>No messages yet. Send one to your care team and their reply will show here.</p>
        </div>
      )}
      {items && items.length > 0 && (
        <ul className="rows">
          {items.map((c) => (
            <li key={c.id}>
              <Link to={`/messages/${c.id}`} className="row">
                {c.unread ? <span className="dot" aria-label="Unread" /> : <span className="dot-placeholder" />}
                <span className="row-body">
                  <span className="row-title" style={{ fontWeight: c.unread ? 700 : 400 }}>
                    {c.subject}
                  </span>
                  <span className="row-sub">{c.with}</span>
                  <span className="row-date">{fmtShortDate(c.last_message_at)}</span>
                  <span className="row-sub clip">{c.last_preview}</span>
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
