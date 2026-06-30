import { useRef, useEffect } from 'react'
import gsap from 'gsap'
import { Logo } from '@/components/ui/Logo'

interface Props {
  /** logo glyph size in px */
  size?: number
  /** show the "TaskFlow" wordmark beside the glyph */
  wordmark?: boolean
}

/**
 * Logo with a one-time light sweep on mount: a soft highlight glides across the
 * logo (and wordmark) then settles to the static logo. Honors reduced-motion.
 * Does not change the logo's shape — the sweep is a transient overlay.
 */
export function AnimatedLogo({ size = 36, wordmark = false }: Props) {
  const rootRef = useRef<HTMLSpanElement>(null)
  const sheenRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const sheen = sheenRef.current
    if (reduce || !sheen) return
    const ctx = gsap.context(() => {
      gsap.set(sheen, { xPercent: -140, opacity: 0 })
      gsap.timeline()
        .to(sheen, { opacity: 1, duration: 0.25, ease: 'power1.out' })
        .to(sheen, { xPercent: 140, duration: 1.0, ease: 'power2.inOut' }, 0)
        .to(sheen, { opacity: 0, duration: 0.3, ease: 'power1.in' }, 0.7)
    }, rootRef)
    return () => ctx.revert()
  }, [])

  return (
    <span
      ref={rootRef}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        overflow: 'hidden',
        padding: '2px 4px',
      }}
    >
      <Logo size={size} />
      {wordmark && (
        <span style={{
          fontSize: 'var(--text-xl)',
          fontWeight: 'var(--fw-medium)',
          color: 'var(--accent)',
          letterSpacing: '-0.3px',
        }}>
          TaskFlow
        </span>
      )}
      {/* Sweep overlay: a diagonal highlight band that glides across once. */}
      <span
        ref={sheenRef}
        aria-hidden
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: '45%',
          pointerEvents: 'none',
          background:
            'linear-gradient(105deg, transparent 0%, rgba(255,255,255,0.85) 50%, transparent 100%)',
          mixBlendMode: 'overlay',
          opacity: 0,
        }}
      />
    </span>
  )
}
