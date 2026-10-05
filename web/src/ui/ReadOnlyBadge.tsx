import { Lock } from 'lucide-react'
import { cn } from '../lib/cn'

export interface ReadOnlyBadgeProps {
  className?: string
}

/** A small "Read-only" pill with a lock, shown on tabs and toolbars of system keyspace objects. */
export function ReadOnlyBadge({ className }: ReadOnlyBadgeProps) {
  return (
    <span
      title="System keyspaces are read-only in Helenus"
      className={cn('inline-flex shrink-0 items-center gap-1 rounded-lg border border-line px-1.5 text-[11px] leading-[15px] text-muted', className)}
    >
      <Lock size={10} aria-hidden />
      Read-only
    </span>
  )
}
