import { Star } from 'lucide-react'

interface Props {
  value: number
  onChange?: (v: number) => void
  max?: number
  size?: 'sm' | 'md'
  readonly?: boolean
}

export function StarRating({ value, onChange, max = 5, size = 'md', readonly = false }: Props) {
  const px = size === 'sm' ? 12 : 15
  return (
    <span style={{ display: 'inline-flex', gap: '2px', alignItems: 'center' }}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`${i + 1} 星`}
          disabled={readonly}
          onClick={() => !readonly && onChange && onChange(i + 1 === value ? 0 : i + 1)}
          style={{
            background: 'none',
            border: 'none',
            cursor: readonly ? 'default' : 'pointer',
            padding: '1px',
            display: 'flex',
            alignItems: 'center',
            color: i < value ? 'var(--accent)' : 'var(--text-muted)',
            transition: 'color var(--dur-fast)',
          }}
        >
          <Star size={px} fill={i < value ? 'currentColor' : 'none'} strokeWidth={1.5} />
        </button>
      ))}
    </span>
  )
}
