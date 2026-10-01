import { useMemo, useRef } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { typeFamily } from '../lib/typeFamily'
import { cn } from '../lib/cn'
import type { CellValue, Column, Row } from '../mocks/types'

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
  /** Shows a (disabled in the preview) Count rows button. */
  showCount?: boolean
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

function Cell({ column, value }: { column: Column; value: CellValue }) {
  if (value === null) return <span className="italic text-dim">null</span>
  const f = typeFamily(column.type)
  if (column.kind === 'partition' || column.kind === 'clustering') return <span className="text-muted">{String(value)}</span>
  if (f === 'num' || f === 'counter') return <span className="text-syn-num">{String(value)}</span>
  if (f === 'coll' || f === 'udt' || f === 'vec') return <span className="text-syn-const">{String(value)}</span>
  return <span className="text-syn-str">{String(value)}</span>
}

/**
 * Read-only virtualized result grid. Headers show the kind marker, name and type badge; null is a dim
 * italic "null"; collections and UDTs render as CQL literals. The footer shows row count, page,
 * elapsed time, consistency and paging controls. Row numbers stick to the left, headers to the top.
 */
export function ResultsGrid({ columns, rows, page = 1, elapsedMs, consistency, hasPrev, hasNext, onPrev, onNext, pageSize, onPageSize, showCount }: ResultsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const defs = useMemo(
    () =>
      columns.map((c) =>
        helper.accessor((r) => r[c.name] ?? null, {
          id: c.name,
          header: c.name,
          size: widthFor(c),
          cell: (ctx) => <Cell column={c} value={ctx.getValue() as CellValue} />,
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-editor text-[12.5px]">
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
              return (
                <div
                  key={row.id}
                  role="row"
                  aria-rowindex={v.index + 2}
                  className="group absolute left-0 top-0 w-full font-mono"
                  style={{ height: ROW_H, transform: `translateY(${v.start}px)`, display: 'grid', gridTemplateColumns: template }}
                >
                  <div role="rowheader" className="sticky left-0 z-[1] truncate border-b border-r border-line bg-surface pr-2 text-right leading-[26px] text-faint group-hover:bg-hover">
                    {v.index + 1}
                  </div>
                  {row.getVisibleCells().map((cell) => (
                    <div key={cell.id} role="cell" className={cn('truncate border-b border-r px-2.5 leading-[26px] group-hover:bg-[var(--active-line)]')} style={{ borderColor: 'var(--border-variant)' }}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </div>
                  ))}
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
          <Button variant="ghost" className="h-5" disabled title="Counting rows is not available in the preview">
            Count rows
          </Button>
        )}
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
