const base = { fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }

export const CartIcon = ({ size = 20, color = '#0f3d2e', strokeWidth = 2.2 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" stroke={color} strokeWidth={strokeWidth} {...base}>
    <circle cx="9" cy="20" r="1.6" />
    <circle cx="18" cy="20" r="1.6" />
    <path d="M2 3h3l2.5 12h11L21 7H6" />
  </svg>
)

export const ClipboardIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" stroke="#0f3d2e" strokeWidth="2.2" {...base}>
    <rect x="5" y="4" width="14" height="17" rx="2" />
    <path d="M9 4h6v3H9zM9 12h6M9 16h4" />
  </svg>
)

export const SearchIcon = ({ color = '#fff' }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" stroke={color} strokeWidth="2.4" {...base}>
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.5-3.5" />
  </svg>
)

export const PinIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="#3b2a00" aria-hidden="true">
    <path d="M12 2a7 7 0 00-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 00-7-7zm0 9.5A2.5 2.5 0 1112 6.5a2.5 2.5 0 010 5z" />
  </svg>
)

const side = { width: 18, height: 18, viewBox: '0 0 24 24', stroke: '#1f2937', strokeWidth: 2, ...base }
export const sideIcons = {
  dashboard: (
    <svg {...side}>
      <rect x="3" y="3" width="7" height="9" rx="1" />
      <rect x="14" y="3" width="7" height="5" rx="1" />
      <rect x="14" y="12" width="7" height="9" rx="1" />
      <rect x="3" y="16" width="7" height="5" rx="1" />
    </svg>
  ),
  kanban: (
    <svg {...side}>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="10" rx="1" />
      <rect x="17" y="4" width="4" height="13" rx="1" />
    </svg>
  ),
  list: (
    <svg {...side}>
      <path d="M4 6h16M4 12h16M4 18h10" />
    </svg>
  ),
  box: (
    <svg {...side}>
      <path d="M21 8l-9-5-9 5v8l9 5 9-5z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </svg>
  ),
  plus: (
    <svg {...side}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  ),
  grid: (
    <svg {...side}>
      <path d="M3 7h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7z" />
    </svg>
  ),
  users: (
    <svg {...side}>
      <circle cx="9" cy="8" r="4" />
      <path d="M2 21c0-4 3-6 7-6s7 2 7 6M17 11a3 3 0 100-6" />
    </svg>
  ),
  chart: (
    <svg {...side}>
      <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />
    </svg>
  ),
  gear: (
    <svg {...side}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
    </svg>
  ),
}
