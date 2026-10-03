import type { TypeDesc } from '../api/types'
import { TypeBadge } from '../ui/TypeBadge'
import { ElementInput } from './ElementInput'
import { typeToCql } from '../lib/cellFormat'
import type { Crumb } from '../lib/valueModel'

export interface FieldsEditorProps {
  /** The fields to edit: a UDT's named fields, or a tuple's positions named 0, 1, 2… */
  fields: { name: string; type: TypeDesc }[]
  /** An object keyed by field name for a UDT, or an array for a tuple. */
  value: Record<string, unknown> | unknown[] | null
  onChange: (value: Record<string, unknown> | unknown[]) => void
  onDrill: (crumb: Crumb) => void
  /** Edit a tuple (values by position) instead of a UDT (values by name). */
  tuple?: boolean
}

/**
 * Editor for a UDT or a tuple: one labelled input per field with its type badge. An empty input sets the
 * field to null. Fields that are collections or UDTs open a nested editor.
 */
export function FieldsEditor({ fields, value, onChange, onDrill, tuple }: FieldsEditorProps) {
  const get = (f: string, i: number) => (tuple ? (value as unknown[] | null)?.[i] : (value as Record<string, unknown> | null)?.[f]) ?? null
  const set = (f: string, i: number, x: unknown) => {
    if (tuple) onChange(fields.map((_, n) => (n === i ? x : get('', n))))
    else onChange({ ...((value as Record<string, unknown> | null) ?? {}), [f]: x })
  }
  return (
    <ul className="m-0 max-h-[260px] list-none overflow-auto p-0 px-2.5 py-2">
      {fields.map((f, i) => (
        <li key={f.name} className="mb-1.5 grid items-center gap-2" style={{ gridTemplateColumns: '110px 1fr' }}>
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate font-mono text-[12.5px]" title={f.name}>{tuple ? `element ${f.name}` : f.name}</span>
            <TypeBadge type={typeToCql(f.type)} />
          </span>
          <ElementInput
            type={f.type}
            value={get(f.name, i)}
            label={tuple ? `Element ${f.name}` : `Field ${f.name}`}
            optional
            onChange={(x) => set(f.name, i, x)}
            onDrill={() => onDrill({ steps: tuple ? [i] : [f.name], label: tuple ? `element ${f.name}` : f.name })}
          />
        </li>
      ))}
    </ul>
  )
}
