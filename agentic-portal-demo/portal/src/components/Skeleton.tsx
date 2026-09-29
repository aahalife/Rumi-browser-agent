export function Skeleton({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <ul className="skeleton" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} aria-hidden="true">
          <span />
          <span />
        </li>
      ))}
    </ul>
  )
}
