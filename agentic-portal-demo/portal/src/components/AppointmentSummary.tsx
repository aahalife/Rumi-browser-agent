import { fmtDateTime } from '../lib/format'

interface Props {
  visitType: string
  providerName: string
  specialty: string
  start: string
  locationName: string
  locationAddress?: string
}

export function AppointmentSummary({ visitType, providerName, specialty, start, locationName, locationAddress }: Props) {
  return (
    <div className="summary">
      <p className="summary-line summary-type">{visitType}</p>
      <p className="summary-line">
        {providerName}, {specialty}
      </p>
      <p className="summary-line">{fmtDateTime(start)}</p>
      <p className="summary-line">{locationName}</p>
      {locationAddress && <p className="summary-line summary-muted">{locationAddress}</p>}
    </div>
  )
}
