import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

export interface TreeRowProps {
  /** Left padding in px, which sets the nesting depth. */
  indent: number
  label: string
  /** Present for expandable rows; `false` rotates the chevron. */
  expanded?: boolean
  icon?: ReactNode
  /** Right-aligned secondary content (counts, badges). */
  meta?: ReactNode
  /** A leading marker slot (key markers) of fixed width. */
  marker?: ReactNode
  selected?: boolean
  mono?: boolean
  muted?: boolean
  title?: string
  onClick?: () => void
}

/** One 24px row of the schema tree. Rendered as a treeitem button; the selected row gets an accent bar. */
export function TreeRow({ indent, label, expanded, icon, meta, marker, selected, mono, muted, title, onClick }: TreeRowProps) {
  return (
    <button
      type="button"
      role="treeitem"
      aria-expanded={expanded}
      aria-selected={selected ?? false}
      title={title}
      onClick={onClick}
      style={{ paddingLeft: indent }}
      className={cn('relative flex h-6 w-full items-center gap-[5px] whitespace-nowrap pr-2 text-left hover:bg-hover', selected && 'bg-selected')}
    >
      {selected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      {expanded !== undefined && <ChevronDown size={14} className={cn('shrink-0 text-muted transition-transform', !expanded && '-rotate-90')} aria-hidden />}
      {marker !== undefined && <span className="inline-flex w-[26px] shrink-0">{marker}</span>}
      {icon && <span className="shrink-0 text-muted">{icon}</span>}
      <span className={cn('min-w-0 overflow-hidden text-ellipsis', mono && 'font-mono text-[12.5px]', muted && 'text-muted')}>{label}</span>
      {meta !== undefined && <span className="ml-auto pl-2 text-[11.5px] text-faint">{meta}</span>}
    </button>
  )
}
