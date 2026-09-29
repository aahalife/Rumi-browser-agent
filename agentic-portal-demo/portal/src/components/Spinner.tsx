export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <p>{label}…</p>
    </div>
  )
}
