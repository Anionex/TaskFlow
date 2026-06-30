import { useEffect, useState } from 'react'

/**
 * Tracks whether the viewport is at/below a breakpoint.
 * The app styles inline (no CSS media queries on those elements), so
 * responsive layout decisions are made in JS via this hook.
 * Breakpoint defaults to 640px to match the `.tf-page` CSS breakpoint.
 */
export function useIsMobile(breakpoint = 640): boolean {
  const query = `(max-width: ${breakpoint}px)`
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setIsMobile(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}
