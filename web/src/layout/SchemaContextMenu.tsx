import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
}

export interface SchemaContextMenuProps {
  /** Viewport position of the right-click. */
  x: number
  y: number
  /** Accessible name, e.g. the object the menu belongs to. */
  label: string
  items: ContextMenuItem[]
  onClose: () => void
}

/**
 * The schema tree's right-click menu: a small `menu` of `menuitem` buttons in a portal at the click
 * position (never a native context menu). Arrow keys move, Enter picks, Escape or a press outside
 * closes it. Focus goes to the first item on open.
 */
export function SchemaContextMenu({ x, y, label, items, onClose }: SchemaContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState(0)

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [onClose])

  const move = (to: number) => {
    const n = (to + items.length) % items.length
    setActive(n)
    ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]')[n]?.focus()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(active + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(active - 1)
    }
  }

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKey}
      style={{ position: 'fixed', top: Math.min(y, window.innerHeight - items.length * 28 - 12), left: Math.min(x, window.innerWidth - 200) }}
      className="z-50 min-w-[180px] rounded-lg bg-elevated py-1 shadow-[var(--shadow)]"
    >
      {items.map((it, i) => (
        <button
          key={it.label}
          type="button"
          role="menuitem"
          tabIndex={i === active ? 0 : -1}
          onClick={() => {
            onClose()
            it.onSelect()
          }}
          className="flex h-7 w-full items-center gap-2 px-3 text-left hover:bg-hover focus:bg-hover focus:outline-none"
        >
          <span className="text-muted">{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>,
    document.body,
  )
}
