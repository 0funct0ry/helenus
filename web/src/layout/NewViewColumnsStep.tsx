import { Field } from '../ui/Field'
import { KeyMarker } from '../ui/KeyMarker'
import { Select } from '../ui/Select'
import { Toggle } from '../ui/Toggle'
import { TypeBadge } from '../ui/TypeBadge'
import { newViewDraft } from '../lib/viewDraft'
import type { ViewDraft } from '../lib/viewDraft'
import type { Table } from '../lib/schemaModel'

export interface NewViewColumnsStepProps {
  draft: ViewDraft
  onChange: (draft: ViewDraft) => void
  /** Tables of the keyspace that can be a base (counter tables are left out by the caller). */
  tables: Table[]
  /** Visible validation messages by planner field (`name`, `base_table`, `columns`, …). */
  errors: Record<string, string>
}

/**
 * Step 1 of the New view wizard: the view name, the base table, and which base columns the view selects.
 * Picking a base table resets the keys of step 2 to that table's key columns. "All columns" selects `*`
 * (unavailable when the base table has static columns). Key columns are always selected and cannot be unchecked.
 */
export function NewViewColumnsStep({ draft, onChange, tables, errors }: NewViewColumnsStepProps) {
  const base = tables.find((t) => t.name === draft.baseTable)
  const isKey = (n: string) => draft.partitionKey.includes(n) || draft.clustering.some((c) => c.column === n)
  const hasStatic = !!base?.columns.some((c) => c.kind === 'static')
  const toggle = (name: string, on: boolean) => onChange({ ...draft, columns: on ? [...draft.columns, name] : draft.columns.filter((c) => c !== name) })
  return (
    <div>
      <Field label="View name" mono value={draft.name} autoFocus onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      {errors.name && <p className="-mt-2 mb-3 text-xs text-danger">{errors.name}</p>}
      <div className="mb-3 flex flex-col gap-[5px]">
        <span className="text-xs text-muted">Base table</span>
        <Select
          aboveDialog
          mono
          aria-label="Base table"
          value={draft.baseTable}
          options={[{ value: '', label: 'Choose a table…' }, ...tables.map((t) => ({ value: t.name, label: t.name }))]}
          onChange={(name) => onChange({ ...newViewDraft(tables.find((t) => t.name === name)), name: draft.name, ifNotExists: draft.ifNotExists, options: draft.options, extraWhere: draft.extraWhere })}
        />
        {errors.base_table && <p className="m-0 text-xs text-danger">{errors.base_table}</p>}
      </div>
      {base && (
        <section aria-label="Columns">
          <div className="mb-1 flex items-center gap-3">
            <h3 className="m-0 flex-1 text-[13px] font-semibold">Columns</h3>
            <Toggle
              checked={draft.allColumns}
              disabled={hasStatic}
              title={hasStatic ? 'The base table has static columns, which a view cannot include' : undefined}
              onChange={(allColumns) => onChange({ ...draft, allColumns })}
            >
              All columns
            </Toggle>
          </div>
          {errors.columns && <p className="mb-1 mt-0 text-xs text-danger">{errors.columns}</p>}
          <ul className="m-0 list-none p-0">
            {base.columns.map((c) => {
              const key = isKey(c.name)
              const isStatic = c.kind === 'static'
              const checked = draft.allColumns ? !isStatic : key || draft.columns.includes(c.name)
              return (
                <li key={c.name} className="flex items-center gap-2 border-b border-line2 py-1.5">
                  <input
                    type="checkbox"
                    aria-label={`Select ${c.name}`}
                    checked={checked}
                    disabled={draft.allColumns || key || isStatic}
                    title={isStatic ? 'Static columns cannot be in a view' : key ? 'Key columns are always selected' : undefined}
                    onChange={(e) => toggle(c.name, e.target.checked)}
                  />
                  <span className="inline-flex w-[34px] shrink-0">
                    <KeyMarker kind={c.kind} position={c.position} order={c.order} />
                  </span>
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px]">{c.name}</span>
                  <TypeBadge type={c.type} />
                </li>
              )
            })}
          </ul>
        </section>
      )}
    </div>
  )
}
