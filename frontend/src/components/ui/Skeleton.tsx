import { useState, useEffect } from 'react'
import type { CSSProperties, ReactNode } from 'react'

/** duration (ms) the skeleton stays mounted to fade out; matches --dur-slow */
const FADE_MS = 320

interface LoadingSwapProps {
  loading: boolean
  skeleton: ReactNode
  children: ReactNode
}

/**
 * Crossfades a skeleton into real content: while `loading`, the skeleton sits
 * in flow; when loading finishes, the content fades in and the skeleton fades
 * out on top of it, then unmounts — so there's no jarring instant swap.
 */
export function LoadingSwap({ loading, skeleton, children }: LoadingSwapProps) {
  const [showSkeleton, setShowSkeleton] = useState(loading)

  useEffect(() => {
    if (loading) {
      setShowSkeleton(true)
      return
    }
    const t = setTimeout(() => setShowSkeleton(false), FADE_MS)
    return () => clearTimeout(t)
  }, [loading])

  return (
    <div style={{ position: 'relative' }}>
      {!loading && <div className="tf-fade-in">{children}</div>}
      {showSkeleton && (
        <div
          aria-hidden
          style={{
            opacity: loading ? 1 : 0,
            transition: 'opacity var(--dur-slow) var(--ease-out)',
            ...(loading ? null : { position: 'absolute', inset: 0, pointerEvents: 'none' }),
          }}
        >
          {skeleton}
        </div>
      )}
    </div>
  )
}

interface SkeletonProps {
  width?: number | string
  height?: number | string
  radius?: number | string
  style?: CSSProperties
}

/** A single shimmering placeholder block. */
export function Skeleton({ width = '100%', height = 12, radius = 'var(--radius-sm)', style }: SkeletonProps) {
  return (
    <span
      className="tf-skeleton"
      style={{ display: 'block', width, height, borderRadius: radius, ...style }}
      aria-hidden
    />
  )
}

interface SkeletonRowsProps {
  count?: number
  /** show a small leading square (e.g. task checkbox) */
  leading?: boolean
  padding?: string
}

/**
 * Placeholder for a list of rows that share the "title + meta pills + trailing
 * controls" shape (tasks / habits / recycle bin). Rows rise in with a stagger.
 */
export function SkeletonRows({ count = 5, leading = false, padding = '12px 4px' }: SkeletonRowsProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }} role="status" aria-label="加载中" aria-live="polite">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="tf-skeleton-row"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: leading ? '10px' : '12px',
            padding,
            borderBottom: '1px solid var(--border)',
            animationDelay: `${i * 60}ms`,
          }}
        >
          {leading && <Skeleton width={16} height={16} radius="var(--radius-sm)" />}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <Skeleton width={`${44 + (i % 3) * 13}%`} height={13} />
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <Skeleton width={52} height={14} radius="var(--radius-pill)" />
              <Skeleton width={96} height={11} />
            </div>
          </div>
          <Skeleton width={64} height={26} radius="var(--radius-pill)" />
          <Skeleton width={26} height={26} radius="var(--radius-pill)" />
        </div>
      ))}
    </div>
  )
}
