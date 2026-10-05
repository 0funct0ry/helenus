import { SeedGeneratorEditor } from './SeedGeneratorEditor'
import type { ParamsProps } from './paramsProps'
import type { TypeDesc } from '../../api/types'

export interface CompositeParamsProps extends ParamsProps {
  /** Field names and types of the UDT, from the schema; tuples use their positional arguments. */
  udtFields?: { name: string; desc?: TypeDesc }[]
}

/** Parameter editor for tuple and UDT columns: one generator per field. Unset fields use the default for their type. */
export function CompositeParams({ spec, type, errors, onChange, udtFields }: CompositeParamsProps) {
  const fields: { name: string; label: string; desc?: TypeDesc }[] = type.name === 'tuple'
    ? (type.args ?? []).map((a, i) => ({ name: String(i), label: `Field ${i + 1}`, desc: a }))
    : (udtFields ?? []).map((f) => ({ name: f.name, label: f.name, desc: f.desc }))
  if (!fields.length) return <p className="m-0 text-xs text-muted">All fields use their default generators.</p>
  return (
    <div className="flex flex-col gap-2">
      {fields.map((f) =>
        f.desc ? (
          <SeedGeneratorEditor
            key={f.name}
            label={f.label}
            type={f.desc}
            spec={spec.fields?.[f.name]}
            errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith(`fields.${f.name}.`)).map(([k, v]) => [k.slice(`fields.${f.name}.`.length), v]))}
            onChange={(s) => onChange({ ...spec, fields: { ...spec.fields, [f.name]: s! } })}
          />
        ) : null,
      )}
    </div>
  )
}
