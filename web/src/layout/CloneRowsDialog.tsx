import { useCallback, useEffect, useMemo, useState } from 'react'
import type { QueryColumn } from '../api/types'
import { Dialog } from '../ui/Dialog'
import { Button } from '../ui/Button'
import { KeyMarker } from '../ui/KeyMarker'
import { ScalarInput } from './ScalarInput'
import { InputValidity } from '../lib/inputValidity'
import { formatCell } from '../lib/cellFormat'
import { canonical, isComposite } from '../lib/valueModel'

export interface CloneRowsDialogProps {
  open: boolean
  onClose: () => void
  /** The table's columns with kinds and types (from a query result). */
  columns: QueryColumn[]
  /** The source rows as column → value maps, in grid order. */
  rows: Record<string, unknown>[]
  /** Called with one full set of values per new row (nulls and truncated blobs omitted). */
  onConfirm: (rows: Record<string, unknown>[]) => void
}

const isTruncated = (v: unknown) => typeof v === 'object' && v !== null && '$truncated' in v

/**
 * The "Clone N rows" dialog: lists each source row with its primary-key columns as editable inputs; every
 * non-key value is copied as is. A new key must differ from its source row's key and from every other new
 * key, because a CQL insert with an existing key would silently overwrite that row. Confirm stays disabled
 * until all keys are valid, then stages one insert per row.
 */
export function CloneRowsDialog({ open, onClose, columns, rows, onConfirm }: CloneRowsDialogProps) {
  const keys = useMemo(() => columns.filter((c) => c.kind === 'partition' || c.kind === 'clustering'), [columns])
  const [keyValues, setKeyValues] = useState<Record<string, unknown>[]>([])
  const [invalid, setInvalid] = useState<Record<string, string>>({})

  useEffect(() => {
    if (open) {
      setKeyValues(rows.map((r) => Object.fromEntries(keys.map((k) => [k.name, r[k.name] ?? null]))))
      setInvalid({})
    }
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const report = useCallback((id: string, error: string | null) => {
    setInvalid((prev) => {
      if (error === null) {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      }
      return prev[id] === error ? prev : { ...prev, [id]: error }
    })
  }, [])

  const tuple = (kv: Record<string, unknown>) => canonical(keys.map((k) => kv[k.name] ?? null))
  const problems = rows.map((src, i) => {
    const kv = keyValues[i]
    if (!kv) return null
    if (keys.some((k) => kv[k.name] === null || kv[k.name] === undefined || kv[k.name] === '')) return 'Fill in every key column'
    const mine = tuple(kv)
    if (mine === tuple(src)) return 'The key is the same as the source row, so the insert would overwrite it'
    const other = keyValues.findIndex((o, j) => j !== i && tuple(o) === mine)
    if (other >= 0) return `The key is the same as new row ${other + 1}`
    return null
  })
  const valid = keyValues.length === rows.length && problems.every((p) => p === null) && Object.keys(invalid).length === 0

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Clone ${rows.length} rows`}
      subtitle="Give each new row its own primary key"
      width="min(720px, 94vw)"
      footer={
        <>
          <div className="flex-1" />
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={() => {
              onConfirm(
                rows.map((src, i) => {
                  const all = { ...src, ...keyValues[i] }
                  return Object.fromEntries(Object.entries(all).filter(([, v]) => v !== null && v !== undefined && !isTruncated(v)))
                }),
              )
              onClose()
            }}
          >
            Stage {rows.length} inserts
          </Button>
        </>
      }
    >
      <InputValidity.Provider value={report}>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
          {rows.map((_, i) => (
            <fieldset key={i} className="mb-3 rounded-md border border-line px-3 py-2">
              <legend className="px-1 text-xs text-muted">New row {i + 1}</legend>
              {keys.map((k) => (
                <div key={k.name} className="my-1.5 grid items-center gap-3" style={{ gridTemplateColumns: '170px 1fr' }}>
                  <span className="flex items-center gap-1.5">
                    <KeyMarker kind={k.kind ?? 'regular'} position={k.position} order={k.order} />
                    <span className="truncate font-mono text-[12.5px]" title={k.name}>{k.name}</span>
                  </span>
                  {isComposite(k.type) ? (
                    <span className="truncate font-mono text-[12.5px] text-muted">{formatCell(k.type, keyValues[i]?.[k.name] ?? null)}</span>
                  ) : (
                    <ScalarInput
                      aria-label={`${k.name} (new row ${i + 1})`}
                      type={k.type}
                      value={keyValues[i]?.[k.name] ?? null}
                      flagged={!!problems[i]}
                      onChange={(v) => setKeyValues((cur) => cur.map((o, j) => (j === i ? { ...o, [k.name]: v } : o)))}
                    />
                  )}
                </div>
              ))}
              {problems[i] && <p role="alert" className="mt-1 text-xs text-danger">{problems[i]}</p>}
            </fieldset>
          ))}
        </div>
      </InputValidity.Provider>
    </Dialog>
  )
}
