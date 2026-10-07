import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Copy, Filter as FilterIcon } from 'lucide-react'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'
import { Select } from '../ui/Select'
import { Popover } from '../ui/Popover'
import { GridCell } from './GridCell'
import { typeFamily } from '../lib/typeFamily'
import type { RowMeta } from '../lib/gridEdits'
import { copyRowsAs, formatDisabledReason } from '../lib/copyRows'
import type { RowSource } from '../lib/copyRows'
import { useWorkspace } from '../store/workspace'
import { GridContextMenu } from './GridContextMenu'
import { RecordPanel } from './RecordPanel'
import { RowAggregateDialog } from './RowAggregateDialog'
import { ColumnContextMenu } from './ColumnContextMenu'
import { ColumnFilterPopover } from './ColumnFilterPopover'
import { useColumnView } from '../api/useColumnView'
import { buildViewMap, columnRange, describeFilter, emptyColumnView, SORT_REASON, sortable } from '../lib/columnView'
import type { Filter } from '../lib/columnView'
import { quoteIdent } from '../lib/cqlIdent'
import { useToasts } from '../store/toast'
import type { QueryColumn, RowFormat } from '../api/types'
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

/** What the row menu needs: the wire data behind the displayed rows, and the actions that stage changes. */
export interface GridData {
  /** Wire columns, aligned with `columns`. */
  columns: QueryColumn[]
  /** Wire values of a displayed row (positional), or null when unknown. */
  wireRow: (row: number) => unknown[] | null
  /** The single table the rows came from, or null for ad-hoc results. */
  source: RowSource | null
  /** Add / Clone / Delete; omitted for results that cannot be edited. */
  actions?: { disabledReason: string | null; onAdd: () => void; onClone: (rows: number[]) => void; onDelete: (rows: number[]) => void }
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
  /** Enables the row context menu, record view and aggregate view (SPEC §9.5.1). */
  data?: GridData
  /** Makes the grid editable (the table Data view); omitted for query results, which stay read-only. */
  edit?: GridEdit
  /** Results tab that owns the column selection, sort, filters and hidden columns; without it they live in the grid. */
  tabId?: string
  /** Identity of the statement or table: a different one also shows hidden columns again. */
  viewKey?: string
  /** Identity of the loaded page: when it changes (next page, re-run) selection, sort and filters reset. */
  resetKey?: unknown
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
export function ResultsGrid({ columns, rows, page = 1, elapsedMs, consistency, hasPrev, hasNext, onPrev, onNext, pageSize, onPageSize, showCount, onCount, data, edit, tabId, viewKey, resetKey }: ResultsGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyRef = useRef<HTMLSpanElement>(null)
  const [copyOpen, setCopyOpen] = useState(false)
  const [picked, setPicked] = useState<{ row: number; col: string } | null>(null)
  const [view, setView] = useColumnView(tabId)
  const hiddenKey = view.hidden.join('\u0000')
  const hiddenSet = useMemo(() => new Set(view.hidden), [hiddenKey]) // eslint-disable-line react-hooks/exhaustive-deps
  const visCols = useMemo(() => columns.filter((c) => !hiddenSet.has(c.name)), [columns, hiddenSet])
  const hiddenCount = columns.length - visCols.length
  const colIndex = useMemo(() => new Map(columns.map((c, i) => [c.name, i])), [columns])
  const visIdx = useMemo(() => visCols.map((c) => colIndex.get(c.name)!), [visCols, colIndex])
  const colTypes = useMemo(() => new Map(columns.map((c) => [c.name, c.type])), [columns])
  // reset on a new page or re-run (selection, sort, filters) and on a different statement (hidden columns too)
  useEffect(() => {
    setView((v) => {
      const viewChanged = v.viewKey !== viewKey
      if (!viewChanged && v.resetKey === resetKey) return v
      return { ...emptyColumnView, hidden: viewChanged && v.hidden.length ? [] : v.hidden, viewKey, resetKey }
    })
  }, [viewKey, resetKey, setView])
  const wireAt = (i: number, name: string): unknown => {
    const w = data?.wireRow(i)
    if (w) return w[colIndex.get(name) ?? -1]
    return rows[i]?.[name] ?? null
  }
  const viewMap = useMemo(
    () =>
      buildViewMap({
        count: rows.length,
        pinned: (i) => edit?.meta[i]?.kind === 'new',
        typeOf: (c) => colTypes.get(c),
        wire: wireAt,
        display: (i, c) => {
          const v = rows[i]?.[c]
          return v === null || v === undefined ? null : String(v)
        },
        sort: view.sort,
        filters: view.filters,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, colTypes, view.sort, view.filters, edit?.meta, data?.wireRow],
  )
  const posOf = useMemo(() => {
    const m = new Array<number>(rows.length).fill(-1)
    viewMap.forEach((src, d) => (m[src] = d))
    return m
  }, [viewMap, rows.length])
  const displayRows = useMemo(() => viewMap.map((i) => rows[i]), [viewMap, rows])
  /** Row selection by source index; display position is only for rendering. */
  const [sel, setSel] = useState<number[]>([])
  const [last, setLast] = useState<number | null>(null)
  const [anchorRow, setAnchorRow] = useState<number | null>(null)
  const selSet = useMemo(() => new Set(sel), [sel])
  const inRange = (src: number) => selSet.has(src)
  const selection = useMemo(() => viewMap.filter((i) => selSet.has(i)), [viewMap, selSet])
  const clearColumns = () => setView((v) => (v.selected.length ? { ...v, selected: [], anchor: null } : v))
  const selectRows = (from: number, to: number) => {
    const a = posOf[from]
    const b = posOf[to]
    if (a < 0 || b < 0) return
    setSel(viewMap.slice(Math.min(a, b), Math.max(a, b) + 1))
    setLast(to)
    setAnchorRow(from)
    clearColumns()
    edit?.onSelectRow?.(to)
  }
  // rows hidden by a filter leave the selection, so row actions never touch invisible rows
  useEffect(() => {
    if (!sel.length) return
    const vis = new Set(viewMap)
    const next = sel.filter((i) => vis.has(i))
    if (next.length === sel.length) return
    setSel(next)
    if (!next.length) {
      setLast(null)
      edit?.onSelectRow?.(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMap])
  const selectedCols = useMemo(() => new Set(view.selected), [view.selected])
  const visNames = useMemo(() => visCols.map((c) => c.name), [visCols])
  const [colMenu, setColMenu] = useState<{ x: number; y: number; targets: string[]; col: string } | null>(null)
  const [filterCol, setFilterCol] = useState<string | null>(null)
  const filterAnchor = useRef<HTMLElement | null>(null)
  const push = useToasts((s) => s.push)
  const profile = useWorkspace((s) => s.profileId)
  const [menu, setMenu] = useState<{ x: number; y: number; targets: number[]; row: number; fromHeader: boolean } | null>(null)
  /** Anchor row of a drag that started on a row-number cell; null when no drag is in progress. */
  const dragFrom = useRef<number | null>(null)
  useEffect(() => {
    const stop = () => {
      dragFrom.current = null
    }
    document.addEventListener('mouseup', stop)
    return () => document.removeEventListener('mouseup', stop)
  }, [])
  const [recordOpen, setRecordOpen] = useState(false)
  const [recordPos, setRecordPos] = useState(0)
  const [aggregate, setAggregate] = useState<number[] | null>(null)
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text)
    setCopyOpen(false)
  }
  /** Wire values of the given source rows, projected on the visible columns in grid order. */
  const wireRows = (idx: number[]) => idx.map((i) => data?.wireRow(i)).filter((r): r is unknown[] => !!r).map((r) => visIdx.map((k) => r[k]))
  const visQCols = useMemo(() => (data ? visIdx.map((k) => data.columns[k]) : []), [data, visIdx])
  const keyHidden = columns.some((c) => hiddenSet.has(c.name) && (c.kind === 'partition' || c.kind === 'clustering'))
  const formatReason = (f: RowFormat) => formatDisabledReason(f, data?.source ? { ...data.source, keysComplete: data.source.keysComplete && !keyHidden } : null, visQCols)
  const copyAs = (format: RowFormat, idx: number[]) => {
    setCopyOpen(false)
    if (!data) return
    const rs = wireRows(idx)
    void copyRowsAs(profile, { format, source: data.source ? { keyspace: data.source.keyspace, table: data.source.table } : null, columns: visQCols, rows: rs, counter: data.source?.counter })
  }
  useEffect(() => setRecordPos(0), [sel])
  useEffect(() => {
    const el = scrollRef.current
    if (!menu || !el) return
    const close = () => setMenu(null)
    el.addEventListener('scroll', close)
    return () => el.removeEventListener('scroll', close)
  }, [menu])

  const defs = useMemo(
    () =>
      visCols.map((c) =>
        helper.accessor((r) => r[c.name] ?? null, {
          id: c.name,
          header: c.name,
          size: widthFor(c),
          cell: (ctx) => <GridCell column={c} value={ctx.getValue() as CellValue} />,
          meta: c,
        }),
      ),
    [visCols],
  )
  const table = useReactTable({ data: displayRows, columns: defs, getCoreRowModel: getCoreRowModel() })
  const tableRows = table.getRowModel().rows
  const virt = useVirtualizer({
    count: tableRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
    initialRect: { width: 1000, height: 600 },
  })
  /** Open the row menu for source row `row`: a row inside the selection acts on all of it, any other row replaces the selection first. */
  const openMenu = (x: number, y: number, row: number, col?: string, fromHeader = false) => {
    let targets = selection
    if (!inRange(row)) {
      selectRows(row, row)
      setPicked(col ? { row, col } : null)
      targets = [row]
    }
    setMenu({ x, y, targets, row, fromHeader })
  }
  const recordIdx = selection.length > 1 ? selection : viewMap
  const recordShown = selection.length > 1 ? recordPos : Math.max(0, last === null ? 0 : posOf[last])
  const stepRecord = (d: number) => {
    if (selection.length > 1) setRecordPos((p) => Math.min(selection.length - 1, Math.max(0, p + d)))
    else {
      const n = viewMap[Math.min(viewMap.length - 1, Math.max(0, recordShown + d))]
      if (n === undefined) return
      selectRows(n, n)
      setPicked(null)
    }
  }
  const selectColumn = (name: string, e: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    setPicked(null)
    setSel([])
    setLast(null)
    edit?.onSelectRow?.(null)
    setView((v) => {
      if (e.ctrlKey || e.metaKey) return { ...v, selected: v.selected.includes(name) ? v.selected.filter((n) => n !== name) : [...v.selected, name], anchor: name }
      if (e.shiftKey && v.anchor && visNames.includes(v.anchor)) return { ...v, selected: columnRange(visNames, v.anchor, name) }
      return { ...v, selected: [name], anchor: name }
    })
  }
  const copyNames = (names: string[]) => {
    const text = names.map(quoteIdent).join(', ')
    const ok = () => push(`Copied ${names.length === 1 ? 'column name' : `${names.length} column names`}`)
    if (!navigator.clipboard) return push('Copy failed: the clipboard is not available')
    navigator.clipboard.writeText(text).then(ok, () => push('Copy failed: the clipboard is not available'))
  }
  const copyColumns = (format: RowFormat, names: string[]) => {
    if (!data) return
    const ks = visCols.filter((c) => names.includes(c.name)).map((c) => colIndex.get(c.name)!)
    const rs = viewMap
      .filter((i) => edit?.meta[i]?.kind !== 'new')
      .map((i) => data.wireRow(i))
      .filter((r): r is unknown[] => !!r)
      .map((r) => ks.map((k) => r[k]))
    void copyRowsAs(profile, { format, source: null, columns: ks.map((k) => data.columns[k]), rows: rs }, 'column')
  }
  const openFilter = (name: string) => {
    filterAnchor.current = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-colheader]') ?? [])].find((n) => n.dataset.colheader === name) ?? null
    setFilterCol(name)
  }
  const setFilter = (name: string, f: Filter | null) =>
    setView((v) => {
      const filters = { ...v.filters }
      if (f) filters[name] = f
      else delete filters[name]
      return { ...v, filters }
    })
  const filterCount = Object.keys(view.filters).length
  const total = RN_W + visCols.reduce((n, c) => n + widthFor(c), 0)
  const template = `${RN_W}px ${visCols.map((c) => `${widthFor(c)}px`).join(' ')}`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
      <div
        ref={scrollRef}
        tabIndex={edit || data ? 0 : undefined}
        onContextMenu={(e) => {
          if (data) e.preventDefault()
        }}
        onKeyDown={(e) => {
          if (data && last !== null && ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu')) {
            e.preventDefault()
            const rowEl = scrollRef.current?.querySelector<HTMLElement>(`[role="row"][aria-rowindex="${posOf[last] + 2}"]`)
            const r = rowEl?.getBoundingClientRect() ?? scrollRef.current!.getBoundingClientRect()
            openMenu(r.left + RN_W, r.bottom, last)
            return
          }
          if (e.key === 'Escape' && recordOpen) {
            setRecordOpen(false)
            return
          }
          if (e.key === 'Escape' && view.selected.length) {
            clearColumns()
            return
          }
          if (!edit || !picked || edit.editing || (e.key !== 'Enter' && e.key !== 'F2') || (e.target as HTMLElement).closest('input, button')) return
          const col = visCols.find((c) => c.name === picked.col)
          const el = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[role="cell"]') ?? [])].find((n) => n.dataset.row === String(picked.row) && n.dataset.col === picked.col)
          if (col && el && edit.readOnlyReason(picked.row, col) === null) {
            e.preventDefault()
            edit.onEditCell(picked.row, col, el)
          }
        }}
        className="min-h-0 min-w-0 flex-1 overflow-auto bg-editor text-[12.5px] outline-none"
      >
        <div role="table" aria-label="Results" aria-rowcount={viewMap.length + 1} aria-colcount={visCols.length + 1} style={{ minWidth: total, width: '100%' }}>
          <div role="rowgroup" className="sticky top-0 z-[2]">
            {table.getHeaderGroups().map((hg) => (
              <div key={hg.id} role="row" style={{ display: 'grid', gridTemplateColumns: template }}>
                <div role="columnheader" className="sticky left-0 z-[3] border-b border-r border-line bg-surface px-2 pb-1 pt-[5px] text-right text-faint">
                  #
                </div>
                {hg.headers.map((h) => {
                  const c = h.column.columnDef.meta as Column
                  const isSel = selectedCols.has(c.name)
                  const dir = view.sort?.column === c.name ? view.sort.dir : null
                  const flt = view.filters[c.name]
                  return (
                    <div
                      key={h.id}
                      role="columnheader"
                      data-colheader={c.name}
                      tabIndex={0}
                      aria-selected={isSel}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                      onClick={(e) => selectColumn(c.name, e)}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setColMenu({ x: e.clientX, y: e.clientY, targets: isSel ? visNames.filter((n) => selectedCols.has(n)) : [c.name], col: c.name })
                      }}
                      onKeyDown={(e) => {
                        const el = e.currentTarget
                        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                          e.preventDefault()
                          const all = [...(scrollRef.current?.querySelectorAll<HTMLElement>('[data-colheader]') ?? [])]
                          all[all.indexOf(el) + (e.key === 'ArrowRight' ? 1 : -1)]?.focus()
                        } else if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          selectColumn(c.name, e)
                        } else if ((e.shiftKey && e.key === 'F10') || e.key === 'ContextMenu') {
                          e.preventDefault()
                          e.stopPropagation()
                          const r = el.getBoundingClientRect()
                          setColMenu({ x: r.left, y: r.bottom, targets: isSel ? visNames.filter((n) => selectedCols.has(n)) : [c.name], col: c.name })
                        }
                      }}
                      className={cn(
                        'cursor-pointer select-none overflow-hidden border-b border-r border-line bg-surface px-2.5 pb-1 pt-[5px] outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-accent',
                        isSel && '!bg-[color-mix(in_srgb,var(--accent)_34%,var(--bg-surface))]',
                      )}
                      style={{ borderRightColor: 'var(--border-variant)' }}
                    >
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                        <span className="font-mono text-[12.5px] font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</span>
                        {dir && (dir === 'asc' ? <ArrowUp size={11} aria-hidden /> : <ArrowDown size={11} aria-hidden />)}
                        {flt && (
                          <button
                            type="button"
                            aria-label={`Filter on ${c.name}: ${describeFilter(c.type, flt)}`}
                            title={describeFilter(c.type, flt)}
                            onClick={(e) => {
                              e.stopPropagation()
                              openFilter(c.name)
                            }}
                            className="inline-flex text-accent"
                          >
                            <FilterIcon size={11} />
                          </button>
                        )}
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
              const src = viewMap[v.index]
              const rm = edit?.meta[src]
              const select = selectRows
              return (
                <div
                  key={src}
                  role="row"
                  aria-rowindex={v.index + 2}
                  onContextMenu={(e) => {
                    if (!data) return
                    e.preventDefault()
                    const cellEl = (e.target as HTMLElement).closest<HTMLElement>('[role="cell"]')
                    openMenu(e.clientX, e.clientY, src, cellEl?.dataset.col, !!(e.target as HTMLElement).closest('[role="rowheader"]'))
                  }}
                  onMouseEnter={() => {
                    if (dragFrom.current !== null) select(dragFrom.current, src)
                  }}
                  className="group absolute left-0 top-0 w-full font-mono"
                  style={{ height: ROW_H, transform: `translateY(${v.start}px)`, display: 'grid', gridTemplateColumns: template }}
                >
                  <div
                    role="rowheader"
                    aria-selected={inRange(src)}
                    title={rm?.error}
                    onMouseDown={(e) => {
                      if (e.button !== 0) return
                      e.preventDefault() // no text selection while dragging over rows
                      setPicked(null)
                      const anchor = e.shiftKey && anchorRow !== null ? anchorRow : src
                      dragFrom.current = anchor
                      select(anchor, src)
                    }}
                    onClick={(e) => {
                      setPicked(null)
                      if (e.shiftKey && anchorRow !== null) select(anchorRow, src)
                      else select(src, src)
                    }}
                    className={cn(
                      'sticky left-0 z-[1] select-none truncate border-b border-r border-line bg-surface pr-2 text-right leading-[26px] text-faint cursor-pointer group-hover:bg-hover',
                      inRange(src) && '!bg-[color-mix(in_srgb,var(--accent)_34%,var(--bg-surface))] font-medium !text-accent shadow-[inset_3px_0_0_var(--accent)]',
                      rm?.kind === 'new' && 'shadow-[inset_2px_0_0_var(--success)] text-ok',
                      rm?.kind === 'deleted' && 'shadow-[inset_2px_0_0_var(--error)]',
                    )}>
                    {rm?.kind === 'new' ? '+' : v.index + 1}
                  </div>
                  {row.getVisibleCells().map((cell) => {
                    const col = cell.column.columnDef.meta as Column
                    const cm = rm?.cells[col.name]
                    const isPicked = picked?.row === src && picked.col === cell.column.id
                    const isEditing = edit?.editing?.row === src && edit.editing.column === col.name
                    const reason = edit ? edit.readOnlyReason(src, col) : null
                    return (
                      <div
                        key={cell.id}
                        role="cell"
                        data-row={src}
                        data-col={col.name}
                        aria-selected={picked ? isPicked : undefined}
                        aria-readonly={edit && reason ? true : undefined}
                        title={cm?.error ?? (cm?.changed ? `Was ${cm.was ?? 'null'}` : edit && !isEditing && reason ? reason : undefined)}
                        onClick={() => {
                          select(src, src)
                          setPicked({ row: src, col: cell.column.id })
                        }}
                        onDoubleClick={(e) => {
                          if (edit && reason === null) edit.onEditCell(src, col, e.currentTarget)
                        }}
                        className={cn(
                          'truncate border-b border-r px-2.5 leading-[26px]',
                          inRange(src) || selectedCols.has(col.name) ? 'bg-[color-mix(in_srgb,var(--accent)_24%,transparent)]' : 'group-hover:bg-[var(--active-line)]',
                          isPicked && 'outline outline-1 -outline-offset-1 outline-accent',
                          rm?.kind === 'new' && 'bg-ok-bg',
                          rm?.kind === 'deleted' && 'bg-err-bg text-dim line-through',
                          cm?.changed && 'bg-warn-bg',
                          cm?.error && 'outline outline-1 -outline-offset-1 outline-danger',
                          isEditing && '!bg-accent-bg !p-0 shadow-[inset_0_0_0_1px_var(--accent)]',
                        )}
                        style={{ borderColor: 'var(--border-variant)' }}
                      >
                        {isEditing && edit?.renderEditor ? edit.renderEditor(src, col) : flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {data && recordOpen && last !== null && (
        <RecordPanel
          columns={columns}
          rows={rows}
          wireRow={data.wireRow}
          meta={edit?.meta}
          indices={recordIdx}
          position={recordShown}
          onStep={stepRecord}
          onClose={() => setRecordOpen(false)}
          onCopyRow={(f, row) => copyAs(f, [row])}
          formatReason={formatReason}
        />
      )}
      </div>
      <div className="flex h-[30px] flex-none items-center gap-3 border-t border-line2 bg-surface px-2.5 text-xs text-muted">
        {filterCount > 0 ? (
          <span>
            Filtered: {viewMap.length} of {rows.length} rows on this page{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => setView((v) => ({ ...v, filters: {} }))}>
              Clear filters
            </button>
          </span>
        ) : (
          <span>{rows.length} rows on this page</span>
        )}
        {view.sort && <span>Sorted on this page only</span>}
        {hiddenCount > 0 && (
          <span>
            {hiddenCount} {hiddenCount === 1 ? 'column' : 'columns'} hidden ·{' '}
            <button type="button" className="text-accent hover:underline" onClick={() => setView((v) => ({ ...v, hidden: [] }))}>
              Show all
            </button>
          </span>
        )}
        <span>Page {page}</span>
        {elapsedMs !== undefined && <span>{elapsedMs} ms</span>}
        {consistency && <span>{consistency}</span>}
        {showCount && (
          <Button variant="ghost" className="h-5" disabled={!onCount} onClick={onCount}>
            Count rows
          </Button>
        )}
        <span ref={copyRef} className="inline-flex">
          <Button variant="ghost" className="h-5" icon={<Copy size={12} />} disabled={last === null} aria-haspopup="menu" aria-expanded={copyOpen} onClick={() => setCopyOpen((o) => !o)}>
            Copy
          </Button>
        </span>
        <Popover open={copyOpen} onClose={() => setCopyOpen(false)} anchorRef={copyRef} role="menu" aria-label="Copy" className="p-1">
          {[
            { label: 'Copy cell', disabled: !picked, run: () => picked && copy(String(rows[picked.row][picked.col] ?? '')) },
            { label: 'Copy row as JSON', disabled: last === null || !data, run: () => last !== null && copyAs('json', [last]) },
            { label: 'Copy selection as TSV', disabled: last === null || !data, run: () => copyAs('tsv', selection) },
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
      {menu && data && (
        <GridContextMenu
          x={menu.x}
          y={menu.y}
          count={menu.targets.length}
          editDisabledReason={data.actions ? data.actions.disabledReason : 'Rows can only be changed from a table’s Data view.'}
          formatReason={formatReason}
          onClose={() => setMenu(null)}
          onSelectRow={menu.fromHeader ? () => { setPicked(null); selectRows(menu.row, menu.row) } : undefined}
          onAdd={() => data.actions?.onAdd()}
          onClone={() => data.actions?.onClone(menu.targets)}
          onDelete={() => data.actions?.onDelete(menu.targets)}
          onCopyAs={(f) => copyAs(f, menu.targets)}
          onRecordView={() => setRecordOpen(true)}
          onAggregateView={() => setAggregate(menu.targets)}
        />
      )}
      {colMenu && (
        <ColumnContextMenu
          x={colMenu.x}
          y={colMenu.y}
          targets={colMenu.targets}
          sortReason={sortable(colTypes.get(colMenu.col) ?? '') ? null : SORT_REASON}
          sorted={!!view.sort}
          alreadySelected={colMenu.targets.length === view.selected.length && colMenu.targets.every((n) => selectedCols.has(n))}
          hideReason={colMenu.targets.length >= visCols.length ? 'At least one column must stay visible' : null}
          anyHidden={hiddenCount > 0}
          copyReason={data ? null : 'Not available for this preview'}
          onClose={() => setColMenu(null)}
          onCopyNames={() => copyNames(colMenu.targets)}
          onSelect={() => {
            setPicked(null)
            setSel([])
            setLast(null)
            edit?.onSelectRow?.(null)
            setView((v) => ({ ...v, selected: colMenu.targets, anchor: colMenu.targets[0] }))
          }}
          onSort={(dir) => setView((v) => (v.sort?.column === colMenu.col && v.sort.dir === dir ? v : { ...v, sort: { column: colMenu.col, dir } }))}
          onClearSort={() => setView((v) => ({ ...v, sort: null }))}
          onFilter={() => openFilter(colMenu.col)}
          onCopyAs={(f) => copyColumns(f, colMenu.targets)}
          onHide={() =>
            setView((v) => ({ ...v, hidden: [...v.hidden, ...colMenu.targets.filter((n) => !v.hidden.includes(n))], selected: v.selected.filter((n) => !colMenu.targets.includes(n)) }))
          }
          onShowAll={() => setView((v) => ({ ...v, hidden: [] }))}
        />
      )}
      {filterCol && colTypes.has(filterCol) && (
        <ColumnFilterPopover
          open
          anchorRef={filterAnchor}
          column={{ name: filterCol, type: colTypes.get(filterCol)! }}
          filter={view.filters[filterCol]}
          onApply={(f) => {
            setFilter(filterCol, f)
            setFilterCol(null)
          }}
          onClear={() => {
            setFilter(filterCol, null)
            setFilterCol(null)
          }}
          onClose={() => setFilterCol(null)}
        />
      )}
      {data && (
        <RowAggregateDialog open={!!aggregate} onClose={() => setAggregate(null)} profile={profile} columns={visQCols} rows={aggregate ? wireRows(aggregate) : []} />
      )}
    </div>
  )
}
