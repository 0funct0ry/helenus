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
  /** Stack above modal dialogs (z-60 instead of z-40), for popovers opened from inside a Dialog. */
  aboveDialog?: boolean
  role?: string
  'aria-label'?: string
}

/**
 * A floating panel rendered in a portal at fixed coordinates below its anchor. It closes on Escape
 * or a mouse press outside both the panel and the anchor. It never moves focus; callers own that.
 */
export function Popover({ open, onClose, anchorRef, children, align = 'start', matchWidth, className, aboveDialog, role = 'dialog', ...rest }: PopoverProps) {
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

  // Keep wide panels inside the viewport: shift left when the panel would run off the right edge.
  useLayoutEffect(() => {
    const el = ref.current
    if (!open || !el || pos.left === undefined) return
    const over = pos.left + el.offsetWidth + 8 - window.innerWidth
    if (over > 0 && el.offsetWidth > 0) setPos((p) => ({ ...p, left: Math.max(8, (p.left ?? 0) - over) }))
  }, [open, pos.left])

  // Keep tall panels on screen: open upwards when there is no room below, else shift up to fit.
  useLayoutEffect(() => {
    const el = ref.current
    const a = anchorRef.current
    if (!open || !el || !a || el.offsetHeight === 0) return
    const r = a.getBoundingClientRect()
    const h = el.offsetHeight
    if (r.bottom + 4 + h + 8 <= window.innerHeight) return
    const above = r.top - 4 - h
    setPos((p) => ({ ...p, top: above >= 8 ? above : Math.max(8, window.innerHeight - h - 8) }))
  }, [open, anchorRef, children])

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
      style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, minWidth: pos.width }}
      className={cn(aboveDialog ? 'z-[60]' : 'z-40', 'rounded-lg bg-elevated shadow-[var(--shadow)]', className)}
    >
      {children}
    </div>,
    document.body,
  )
}
