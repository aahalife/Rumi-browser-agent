import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch, post } from '../lib/api'
import type { Conversation, Recipient } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function NewMessagePage() {
  useTitle('New message')
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [recipients, setRecipients] = useState<Recipient[] | null>(null)
  const [to, setTo] = useState(params.get('to') ?? '')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    apiFetch<Recipient[]>('/messages/recipients')
      .then(setRecipients)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load recipients'))
  }, [])

  async function onSend(e: FormEvent) {
    e.preventDefault()
    if (!to) return setError('Please choose a recipient.')
    if (!subject.trim()) return setError('Please add a subject.')
    if (!body.trim()) return setError('Please write your message.')
    setError(null)
    setSending(true)
    try {
      const conv = await post<Conversation>('/messages', { recipient_id: Number(to), subject, body })
      navigate(`/messages/${conv.id}`, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
      setSending(false)
    }
  }

  return (
    <Layout title="New message">
      {!recipients && !error && <Skeleton rows={2} label="Loading" />}
      {recipients && (
        <form className="card form" onSubmit={onSend}>
          <p className="lead">Messages go to the office and are not for emergencies. If this is urgent, call 911.</p>
          <label htmlFor="to">To</label>
          <select id="to" name="to" value={to} onChange={(e) => setTo(e.target.value)} required>
            <option value="">Choose a recipient</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} ({r.specialty})
              </option>
            ))}
          </select>
          <label htmlFor="subject">Subject</label>
          <input id="subject" name="subject" type="text" maxLength={128} value={subject} onChange={(e) => setSubject(e.target.value)} />
          <label htmlFor="body">Message</label>
          <textarea id="body" name="body" rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          {error && <ErrorBox message={error} />}
          <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </button>
          <Link className="btn btn-secondary btn-block" to="/messages">
            Cancel
          </Link>
        </form>
      )}
      {error && !recipients && <ErrorBox message={error} />}
    </Layout>
  )
}
