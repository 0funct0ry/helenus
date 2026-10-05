import { Select } from '../../ui/Select'
import { GENERATORS, compatibleGenerators } from '../../lib/seedModel'
import { SeedParamsEditor } from './SeedParamsEditor'
import type { SeedSpec, TypeDesc } from '../../api/types'

export interface SeedGeneratorEditorProps {
  label: string
  type: TypeDesc
  /** Undefined means "use the default generator for this type". */
  spec: SeedSpec | undefined
  errors: Record<string, string>
  onChange: (spec: SeedSpec | undefined) => void
}

/**
 * Nested generator editor used for collection elements, map keys and tuple/UDT fields: a generator Select (with
 * "Default") and the parameter editor for the chosen generator. Parameters not set fall back to the server defaults.
 */
export function SeedGeneratorEditor({ label, type, spec, errors, onChange }: SeedGeneratorEditorProps) {
  const options = [{ value: '', label: 'Default' }, ...compatibleGenerators(type).map((g) => ({ value: g, label: GENERATORS[g]?.label ?? g }))]
  return (
    <div className="rounded border border-line2 p-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs text-muted">{label}</span>
        <Select aboveDialog aria-label={`${label} generator`} value={spec?.gen ?? ''} options={options} onChange={(g) => onChange(g ? { gen: g } : undefined)} />
      </div>
      {errors[''] && (
        <p role="alert" className="m-0 text-xs text-danger">
          {errors['']}
        </p>
      )}
      {spec && <SeedParamsEditor spec={spec} type={type} errors={errors} onChange={onChange} />}
    </div>
  )
}
