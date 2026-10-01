import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, RefObject } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '../lib/cn'

export interface PopoverProps {
  open: boolean
  onClose: () => void
  /** Element the popover is positioned against (usually the trigger button). */
  anchorRef: RefObject<HTMLElement | null>
  children: ReactNode
  /** Which edge of the anchor to align to. */
  align?: 'start' | 'end'
  /** Match the anchor's width (used by Select). */
  matchWidth?: boolean
  className?: string
  role?: string
  'aria-label'?: string
}

/**
 * A floating panel rendered in a portal at fixed coordinates below its anchor. It closes on Escape
 * or a mouse press outside both the panel and the anchor. It never moves focus; callers own that.
 */
export function Popover({ open, onClose, anchorRef, children, align = 'start', matchWidth, className, role = 'dialog', ...rest }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number; width?: number }>({ top: 0 })

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    setPos({
      top: r.bottom + 4,
      left: align === 'start' ? r.left : undefined,
      right: align === 'end' ? window.innerWidth - r.right : undefined,
      width: matchWidth ? r.width : undefined,
    })
  }, [open, anchorRef, align, matchWidth])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        anchorRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onClose, anchorRef])

  if (!open) return null
  return createPortal(
    <div
      ref={ref}
      role={role}
      aria-label={rest['aria-label']}
      style={{ position: 'fixed', ...pos, minWidth: pos.width }}
      className={cn('z-40 rounded-lg bg-elevated shadow-[var(--shadow)]', className)}
    >
      {children}
    </div>,
    document.body,
  )
}
