import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface TooltipProps {
  /** Tooltip text. */
  content: string
  /** The element to describe; it receives aria-describedby via the wrapper. */
  children: ReactNode
}

/** Shows `content` in a small bubble below the child on hover or keyboard focus; Escape hides it. */
export function Tooltip({ content, children }: TooltipProps) {
  const [show, setShow] = useState(false)
  const id = useId()
  return (
    <span
      className="relative inline-flex"
      aria-describedby={show ? id : undefined}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
      onFocus={() => setShow(true)}
      onBlur={() => setShow(false)}
      onKeyDown={(e) => e.key === 'Escape' && setShow(false)}
    >
      {children}
      {show && (
        <span id={id} role="tooltip" className="pointer-events-none absolute right-0 top-full z-50 mt-1 whitespace-nowrap rounded bg-elevated px-2 py-1 text-[12px] text-fg shadow-[var(--shadow)]">
          {content}
        </span>
      )}
    </span>
  )
}
