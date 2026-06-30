import { ReactNode } from 'react'

interface Props {
  children: ReactNode
  /** Narrower max-width for reading/form-heavy pages. Defaults to 1040. */
  width?: number
}

/**
 * Shared page wrapper: centered, max-width, responsive horizontal padding.
 * Used by every app section so all 7 views align consistently.
 */
export function PageContainer({ children, width = 1040 }: Props) {
  return (
    <div className="tf-page">
      <div style={{ maxWidth: width, margin: '0 auto', width: '100%' }}>
        {children}
      </div>
    </div>
  )
}
