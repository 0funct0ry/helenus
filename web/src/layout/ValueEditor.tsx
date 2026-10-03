import type { TypeDesc } from '../api/types'
import { FieldsEditor } from './FieldsEditor'
import { ListEditor } from './ListEditor'
import { MapEditor } from './MapEditor'
import { SetEditor } from './SetEditor'
import type { Crumb, UdtFields } from '../lib/valueModel'

export interface ValueEditorProps {
  type: TypeDesc
  /** The value in the API's JSON encoding. */
  value: unknown
  onChange: (value: unknown) => void
  /** Open a nested editor for a child that is itself a collection, UDT or tuple. */
  onDrill: (crumb: Crumb) => void
  udtFields?: UdtFields
}

/** Picks the editor for a composite type: list or vector, set, map, UDT fields, or tuple elements. */
export function ValueEditor({ type, value, onChange, onDrill, udtFields }: ValueEditorProps) {
  const arr = Array.isArray(value) ? value : []
  if (type.name === 'list' || type.name === 'vector') return <ListEditor type={type} value={arr} onChange={onChange} onDrill={onDrill} udtFields={udtFields} />
  if (type.name === 'set') return <SetEditor type={type} value={arr} onChange={onChange} onDrill={onDrill} udtFields={udtFields} />
  if (type.name === 'map') return <MapEditor type={type} value={arr as [unknown, unknown][]} onChange={onChange as (v: [unknown, unknown][]) => void} onDrill={onDrill} udtFields={udtFields} />
  if (type.name === 'tuple') {
    return <FieldsEditor tuple fields={(type.args ?? []).map((t, i) => ({ name: String(i), type: t }))} value={arr} onChange={onChange} onDrill={onDrill} />
  }
  if (type.udt) {
    return <FieldsEditor fields={udtFields?.(type.udt) ?? []} value={value as Record<string, unknown> | null} onChange={onChange} onDrill={onDrill} />
  }
  return <p className="p-3 text-muted">{type.name} has no collection editor.</p>
}
