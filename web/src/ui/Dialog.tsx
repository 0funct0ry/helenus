import { useEffect, useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './IconButton'

export interface DialogProps {
  open: boolean
  onClose: () => void
  /** Heading text; also the dialog's accessible name. */
  title: string
  children: ReactNode
  /** Optional footer row (buttons). */
  footer?: ReactNode
  /** Optional muted text shown beside the title. */
  subtitle?: string
  /** CSS width, e.g. `min(860px, 94vw)`. */
  width?: string
  /** Hide the title row (used by the command palette). */
  bare?: boolean
}

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * A custom modal (not the native dialog element). Renders in a portal with a scrim; focus moves in
 * on open, Tab is trapped, Escape or a scrim click closes, and focus returns to the opener.
 */
export function Dialog({ open, onClose, title, children, footer, subtitle, width = 'min(860px, 94vw)', bare }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement as HTMLElement | null
    const el = ref.current
    // A child that took focus itself (autoFocus) keeps it.
    if (el && el !== document.activeElement && el.contains(document.activeElement)) return () => opener?.focus?.()
    const first = el?.querySelector<HTMLElement>('input, ' + FOCUSABLE)
    ;(first ?? el)?.focus()
    return () => opener?.focus?.()
  }, [open])

  if (!open) return null

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'Tab') {
      const nodes = ref.current?.querySelectorAll<HTMLElement>(FOCUSABLE)
      if (!nodes?.length) return
      const first = nodes[0]
      const last = nodes[nodes.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 pt-[9vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={bare ? undefined : titleId}
        aria-label={bare ? title : undefined}
        tabIndex={-1}
        onKeyDown={onKey}
        style={{ width }}
        className="flex max-h-[80vh] flex-col overflow-hidden rounded-lg bg-elevated shadow-[var(--shadow)] outline-none"
      >
        {!bare && (
          <div className="flex items-center gap-2 border-b border-line2 py-2.5 pl-4 pr-3">
            <h2 id={titleId} className="m-0 text-sm font-semibold">
              {title}
            </h2>
            {subtitle && <span className="flex-1 text-xs text-muted">{subtitle}</span>}
            {!subtitle && <span className="flex-1" />}
            <IconButton label="Close" icon={<X size={14} />} onClick={onClose} />
          </div>
        )}
        {children}
        {footer && <div className="flex items-center gap-2 border-t border-line2 px-3.5 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
