export function parseLocal(iso: string): Date {
  // API times are naive local ISO strings; new Date() treats them as local.
  return new Date(iso)
}

export function fmtDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function fmtTime(iso: string): string {
  return parseLocal(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export function fmtDateTime(iso: string): string {
  return `${fmtDate(iso)}, ${fmtTime(iso)}`
}

export function fmtShortDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function fmtLongDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function dateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
