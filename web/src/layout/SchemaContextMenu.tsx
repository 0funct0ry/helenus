import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronRight } from 'lucide-react'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  /** Run when the item is picked. Items with `children` open their flyout instead. */
  onSelect?: () => void
  /** Draw a separator line above this item. */
  separatorBefore?: boolean
  /** Use the danger colour (destructive actions). */
  danger?: boolean
  /** A flyout submenu, opened by hover, click, Enter or the Right arrow key. */
  children?: ContextMenuItem[]
  /** Greyed out and not selectable. */
  disabled?: boolean
  /** Why the item is disabled, shown as its tooltip. */
  disabledReason?: string
}

export interface SchemaContextMenuProps {
  /** Viewport position of the right-click, or the bottom-left corner of the button that opened the menu. */
  x: number
  y: number
  /** Accessible name, e.g. the object the menu belongs to. */
  label: string
  /** Optional heading line at the top of the menu, e.g. "3 rows". */
  header?: string
  items: ContextMenuItem[]
  onClose: () => void
}

const ITEM_H = 28
const ITEMS = (el: Element | null, level: number) =>
  [...(el?.querySelectorAll<HTMLElement>(`[role="menuitem"][data-level="${level}"]`) ?? [])]

/** The next enabled index from `from` in direction `dir`, wrapping; -1 when every item is disabled. */
function step(items: ContextMenuItem[], from: number, dir: 1 | -1): number {
  for (let i = 1; i <= items.length; i++) {
    const n = (from + dir * i + items.length * i) % items.length
    if (!items[n].disabled) return n
  }
  return -1
}

/**
 * A small `menu` of `menuitem` buttons in a portal at the pointer (never a native context menu). Used
 * by the schema tree and the results grid. Arrow keys move over enabled items, Enter picks, Right and Left
 * open and close a flyout submenu (`children`), Escape or a press outside closes it. Disabled items show
 * their `disabledReason` as a tooltip. A flyout flips to the left when it would overflow the viewport.
 */
export function SchemaContextMenu({ x, y, label, header, items, onClose }: SchemaContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const flyRef = useRef<HTMLDivElement>(null)
  const first = items.findIndex((i) => !i.disabled)
  const [active, setActive] = useState(Math.max(first, 0))
  const [open, setOpen] = useState<number | null>(null)
  const [subActive, setSubActive] = useState(0)
  const [flip, setFlip] = useState(false)
  const focusFlyout = useRef(false)

  useEffect(() => {
    ITEMS(ref.current, 0)[Math.max(first, 0)]?.focus()
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose])

  useLayoutEffect(() => {
    if (open === null) return
    const r = flyRef.current?.getBoundingClientRect()
    setFlip(!!r && r.right > window.innerWidth)
    if (focusFlyout.current) ITEMS(flyRef.current, 1)[subActive]?.focus()
    focusFlyout.current = false
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const focusTop = (i: number) => {
    setActive(i)
    ITEMS(ref.current, 0)[i]?.focus()
  }
  const focusSub = (i: number) => {
    setSubActive(i)
    ITEMS(flyRef.current, 1)[i]?.focus()
  }
  const openSub = (i: number) => {
    const kids = items[i].children
    if (!kids || items[i].disabled) return
    setOpen(i)
    const k = kids.findIndex((c) => !c.disabled)
    setSubActive(Math.max(k, 0))
    focusFlyout.current = true
  }
  const closeSub = () => {
    if (open === null) return
    const i = open
    setOpen(null)
    focusTop(i)
  }

  const onKey = (e: KeyboardEvent) => {
    const inSub = open !== null && (e.target as HTMLElement).closest('[data-flyout]')
    const kids = open !== null ? (items[open].children ?? []) : []
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const dir = e.key === 'ArrowDown' ? 1 : -1
      if (inSub) {
        const n = step(kids, subActive, dir)
        if (n >= 0) focusSub(n)
      } else {
        const n = step(items, active, dir)
        if (n >= 0) focusTop(n)
      }
    } else if (e.key === 'ArrowRight' && !inSub && items[active]?.children) {
      e.preventDefault()
      openSub(active)
    } else if (e.key === 'ArrowLeft' && inSub) {
      e.preventDefault()
      closeSub()
    }
  }

  const pick = (it: ContextMenuItem) => {
    onClose()
    it.onSelect?.()
  }
  const rowClass = (it: ContextMenuItem) =>
    `flex h-7 w-full items-center gap-2 px-3 text-left focus:outline-none ${it.disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-hover focus:bg-hover'} ${it.danger ? 'text-danger' : ''}`
  const maxH = (header ? ITEM_H : 0) + items.length * ITEM_H + 12

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKey}
      style={{ position: 'fixed', top: Math.max(0, Math.min(y, window.innerHeight - maxH)), left: Math.max(0, Math.min(x, window.innerWidth - 200)) }}
      className="z-50 min-w-[180px] rounded-lg bg-elevated py-1 shadow-[var(--shadow)]"
    >
      {header && <div className="px-3 pb-1 pt-0.5 text-[11px] font-medium uppercase tracking-wide text-muted">{header}</div>}
      {items.map((it, i) => (
        <Fragment key={it.label}>
          {it.separatorBefore && <div role="separator" className="my-1 h-px bg-line2" />}
          <div className="relative" onMouseEnter={() => (it.children ? openSub(i) : setOpen(null))}>
            <button
              type="button"
              role="menuitem"
              data-level={0}
              tabIndex={i === active ? 0 : -1}
              aria-disabled={it.disabled || undefined}
              aria-haspopup={it.children ? 'menu' : undefined}
              aria-expanded={it.children ? open === i : undefined}
              title={it.disabled ? it.disabledReason : undefined}
              onClick={() => {
                if (it.disabled) return
                if (it.children) openSub(i)
                else pick(it)
              }}
              className={rowClass(it)}
            >
              <span className={it.danger ? '' : 'text-muted'}>{it.icon}</span>
              <span className="flex-1">{it.label}</span>
              {it.children && <ChevronRight size={12} className="text-muted" aria-hidden />}
            </button>
            {it.children && open === i && (
              <div
                ref={flyRef}
                role="menu"
                data-flyout
                aria-label={it.label}
                className={`absolute top-0 z-50 min-w-[180px] rounded-lg bg-elevated py-1 shadow-[var(--shadow)] ${flip ? 'right-full mr-0.5' : 'left-full ml-0.5'}`}
              >
                {it.children.map((c, j) => (
                  <button
                    key={c.label}
                    type="button"
                    role="menuitem"
                    data-level={1}
                    tabIndex={j === subActive ? 0 : -1}
                    aria-disabled={c.disabled || undefined}
                    title={c.disabled ? c.disabledReason : undefined}
                    onClick={() => !c.disabled && pick(c)}
                    className={rowClass(c)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  )
}
