import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

const prefersReduced = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

interface Props {
  value: number
  duration?: number
  style?: CSSProperties
}

/** Animates the displayed number from its previous value up to `value` (easeOutCubic). */
export function CountUp({ value, duration = 900, style }: Props) {
  const [display, setDisplay] = useState(() => (prefersReduced() ? value : 0))
  const fromRef = useRef(0)

  useEffect(() => {
    if (prefersReduced()) {
      setDisplay(value)
      fromRef.current = value
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (value - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
      else fromRef.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])

  return <span style={style}>{display}</span>
}
