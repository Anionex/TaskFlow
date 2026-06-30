interface Props {
  size?: number
}

/**
 * App logo: a bare indigo check + task line, no container.
 * Uses the theme accent (var(--accent)) so it shifts with light/sepia/dark.
 */
export function Logo({ size = 24 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ color: 'var(--accent)', display: 'block', flexShrink: 0 }}
      aria-label="TaskFlow"
    >
      <path d="M3 12.5 l4.5 4.5 L16 6" />
      <path d="M14 17 h7" />
    </svg>
  )
}
