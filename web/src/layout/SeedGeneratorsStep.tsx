import { Select } from '../ui/Select'
import { Input } from '../ui/Input'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import { SeedParamsEditor } from './seed/SeedParamsEditor'
import { GENERATORS, cellOf, errorsFor } from '../lib/seedModel'
import type { SeedColumnInfo, SeedConfig, SeedFieldError, SeedSpec, TypeDesc } from '../api/types'

export interface SeedGeneratorsStepProps {
  columns: SeedColumnInfo[]
  config: SeedConfig
  errors: SeedFieldError[]
  /** Preview rows (column order); the first three give each column's live sample. */
  rows: unknown[][]
  /** Field names and types of a UDT, from the schema. */
  udtFields: (t: TypeDesc) => { name: string; desc?: TypeDesc }[]
  onChange: (config: SeedConfig) => void
}

/**
 * Step 1 of the seed wizard: one row per column with its key marker, type badge, generator Select (only generators
 * that fit the type), null percentage for non-key columns, a live sample of three values, and the parameter editor
 * of the chosen generator. Server errors appear under the parameter they belong to.
 */
export function SeedGeneratorsStep({ columns, config, errors, rows, udtFields, onChange }: SeedGeneratorsStepProps) {
  const setSpec = (name: string, spec: SeedSpec) => onChange({ ...config, columns: { ...config.columns, [name]: spec } })
  return (
    <div className="flex flex-col gap-2">
      {columns.map((col, i) => {
        const spec = config.columns[col.name]
        if (!spec) return null
        const errs = errorsFor(errors, `columns.${col.name}`)
        const samples = rows.slice(0, 3).map((r) => cellOf(r[i]))
        return (
          <section key={col.name} aria-label={`Column ${col.name}`} className="rounded border border-line2 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex min-w-[140px] items-center gap-1.5 font-mono text-[12.5px]">
                <KeyMarker kind={col.kind} />
                {col.name}
              </span>
              <TypeBadge type={col.type} />
              <Select
                aboveDialog
                aria-label={`${col.name} generator`}
                value={spec.gen}
                options={col.compatible
                  .filter((g) => !(col.key && g === 'null'))
                  .map((g) => ({ value: g, label: GENERATORS[g]?.label ?? g, title: GENERATORS[g]?.help }))}
                onChange={(gen) => setSpec(col.name, { type: spec.type, gen, null_percent: spec.null_percent })}
              />
              {!col.key && col.desc.name !== 'counter' && (
                <label className="inline-flex items-center gap-1 text-xs text-muted">
                  Null %
                  <Input
                    className="w-14"
                    aria-label={`${col.name} null percent`}
                    value={spec.null_percent ? String(spec.null_percent) : ''}
                    placeholder="0"
                    onChange={(e) => setSpec(col.name, { ...spec, null_percent: Number(e.target.value) || 0 })}
                  />
                </label>
              )}
              <span className="ml-auto truncate font-mono text-xs text-muted" title="Sample values from the preview">
                {samples.length ? samples.map((s) => (s === null ? 'null' : String(s))).join(' · ') : ''}
              </span>
            </div>
            {errs[''] && (
              <p role="alert" className="m-0 mt-1 text-xs text-danger">
                {errs['']}
              </p>
            )}
            {errs['null_percent'] && (
              <p role="alert" className="m-0 mt-1 text-xs text-danger">
                {errs['null_percent']}
              </p>
            )}
            <div className="mt-1.5">
              <SeedParamsEditor spec={spec} type={col.desc} errors={errs} udtFields={udtFields(col.desc)} onChange={(s) => setSpec(col.name, s)} />
            </div>
          </section>
        )
      })}
    </div>
  )
}
