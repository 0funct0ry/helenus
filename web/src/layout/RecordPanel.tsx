import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import type { RowFormat } from '../api/types'
import { IconButton } from '../ui/IconButton'
import { Button } from '../ui/Button'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { Popover } from '../ui/Popover'
import { typeFamily } from '../lib/typeFamily'
import { ROW_FORMATS } from '../lib/copyRows'
import { clampRecordPanel, useRecordPanelWidth } from '../lib/useRecordPanelWidth'
import { useToasts } from '../store/toast'
import type { RowMeta } from '../lib/gridEdits'
import type { Column, Row } from '../mocks/types'

export interface RecordPanelProps {
  /** Grid columns in display order. */
  columns: Column[]
  rows: Row[]
  /** Wire values of a displayed row, for pretty-printing collections; null when unknown. */
  wireRow: (row: number) => unknown[] | null
  meta?: RowMeta[]
  /** The rows to step through, and which one is shown. */
  indices: number[]
  position: number
  onStep: (delta: number) => void
  onClose: () => void
  /** Copy the shown row in a Copy As format. */
  onCopyRow: (format: RowFormat, row: number) => void
  /** Why a format is unavailable, or null. */
  formatReason: (format: RowFormat) => string | null
}

const isTruncated = (v: unknown): v is { $truncated: true; bytes: number } => typeof v === 'object' && v !== null && '$truncated' in v

function fieldText(col: Column, wire: unknown, shown: string | number | boolean | null | undefined, changed: boolean): { text: string | null; block: boolean; note?: string } {
  if (shown === null || shown === undefined) return { text: null, block: false }
  const f = typeFamily(col.type)
  if (f === 'blob') {
    const s = String(shown)
    const bytes = isTruncated(wire) ? wire.bytes : Math.max(0, Math.floor((s.replace(/^0x/i, '').replace(/….*$/, '').length) / 2))
    return { text: s, block: true, note: `${bytes} bytes` }
  }
  if (!changed && (f === 'coll' || f === 'udt' || f === 'vec') && wire !== null && wire !== undefined) return { text: JSON.stringify(wire, null, 2), block: true }
  const s = String(shown)
  return { text: s, block: s.length > 60 || s.includes('\n') || f === 'coll' || f === 'udt' || f === 'vec' }
}

/**
 * The read-only record view docked on the right of the grid. One vertical entry per column in grid order:
 * name, key marker, type badge, then the value; long text and collections sit in a wrapped monospace block
 * with their own Copy button, null is a muted "null", blobs show hex and a byte count. ◀ ▶ step through the
 * given rows, "Copy row as" repeats the Copy As formats, and cells with a pending edit show the new value with
 * the changed marker. Drag the left edge (or use arrow keys on it) to resize; the width is remembered.
 * It never edits data. Escape or the close button closes it.
 */
export function RecordPanel({ columns, rows, wireRow, meta, indices, position, onStep, onClose, onCopyRow, formatReason }: RecordPanelProps) {
  const [width, setWidth] = useRecordPanelWidth()
  const [copyOpen, setCopyOpen] = useState(false)
  const copyRef = useRef<HTMLSpanElement>(null)
  const push = useToasts((s) => s.push)
  const row = indices[position]
  const wire = row === undefined ? null : wireRow(row)
  const rm = row === undefined ? undefined : meta?.[row]

  const copyField = (text: string) =>
    navigator.clipboard?.writeText(text).then(
      () => push('Copied value'),
      () => push('Copy failed: the clipboard is not available'),
    )
  const startDrag = (e: ReactMouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const start = width
    const move = (ev: MouseEvent) => setWidth(clampRecordPanel(start + (startX - ev.clientX)))
    const up = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
  }
  const resizeKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowLeft') setWidth(width + 16)
    else if (e.key === 'ArrowRight') setWidth(width - 16)
  }

  return (
    <aside
      aria-label="Record view"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
      style={{ width }}
      className="relative flex min-h-0 flex-none flex-col border-l border-line bg-surface"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize record view"
        aria-valuenow={width}
        tabIndex={0}
        onMouseDown={startDrag}
        onKeyDown={resizeKey}
        className="absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize focus:bg-accent/40 hover:bg-accent/40"
      />
      <div className="flex h-[34px] flex-none items-center gap-1 border-b border-line2 px-2">
        <span className="font-medium">Record</span>
        {indices.length > 1 && (
          <>
            <IconButton label="Previous record" icon={<ChevronLeft size={14} />} disabled={position <= 0} onClick={() => onStep(-1)} />
            <span className="text-xs text-muted" aria-live="polite">
              {position + 1} of {indices.length}
            </span>
            <IconButton label="Next record" icon={<ChevronRight size={14} />} disabled={position >= indices.length - 1} onClick={() => onStep(1)} />
          </>
        )}
        <div className="flex-1" />
        <span ref={copyRef} className="inline-flex">
          <Button variant="ghost" className="h-6" aria-haspopup="menu" aria-expanded={copyOpen} onClick={() => setCopyOpen((o) => !o)}>
            Copy row as ▸
          </Button>
        </span>
        <Popover open={copyOpen} onClose={() => setCopyOpen(false)} anchorRef={copyRef} align="end" role="menu" aria-label="Copy row as" className="p-1">
          {ROW_FORMATS.map(({ format, label }) => {
            const reason = formatReason(format)
            return (
              <button
                key={format}
                role="menuitem"
                type="button"
                aria-disabled={reason ? true : undefined}
                title={reason ?? undefined}
                onClick={() => {
                  if (reason || row === undefined) return
                  setCopyOpen(false)
                  onCopyRow(format, row)
                }}
                className={`flex h-6 w-full items-center whitespace-nowrap rounded px-2 text-left ${reason ? 'cursor-not-allowed opacity-50' : 'hover:bg-hover'}`}
              >
                {label}
              </button>
            )
          })}
        </Popover>
        <IconButton label="Close record view" icon={<X size={14} />} onClick={onClose} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {row === undefined && <p className="text-muted">No row selected.</p>}
        {row !== undefined &&
          columns.map((c, i) => {
            const cm = rm?.cells[c.name]
            const shown = rows[row]?.[c.name]
            const w = wire?.[i]
            const f = fieldText(c, w, shown, !!cm?.changed)
            return (
              <section key={c.name} aria-label={c.name} className={`mb-3 ${cm?.changed ? 'rounded bg-warn-bg px-1.5 py-1' : ''}`} title={cm?.changed ? `Was ${cm.was ?? 'null'}` : undefined}>
                <div className="mb-0.5 flex items-center gap-1.5">
                  <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                  <span className="truncate font-mono text-[12.5px] font-medium">{c.name}</span>
                  <TypeBadge type={c.type} />
                  {cm?.changed && <span className="text-[10.5px] text-warn">changed</span>}
                  <div className="flex-1" />
                  {f.text !== null && <IconButton label={`Copy ${c.name}`} icon={<Copy size={12} />} onClick={() => void copyField(f.text!)} />}
                </div>
                {f.text === null ? (
                  <span className="font-mono text-[12.5px] italic text-dim">null</span>
                ) : f.block ? (
                  <pre className="m-0 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-editor px-2 py-1.5 font-mono text-[12px]">{f.text}</pre>
                ) : (
                  <span className="break-all font-mono text-[12.5px]">{f.text}</span>
                )}
                {f.note && <span className="ml-1 text-xs text-muted">{f.note}</span>}
              </section>
            )
          })}
      </div>
    </aside>
  )
}
