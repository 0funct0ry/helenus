import { ChevronRight, Copy, FileCode2 } from 'lucide-react'
import { Badge } from '../ui/Badge'
import { Button } from '../ui/Button'
import { relativeTime } from '../lib/relativeTime'
import { cn } from '../lib/cn'
import type { SchemaChange } from '../api/types'

export interface SchemaChangeRowProps {
  change: SchemaChange
  expanded: boolean
  onToggle: () => void
  onCopyStatement: () => void
  onOpenReverse: () => void
}

/**
 * One entry of the schema change history: time (absolute on hover), action badge, object, status dot and duration.
 * When expanded it shows the statement, the server error if the statement failed, and the reverse script with its note.
 * "Open reverse in editor" is disabled when no reverse could be derived; it never runs anything.
 */
export function SchemaChangeRow({ change: c, expanded, onToggle, onCopyStatement, onOpenReverse }: SchemaChangeRowProps) {
  const object = [c.keyspace, c.object_name].filter(Boolean).join('.') || c.object_kind
  return (
    <li className="border-b border-line2">
      <button type="button" aria-expanded={expanded} onClick={onToggle} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left hover:bg-hover">
        <ChevronRight size={12} aria-hidden className={cn('shrink-0 text-muted transition-transform', expanded && 'rotate-90')} />
        <span
          role="img"
          aria-label={c.status}
          data-status={c.status}
          className={cn('inline-block size-[7px] shrink-0 rounded-full', c.status === 'ok' ? 'bg-ok' : 'bg-danger')}
        />
        <Badge className="uppercase">{c.action}</Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={object}>
          {object}
        </span>
        <time dateTime={c.created_at} title={new Date(c.created_at).toLocaleString()} className="shrink-0 text-[11px] text-muted">
          {relativeTime(c.created_at)}
        </time>
        <span className="w-9 shrink-0 text-right text-[11px] text-faint">{c.duration_ms} ms</span>
      </button>
      {expanded && (
        <div className="min-w-0 space-y-2 px-3 pb-2.5 pl-6 text-xs">
          <pre className="m-0 whitespace-pre-wrap break-words rounded border border-line bg-editor p-2 font-mono">{c.statement}</pre>
          {c.error && (
            <p role="alert" className="m-0 text-danger">
              {c.error}
            </p>
          )}
          {c.reverse ? (
            <div>
              <div className="mb-1 text-muted">Reverse script</div>
              <pre className="m-0 whitespace-pre-wrap break-words rounded border border-line bg-editor p-2 font-mono">{c.reverse}</pre>
            </div>
          ) : null}
          {c.reverse_note && <p className="m-0 text-muted">{c.reverse_note}</p>}
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={onCopyStatement}>
              <Copy size={12} aria-hidden /> Copy statement
            </Button>
            <Button onClick={onOpenReverse} disabled={!c.reverse} title={c.reverse ? undefined : 'No reverse script for this change'}>
              <FileCode2 size={12} aria-hidden /> Open reverse in editor
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}
