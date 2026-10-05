import { useRef, useState } from 'react'
import { ListPlus, Plus } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { Toggle } from '../ui/Toggle'
import { ColumnRow } from './ColumnRow'
import { SchemaContextMenu } from './SchemaContextMenu'
import { newColumn } from '../lib/tableDraft'
import type { TableDraft } from '../lib/tableDraft'

export interface NewTableColumnsStepProps {
  draft: TableDraft
  onChange: (draft: TableDraft) => void
  udts: string[]
  /** Visible validation messages by planner field (`name`, `columns.0.name`, `columns.0.type`, `columns`). */
  errors: Record<string, string>
}

/**
 * Step 1 of the New table wizard: the table name, IF NOT EXISTS, and an editable column list (add, remove,
 * reorder, type, static). A quick-add menu offers `id uuid`. Removing a column also drops it from the keys.
 */
export function NewTableColumnsStep({ draft, onChange, udts, errors }: NewTableColumnsStepProps) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const quickRef = useRef<HTMLButtonElement>(null)
  const set = (patch: Partial<TableDraft>) => onChange({ ...draft, ...patch })
  const move = (i: number, d: -1 | 1) => {
    const cols = [...draft.columns]
    ;[cols[i], cols[i + d]] = [cols[i + d], cols[i]]
    set({ columns: cols })
  }
  const remove = (i: number) => {
    const id = draft.columns[i].id
    set({ columns: draft.columns.filter((_, n) => n !== i), partitionKey: draft.partitionKey.filter((k) => k !== id), clustering: draft.clustering.filter((c) => c.id !== id) })
  }
  const quickAddId = () => {
    const [only] = draft.columns
    const blank = draft.columns.length === 1 && only.name === '' && only.type.base === 'text'
    set({ columns: [...(blank ? [] : draft.columns), newColumn('id', 'uuid')] })
  }
  return (
    <div>
      <Field label="Table name" mono autoFocus value={draft.name} placeholder="users" aria-invalid={!!errors.name} onChange={(e) => set({ name: e.target.value })} />
      {errors.name && <p className="-mt-2 mb-3 text-xs text-danger">{errors.name}</p>}
      <div className="mb-3">
        <Toggle checked={draft.ifNotExists} onChange={(ifNotExists) => set({ ifNotExists })}>
          Create only if it doesn't exist
        </Toggle>
      </div>
      <h3 className="mb-1 mt-0 text-[13px] font-semibold">Columns</h3>
      {errors.columns && <p className="mb-1 mt-0 text-xs text-danger">{errors.columns}</p>}
      <ul className="m-0 list-none p-0">
        {draft.columns.map((c, i) => (
          <ColumnRow
            key={c.id}
            column={c}
            index={i}
            count={draft.columns.length}
            udts={udts}
            nameError={errors[`columns.${i}.name`]}
            typeError={errors[`columns.${i}.type`]}
            onChange={(next) => set({ columns: draft.columns.map((x) => (x.id === c.id ? next : x)) })}
            onRemove={() => remove(i)}
            onMove={(d) => move(i, d)}
          />
        ))}
      </ul>
      <div className="mt-2 flex gap-2">
        <Button variant="ghost" icon={<Plus size={13} />} onClick={() => set({ columns: [...draft.columns, newColumn()] })}>
          Add column
        </Button>
        <Button
          ref={quickRef}
          variant="ghost"
          icon={<ListPlus size={13} />}
          aria-haspopup="menu"
          onClick={() => {
            const r = quickRef.current?.getBoundingClientRect()
            setMenu({ x: r?.left ?? 0, y: r?.bottom ?? 0 })
          }}
        >
          Quick add
        </Button>
      </div>
      {menu && (
        <SchemaContextMenu
          x={menu.x}
          y={menu.y}
          label="Quick add column"
          items={[{ label: 'id uuid', onSelect: quickAddId }]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
