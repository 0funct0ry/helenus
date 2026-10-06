import { useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight, Copy } from 'lucide-react'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { Popover } from '../ui/Popover'
import { GridCell } from './GridCell'
import { typeFamily } from '../lib/typeFamily'
import type { RowMeta } from '../lib/gridEdits'
import { rowsToTsv } from '../lib/rows'
import { cn } from '../lib/cn'
import type { CellValue, Column, Row } from '../mocks/types'

/** Turns the grid into a spreadsheet: staged edits, read-only reasons, and the editors that open from a cell. */
export interface GridEdit {
  /** One entry per row: its state and staged cell edits. */
  meta: RowMeta[]
  /** Why a cell cannot be edited, or null when it can. */
  readOnlyReason: (row: number, column: Column) => string | null
  /** Double-click, Enter or F2 on an editable cell; `anchor` is the cell element. */
  onEditCell: (row: number, column: Column, anchor: HTMLElement) => void
  /** The cell shown in inline-edit mode, with the editor to render inside it. */
  editing?: { row: number; column: string }
  renderEditor?: (row: number, column: Column) => ReactNode
  /** Called with the selected row index, or null when the selection is cleared. */
  onSelectRow?: (row: number | null) => void
}

export interface ResultsGridProps {
  columns: Column[]
  rows: Row[]
  /** 1-based page number shown in the footer. */
  page?: number
  elapsedMs?: number
  consistency?: string
  hasPrev?: boolean
  hasNext?: boolean
  onPrev?: () => void
  onNext?: () => void
  /** When both are set, a page-size Select is shown in the footer. */
  pageSize?: number
  onPageSize?: (n: number) => void
  /** Shows a Count rows button; it calls `onCount` (disabled when there is no handler). */
  showCount?: boolean
  onCount?: () => void
  /** JSON text for the row at an index, used by "Copy row as JSON". Falls back to the displayed values. */
  rowJson?: (index: number) => string
  /** Makes the grid editable (the table Data view); omitted for query results, which stay read-only. */
  edit?: GridEdit
}

const ROW_H = 26
const RN_W = 44
const helper = createColumnHelper<Row>()

function widthFor(c: Column): number {
  const f = typeFamily(c.type)
  if (f === 'uuid') return 300
  if (f === 'coll' || f === 'vec') return 270
  if (f === 'udt') return 380
  if (f === 'time') return 170
  if (f === 'num' || f === 'counter') return 120
  return 150
}

/**
 * Virtualized result grid, read-only unless an `edit` prop is given. Headers show the kind marker, name and type badge; null is a dim
 * italic "null"; collections and UDTs render as CQL literals. The footer shows row count, page,
 * elapsed time, consistency and paging controls. Row numbers stick to the left, headers to the top.
 */
export function ResultsGrid({ columns, rows, page = 1, elapsedMs, consistency, hasPrev, hasNext, onPrev, onNext, pageSize, onPageSize, showCount, onCount, rowJson, edit }: ResultsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [picked, setPicked] = useState<{ row: number; col: string } | null>(null)
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const inRange = (i: number) => !!range && i >= Math.min(range.from, range.to) && i <= Math.max(range.from, range.to)
  const selectedRows = range ? rows.slice(Math.min(range.from, range.to), Math.max(range.from, range.to) + 1) : []
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopyOpen(false)
  }

  const defs = useMemo(
    () =>
      columns.map((c) =>
        helper.accessor((r) => r[c.name] ?? null, {
          id: c.name,
          header: c.name,
          size: widthFor(c),
          cell: (ctx) => <GridCell column={c} value={ctx.getValue() as CellValue} />,
          meta: c,
        }),
      ),
    [columns],
  )
  const table = useReactTable({ data: rows, columns: defs, getCoreRowModel: getCoreRowModel() })
  const tableRows = table.getRowModel().rows
  const virt = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    initialRect: { width: 1000, height: 600 },
  })
  const total = RN_W + columns.reduce((n, c) => n + widthFor(c), 0)
  const template = `${RN_W}px ${columns.map((c) => `${widthFor(c)}px`).join(' ')}`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        tabIndex={edit ? 0 : undefined}
        onKeyDown={(e) => {
          if (!edit || !picked || edit.editing || (e.key !== 'Enter' && e.key !== 'F2') || (e.target as HTMLElement).closest('input, button')) return
          const col = columns.find((c) => c.name === picked.col)
          const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[role="cell"]') ?? [])].find((n) => n.dataset.row === String(picked.row) && n.dataset.col === picked.col)
          if (col && el && edit.readOnlyReason(picked.row, col) === null) {
            e.preventDefault()
            edit.onEditCell(picked.row, col, el)
          }
        }}
        className="min-h-0 flex-1 overflow-auto bg-editor text-[12.5px] outline-none"
      >
        <div role="table" aria-label="Results" aria-rowcount={rows.length + 1} aria-colcount={columns.length + 1} style={{ minWidth: total, width: '100%' }}>
          <div role="rowgroup" className="sticky top-0 z-[2]">
            {table.getHeaderGroups().map((hg) => (
              <div key={hg.id} role="row" style={{ display: 'grid', gridTemplateColumns: template }}>
                <div role="columnheader" className="sticky left-0 z-[3] border-b border-r border-line bg-surface px-2 pb-1 pt-[5px] text-right text-faint">
                  #
                </div>
                {hg.headers.map((h) => {
                  const c = h.column.columnDef.meta as Column
                  return (
                    <div key={h.id} role="columnheader" className="overflow-hidden border-b border-r border-line bg-surface px-2.5 pb-1 pt-[5px]" style={{ borderRightColor: 'var(--border-variant)' }}>
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                        <span className="font-mono text-[12.5px] font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                      </div>
                      <div className="mt-0.5">
                        <TypeBadge type={c.type} />
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div role="rowgroup" className="relative" style={{ height: virt.getTotalSize() }}>
            {virt.getVirtualItems().map((v) => {
              const row = tableRows[v.index]
              const rm = edit?.meta[v.index]
              const select = (from: number, to: number) => {
                setRange({ from, to })
                edit?.onSelectRow?.(to)
              }
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={v.index + 2}
                  className="group absolute left-0 top-0 w-full font-mono"
                  style={{ height: ROW_H, transform: `translateY(${v.start}px)`, display: 'grid', gridTemplateColumns: template }}
                >
                  <div
                    role="rowheader"
                    aria-selected={inRange(v.index)}
                    title={rm?.error}
                    onClick={(e) => {
                      setPicked(null)
                      if (e.shiftKey && range) select(range.from, v.index)
                      else select(v.index, v.index)
                    }}
                    className={cn(
                      'sticky left-0 z-[1] truncate border-b border-r border-line bg-surface pr-2 text-right leading-[26px] text-faint cursor-pointer group-hover:bg-hover',
                      rm?.kind === 'new' && 'shadow-[inset_2px_0_0_var(--success)] text-ok',
                      rm?.kind === 'deleted' && 'shadow-[inset_2px_0_0_var(--error)]',
                    )}>
                    {rm?.kind === 'new' ? '+' : v.index + 1}
                  </div>
                  {row.getVisibleCells().map((cell) => {
                    const col = cell.column.columnDef.meta as Column
                    const cm = rm?.cells[col.name]
                    const isPicked = picked?.row === v.index && picked.col === cell.column.id
                    const isEditing = edit?.editing?.row === v.index && edit.editing.column === col.name
                    const reason = edit ? edit.readOnlyReason(v.index, col) : null
                    return (
                      <div
                        key={cell.id}
                        role="cell"
                        data-row={v.index}
                        data-col={col.name}
                        aria-selected={picked ? isPicked : undefined}
                        aria-readonly={edit && reason ? true : undefined}
                        title={cm?.error ?? (cm?.changed ? `Was ${cm.was ?? 'null'}` : edit && !isEditing && reason ? reason : undefined)}
                        onClick={() => {
                          setPicked({ row: v.index, col: cell.column.id })
                          select(v.index, v.index)
                        }}
                        onDoubleClick={(e) => {
                          if (edit && reason === null) edit.onEditCell(v.index, col, e.currentTarget)
                        }}
                        className={cn(
                          'truncate border-b border-r px-2.5 leading-[26px] group-hover:bg-[var(--active-line)]',
                          inRange(v.index) && 'bg-[var(--active-line)]',
                          isPicked && 'outline outline-1 -outline-offset-1 outline-accent',
                          rm?.kind === 'new' && 'bg-ok-bg',
                          rm?.kind === 'deleted' && 'bg-err-bg text-dim line-through',
                          cm?.changed && 'bg-warn-bg',
                          cm?.error && 'outline outline-1 -outline-offset-1 outline-danger',
                          isEditing && '!bg-accent-bg !p-0 shadow-[inset_0_0_0_1px_var(--accent)]',
                        )}
                        style={{ borderColor: 'var(--border-variant)' }}
                      >
                        {isEditing && edit?.renderEditor ? edit.renderEditor(v.index, col) : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      <div className="flex h-[30px] flex-none items-center gap-3 border-t border-line2 bg-surface px-2.5 text-xs text-muted">
        <span>{rows.length} rows on this page</span>
        <span>Page {page}</span>
        {elapsedMs !== undefined && <span>{elapsedMs} ms</span>}
        {consistency && <span>{consistency}</span>}
        {showCount && (
          <Button variant="ghost" className="h-5" disabled={!onCount} onClick={onCount}>
            Count rows
          </Button>
        )}
        <span ref={copyRef} className="inline-flex">
          <Button variant="ghost" className="h-5" icon={<Copy size={12} />} disabled={!range} aria-haspopup="menu" aria-expanded={copyOpen} onClick={() => setCopyOpen((o) => !o)}>
            Copy
          </Button>
        </span>
        <Popover open={copyOpen} onClose={() => setCopyOpen(false)} anchorRef={copyRef} role="menu" aria-label="Copy" className="p-1">
          {[
            { label: 'Copy cell', disabled: !picked, run: () => picked && copy(String(rows[picked.row][picked.col] ?? '')) },
            { label: 'Copy row as JSON', disabled: !range, run: () => range && copy(rowJson ? rowJson(range.to) : JSON.stringify(rows[range.to], null, 2)) },
            { label: 'Copy selection as TSV', disabled: !range, run: () => copy(rowsToTsv(columns, selectedRows)) },
          ].map((m) => (
            <button key={m.label} role="menuitem" type="button" disabled={m.disabled} onClick={m.run} className="flex h-6 w-full items-center whitespace-nowrap rounded px-2 text-left hover:bg-hover disabled:opacity-50">
              {m.label}
            </button>
          ))}
        </Popover>
        <div className="ml-auto flex items-center gap-1">
          <IconButton label="Previous page" icon={<ChevronLeft size={14} />} disabled={!hasPrev} onClick={onPrev} />
          {pageSize !== undefined && onPageSize && (
            <Select
              aria-label="Page size"
              value={String(pageSize)}
              onChange={(v) => onPageSize(Number(v))}
              options={[50, 100, 500, 1000].map((n) => ({ value: String(n), label: `${n} per page` }))}
            />
          )}
          <IconButton label="Next page" icon={<ChevronRight size={14} />} disabled={!hasNext} onClick={onNext} />
        </div>
      </div>
    </div>
  )
}
