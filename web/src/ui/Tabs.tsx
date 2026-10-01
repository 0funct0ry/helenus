import type { KeyboardEvent, ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface TabItem {
  id: string
  label: ReactNode
  /** Optional trailing count pill. */
  badge?: ReactNode
}

export interface TabsProps {
  items: TabItem[]
  /** Id of the selected item. */
  value: string
  onChange: (id: string) => void
  /** `segment` is a filled pill row; `underline` is for dialogs and forms. */
  variant?: 'segment' | 'underline'
  'aria-label'?: string
  className?: string
}

/** A WAI-ARIA tablist. Left/Right/Home/End move focus and selection. Panels are rendered by the caller. */
export function Tabs({ items, value, onChange, variant = 'segment', className, ...rest }: TabsProps) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = items.findIndex((t) => t.id === value)
    let next: number
    if (e.key === 'ArrowRight') next = (i + 1) % items.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    else return
    e.preventDefault()
    onChange(items[next].id)
    const buttons = e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    buttons[next]?.focus()
  }
  return (
    <div role="tablist" aria-label={rest['aria-label']} onKeyDown={onKey} className={cn('flex gap-0.5', variant === 'underline' && 'border-b border-line2', className)}>
      {items.map((t) => {
        const on = t.id === value
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'inline-flex items-center gap-1.5',
              variant === 'segment'
                ? cn('h-6 rounded px-[9px] hover:bg-hover hover:text-fg', on ? 'bg-selected text-fg' : 'text-muted')
                : cn('-mb-px border-b-2 px-2.5 py-1.5', on ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'),
            )}
          >
            {t.label}
            {t.badge !== undefined && <span className="rounded-lg border border-line px-1.5 text-[11px] leading-[15px] text-muted">{t.badge}</span>}
          </button>
        )
      })}
    </div>
  )
}
