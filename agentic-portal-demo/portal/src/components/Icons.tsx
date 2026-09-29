import type { SVGProps } from 'react'

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
}

export const MenuIcon = () => (
  <svg {...base}>
    <path d="M4 7h16M4 12h16M4 17h16" />
  </svg>
)

export const CloseIcon = () => (
  <svg {...base}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

export const ChevronIcon = () => (
  <svg {...base} className="chevron">
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const CheckIcon = () => (
  <svg {...base} strokeWidth={2.2}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
)

export const CheckCircleIcon = () => (
  <svg {...base}>
    <circle cx="12" cy="12" r="9.5" />
    <path d="m7.5 12.5 3 3 6-6.5" />
  </svg>
)

export const CalendarIcon = () => (
  <svg {...base}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
    <path d="M3.5 10h17M8 3v4M16 3v4M8 14h3" />
  </svg>
)

export const ListIcon = () => (
  <svg {...base}>
    <path d="M8 7h12M8 12h12M8 17h12" />
    <circle cx="4" cy="7" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="17" r="1" fill="currentColor" />
  </svg>
)

export const EnvelopeIcon = () => (
  <svg {...base}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="m4 7.5 8 6 8-6" />
  </svg>
)

export const FlaskIcon = () => (
  <svg {...base}>
    <path d="M9.5 3.5h5M10 3.5v5.2L5.2 17.3A2 2 0 0 0 7 20.5h10a2 2 0 0 0 1.8-3.2L14 8.7V3.5" />
    <path d="M7.5 14h9" />
  </svg>
)

export const PillIcon = () => (
  <svg {...base}>
    <rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-45 12 12)" />
    <path d="m9 9 6 6" />
  </svg>
)

export const HeartIcon = () => (
  <svg {...base}>
    <path d="M12 20s-7-4.6-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.4-7 10-7 10Z" />
  </svg>
)

export const PeopleIcon = () => (
  <svg {...base}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0M15.5 5.5a3 3 0 0 1 0 5.6M17 13.5a5 5 0 0 1 3.5 5" />
  </svg>
)

export const LeafIcon = () => (
  <svg {...base}>
    <path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z" />
    <path d="M5 19c3-4 6-7 10-9" />
  </svg>
)
