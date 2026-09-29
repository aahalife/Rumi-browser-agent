import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout } from '../components/Layout'
import { ErrorBox } from '../components/ErrorBox'
import { Skeleton } from '../components/Skeleton'
import { apiFetch, post } from '../lib/api'
import { fmtShortDate, fmtTime } from '../lib/format'
import type { Conversation } from '../lib/types'
import { useTitle } from '../lib/useTitle'

export function MessageThreadPage() {
  useTitle('Message')
  const { id } = useParams()
  const [conv, setConv] = useState<Conversation | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reply, setReply] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<Conversation>(`/messages/${id}`)
      .then(setConv)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load this message'))
  }, [id])

  async function onSend(e: FormEvent) {
    e.preventDefault()
    if (!reply.trim()) {
      setSendError('Write a reply first.')
      return
    }
    setSendError(null)
    setSending(true)
    try {
      setConv(await post<Conversation>(`/messages/${id}/reply`, { body: reply }))
      setReply('')
      setSent(true)
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setSending(false)
    }
  }

  return (
    <Layout title={conv?.subject ?? 'Message'} subtitle={conv ? `With ${conv.with}` : undefined}>
      {error && <ErrorBox message={error} />}
      {!error && !conv && <Skeleton rows={2} label="Loading message" />}
      {conv && (
        <>
          <section className="thread" aria-label="Conversation">
            {conv.messages?.map((m) => (
              <article key={m.id} className={m.sender === 'patient' ? 'msg msg-patient' : 'msg msg-office'}>
                <p className="msg-meta">
                  <strong>{m.sender_name}</strong>
                  <time dateTime={m.sent_at}>
                    {fmtShortDate(m.sent_at)}, {fmtTime(m.sent_at)}
                  </time>
                </p>
                <p className="msg-body">{m.body}</p>
              </article>
            ))}
          </section>
          <form className="card form" onSubmit={onSend}>
            <label htmlFor="reply">Reply</label>
            <textarea id="reply" name="reply" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} />
            {sendError && <ErrorBox message={sendError} />}
            {sent && <p className="help">Sent. The office usually replies within 2 business days.</p>}
            <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
              {sending ? 'Sending…' : 'Send'}
            </button>
          </form>
          <Link className="btn btn-back" to="/messages">
            Back to Messages
          </Link>
        </>
      )}
    </Layout>
  )
}
