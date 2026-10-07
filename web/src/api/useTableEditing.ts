import { useCallback, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import type { ApplyResponse, QueryResponse, TypeDesc } from './types'
import { describeError } from './client'
import { useChanges } from './hooks'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'
import { cellItemId, deleteItemId, flatten, keyObject, newInsertId, reconcile } from '../lib/changes'
import type { PendingItem } from '../lib/changes'
import { collectionChanges } from '../lib/collectionDiff'
import { inputText } from '../lib/cellInput'
import { editability } from '../lib/editability'
import type { Editability } from '../lib/editability'
import { composeGrid } from '../lib/gridEdits'
import type { RowMeta } from '../lib/gridEdits'
import type { Column as ModelColumn, Keyspace } from '../lib/schemaModel'
import { canonical, isComposite } from '../lib/valueModel'
import type { UdtFields } from '../lib/valueModel'
import type { CellResult } from '../layout/CellEditor'
import type { GridEdit } from '../layout/ResultsGrid'

const NONE: PendingItem[] = []
const NO_ERRORS: Record<string, string> = {}
const isTruncated = (v: unknown) => typeof v === 'object' && v !== null && '$truncated' in v

export interface TableEditingArgs {
  tab: WorkspaceTab
  profile: string
  consistency: string
  response?: QueryResponse
  /** Fetch the current page again (after apply). */
  refetch: () => void
  tableColumns: ModelColumn[]
  isView: boolean
  system: boolean
  /** Counter tables take increments only: no insert, duplicate or delete. */
  counterTable: boolean
  keyspaces?: Keyspace[]
}

/** What the collection popover for the open cell needs. */
export interface CollectionEdit {
  name: string
  type: TypeDesc
  original: unknown
  draft?: unknown
  anchorRef: RefObject<HTMLElement | null>
  onStage: (draft: unknown) => void
  onClose: () => void
}

/**
 * Everything the Data sub-view needs to be editable (SPEC §9.9, §9.10): whether editing is allowed and why
 * not, the grid with staged edits laid over the fetched rows, the inline editor and collection popover for
 * the cell being edited, row actions (insert, duplicate, delete), and apply. Staged edits live in the
 * workspace store so they survive switching tabs.
 */
export function useTableEditing({ tab, profile, consistency, response, refetch, tableColumns, isView, system, counterTable, keyspaces }: TableEditingArgs) {
  const items = useWorkspace((s) => s.edits[tab.id]) ?? NONE
  const errors = useWorkspace((s) => s.editErrors[tab.id]) ?? NO_ERRORS
  const stageEdit = useWorkspace((s) => s.stageEdit)
  const unstageEdit = useWorkspace((s) => s.unstageEdit)
  const setEdits = useWorkspace((s) => s.setEdits)
  const clearEdits = useWorkspace((s) => s.clearEdits)
  const changes = useChanges(profile)

  const [editing, setEditing] = useState<{ row: number; column: string } | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [popover, setPopover] = useState<{ row: number; column: string; el: HTMLElement } | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [inserting, setInserting] = useState<{ initial?: Record<string, unknown>; duplicate?: boolean } | null>(null)
  const [cloning, setCloning] = useState<Record<string, unknown>[] | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [discarding, setDiscarding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const anchor = useRef<HTMLElement | null>(null)

  const ed: Editability = useMemo(() => editability({ isView, system, tableColumns, result: response?.columns }), [isView, system, tableColumns, response])
  const composed = useMemo(() => (response ? composeGrid(response, items, errors) : null), [response, items, errors])

  const udtFields: UdtFields = useCallback(
    (ref) => keyspaces?.find((k) => k.name === ref.keyspace)?.types.find((u) => u.name === ref.name)?.fields.map((f) => ({ name: f.name, type: f.desc ?? { name: 'text' } })),
    [keyspaces],
  )

  const cols = response?.columns
  const meta = (row: number): RowMeta | undefined => composed?.meta[row]
  const rawRow = (row: number) => {
    const src = meta(row)?.source
    return src === null || src === undefined ? undefined : response?.rows[src]
  }

  const readOnlyReason = (row: number, column: { name: string; kind: string }): string | null => {
    const rm = meta(row)
    if (!rm) return 'No such row'
    if (rm.kind === 'new') return 'This row is a staged insert. Discard it to change its values.'
    if (rm.kind === 'deleted') return 'This row is staged for deletion.'
    if (rm.locked) return 'This row’s key holds a blob too large to send back, so the row cannot be edited.'
    if (column.kind === 'partition' || column.kind === 'clustering') return 'Primary key cells are read-only. Use Duplicate row to insert a row with a different key.'
    return null
  }

  const cellItem = (row: number, column: string) => {
    const rm = meta(row)
    return rm?.rowKey ? items.find((i) => i.id === cellItemId(rm.rowKey!, column)) : undefined
  }

  const onEditCell: GridEdit['onEditCell'] = (row, column, el) => {
    const rm = meta(row)
    const raw = rawRow(row)
    const qcol = cols?.find((c) => c.name === column.name)
    if (!rm || !raw || !cols || !qcol) return
    setEditError(null)
    if (isTruncated(raw[cols.indexOf(qcol)])) {
      setEditError(`${column.name} holds a blob too large to edit here.`)
      return
    }
    anchor.current = el
    if (isComposite(qcol.type)) {
      setEditing(null)
      setPopover({ row, column: column.name, el })
    } else {
      setPopover(null)
      setEditing({ row, column: column.name })
    }
  }

  const stageCell = (row: number, column: string, draft: unknown, counter: boolean, parts: Omit<PendingItem['changes'][number], 'key' | 'column'>[]) => {
    const rm = meta(row)
    const raw = rawRow(row)
    if (!rm?.rowKey || !raw || !cols) return
    const id = cellItemId(rm.rowKey, column)
    if (parts.length === 0) {
      unstageEdit(tab.id, id)
      return
    }
    const key = keyObject(cols, raw)
    stageEdit(tab.id, { id, type: 'cell', rowKey: rm.rowKey, column, draft, counter: counter || undefined, changes: parts.map((p) => ({ ...p, key, column })) })
  }

  const commitCell = (row: number, column: string, result: CellResult) => {
    setEditing(null)
    setEditError(null)
    const raw = rawRow(row)
    const idx = cols?.findIndex((c) => c.name === column) ?? -1
    if (!raw || idx < 0) return
    const was = raw[idx] ?? null
    if (result.kind === 'delta') {
      stageCell(row, column, result.value, true, /^[+-]?0+$/.test(result.value) ? [] : [{ kind: 'counter_delta', value: result.value }])
    } else if (result.kind === 'null') {
      stageCell(row, column, null, false, was === null ? [] : [{ kind: 'set_null' }])
    } else {
      stageCell(row, column, result.value, false, canonical(result.value) === canonical(was) ? [] : [{ kind: 'set_cell', value: result.value }])
    }
  }

  const collection: CollectionEdit | null = (() => {
    if (!popover || !cols) return null
    const raw = rawRow(popover.row)
    const qcol = cols.find((c) => c.name === popover.column)
    if (!raw || !qcol) return null
    return {
      name: qcol.name,
      type: qcol.type,
      original: raw[cols.indexOf(qcol)] ?? null,
      draft: cellItem(popover.row, qcol.name)?.draft,
      anchorRef: anchor,
      onClose: () => setPopover(null),
      onStage: (draft: unknown) => {
        const original = raw[cols.indexOf(qcol)] ?? null
        const parts = collectionChanges(qcol.type, original, draft)
        stageCell(popover.row, qcol.name, draft, false, parts)
      },
    }
  })()

  const grid: GridEdit | undefined =
    ed.editable && composed
      ? {
          meta: composed.meta,
          readOnlyReason,
          onEditCell,
          editing: editing ?? undefined,
          onSelectRow: setSelected,
        }
      : undefined

  const selRow = selected !== null ? meta(selected) : undefined
  const canRowAction = ed.editable && !counterTable
  const insertInitial = (row: number): Record<string, unknown> | undefined => {
    const raw = rawRow(row)
    if (!raw || !cols) return undefined
    return Object.fromEntries(cols.map((c, i) => [c.name, raw[i] ?? null]))
  }

  const deleteSelected = () => {
    if (selected === null || !selRow) return
    if (selRow.kind === 'new' && selRow.itemId) unstageEdit(tab.id, selRow.itemId)
    else if (selRow.kind === 'deleted' && selRow.itemId) unstageEdit(tab.id, selRow.itemId)
    else if (selRow.rowKey && cols) {
      const raw = rawRow(selected)
      if (raw) stageEdit(tab.id, { id: deleteItemId(selRow.rowKey), type: 'delete', rowKey: selRow.rowKey, changes: [{ kind: 'delete_row', key: keyObject(cols, raw) }] })
    }
  }

  /** The wire values of the displayed row: a fetched row, or the values of a staged insert. */
  const wireRow = (row: number): unknown[] | null => {
    const rm = meta(row)
    if (!rm || !cols) return null
    if (rm.source !== null) return response?.rows[rm.source] ?? null
    const it = items.find((i) => i.id === rm.itemId)
    return cols.map((c) => it?.values?.[c.name] ?? null)
  }
  const rowValues = (row: number): Record<string, unknown> => {
    const w = wireRow(row)
    return w && cols ? Object.fromEntries(cols.map((c, i) => [c.name, w[i] ?? null])) : {}
  }

  /** Stage a delete for every given row; staged inserts are dropped instead, and rows already staged are left alone. */
  const deleteRows = (rows: number[]) => {
    for (const row of rows) {
      const rm = meta(row)
      const raw = rawRow(row)
      if (!rm || rm.locked) continue
      if (rm.kind === 'new' && rm.itemId) unstageEdit(tab.id, rm.itemId)
      else if (rm.kind === 'row' && rm.rowKey && raw && cols) stageEdit(tab.id, { id: deleteItemId(rm.rowKey), type: 'delete', rowKey: rm.rowKey, changes: [{ kind: 'delete_row', key: keyObject(cols, raw) }] })
    }
  }

  const stageInsert = (values: Record<string, unknown>, ifNotExists: boolean) =>
    stageEdit(tab.id, { id: newInsertId(), type: 'insert', values, changes: [{ kind: 'insert_row', values, if_not_exists: ifNotExists || undefined }] })

  /** Fold an apply response into the staged edits and refetch the page. */
  const handleApplied = (res: ApplyResponse) => {
    const current = useWorkspace.getState().edits[tab.id] ?? []
    const out = reconcile(current, res.results)
    setEdits(tab.id, out.items, out.errors)
    const failed = res.results.find((r) => r.status === 'failed')
    const at = failed ? flatten(current)[failed.index] : undefined
    const item = at ? current.find((i) => i.id === at.itemId) : undefined
    setFailure(failed ? `Change ${failed.index + 1}${item?.column ? ` (${item.column})` : ''} failed: ${failed.error?.message ?? 'unknown error'}` : '')
    refetch()
  }

  const apply = async () => {
    setBusy(true)
    setFailure('')
    try {
      handleApplied(await changes.apply({ keyspace: tab.keyspace, table: tab.object, consistency, changes: flatten(items).map((f) => f.change) }))
    } catch (e) {
      setFailure(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return {
    ed,
    items,
    composed,
    grid,
    editing,
    editError,
    setEditError,
    cancelEdit: () => {
      setEditing(null)
      setEditError(null)
    },
    commitCell,
    editorFor: (row: number, column: string) => {
      const raw = rawRow(row)
      const idx = cols?.findIndex((c) => c.name === column) ?? -1
      const qcol = idx >= 0 ? cols![idx] : undefined
      if (!raw || !qcol) return undefined
      const staged = cellItem(row, column)
      const initial = staged ? (staged.counter ? '' : inputText(staged.draft)) : qcol.type.name === 'counter' ? '' : inputText(raw[idx])
      return { qcol, initial }
    },
    collection,
    udtFields,
    wireRow,
    /** Row menu actions (SPEC §9.5.1): all staged, none executed. `disabledReason` is null when editing is on. */
    rowActions: {
      disabledReason: !ed.editable ? (ed.reason ?? 'Editing is off') : counterTable ? 'Counter tables cannot have rows inserted, cloned or deleted. Edit counters in the grid.' : null,
      onAdd: () => setInserting({}),
      onClone: (rows: number[]) => {
        if (rows.length === 1) setInserting({ initial: rowValues(rows[0]), duplicate: true })
        else if (rows.length > 1) setCloning(rows.map(rowValues))
      },
      onDelete: deleteRows,
    },
    keysComplete: editability({ isView: false, system: false, tableColumns, result: cols }).editable,
    cloning,
    closeClone: () => setCloning(null),
    stageClones: (all: Record<string, unknown>[]) => all.forEach((v) => stageInsert(v, false)),
    toolbar: {
      canInsert: canRowAction,
      canDuplicate: canRowAction && !!selRow && selRow.source !== null && !selRow.locked,
      canDelete: canRowAction && !!selRow && !selRow.locked,
      deleteLabel: selRow?.kind === 'new' ? 'Remove staged row' : selRow?.kind === 'deleted' ? 'Restore row' : 'Delete row',
      insertTitle: !ed.editable ? ed.reason : counterTable ? 'Counter tables cannot have rows inserted or deleted. Edit counters in the grid.' : undefined,
      onInsert: () => setInserting({}),
      onDuplicate: () => selected !== null && setInserting({ initial: insertInitial(selected), duplicate: true }),
      onDelete: deleteSelected,
    },
    inserting,
    closeInsert: () => setInserting(null),
    stageInsert,
    reviewing,
    setReviewing,
    discarding,
    setDiscarding,
    discard: () => {
      clearEdits(tab.id)
      setFailure('')
      setDiscarding(false)
    },
    busy,
    failure,
    apply,
    handleApplied,
    dropFailed: () => {
      const cur = useWorkspace.getState()
      const errs = cur.editErrors[tab.id] ?? {}
      setEdits(tab.id, (cur.edits[tab.id] ?? []).filter((i) => !errs[i.id]))
      setFailure('')
    },
  }
}
