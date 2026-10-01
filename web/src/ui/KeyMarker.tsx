import { ArrowDownWideNarrow, ArrowUpNarrowWide, KeyRound } from 'lucide-react'
import type { ColumnKind } from '../mocks/types'

export interface KeyMarkerProps {
  /** Column kind. `regular` renders nothing. */
  kind: ColumnKind
  /** 1-based position in the partition or clustering key. */
  position?: number
  /** Clustering order; selects the sort icon direction. Defaults to ASC. */
  order?: 'ASC' | 'DESC'
}

/**
 * Marker for a column's role: partition key (filled accent key icon plus position), clustering key
 * (sort icon showing ASC/DESC plus position), static (an `S` pill), or nothing for regular columns.
 */
export function KeyMarker({ kind, position, order = 'ASC' }: KeyMarkerProps) {
  const base = 'inline-flex items-center gap-0.5 font-mono text-[10.5px] font-medium'
  if (kind === 'partition') {
    return (
      <span className={`${base} text-accent`} role="img" aria-label={`Partition key ${position ?? ''}`.trim()} title="Partition key">
        <KeyRound size={12} fill="currentColor" />
        {position}
      </span>
    )
  }
  if (kind === 'clustering') {
    const Icon = order === 'DESC' ? ArrowDownWideNarrow : ArrowUpNarrowWide
    return (
      <span className={`${base} text-syn-const`} role="img" aria-label={`Clustering key ${position ?? ''} ${order}`.replace(/\s+/g, ' ').trim()} title={`Clustering key ${order}`}>
        <Icon size={12} />
        {position}
      </span>
    )
  }
  if (kind === 'static') {
    return (
      <span className={`${base} rounded-[3px] border border-line px-[3px] leading-[13px] text-muted`} role="img" aria-label="Static column" title="Static column">
        S
      </span>
    )
  }
  return null
}
