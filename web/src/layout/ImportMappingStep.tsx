import { Select } from '../ui/Select'
import { Badge } from '../ui/Badge'
import { KeyMarker } from '../ui/KeyMarker'
import { TypeBadge } from '../ui/TypeBadge'
import type { ImportMapping, ImportPlanColumn } from '../api/types'
import type { ColumnKind } from '../lib/schemaModel'

export interface ImportMappingStepProps {
  columns: ImportPlanColumn[]
  sourceColumns: string[]
  /** Blocking problems from the plan, such as "Map a source column to user_id". */
  errors: string[]
  onChange: (mapping: ImportMapping[]) => void
}

/**
 * Step 3 of the import wizard: one row per target column with its key marker and type badge, a source dropdown
 * prefilled by the assistant with a confidence chip, "Skip" for non-key columns, and the type-check failure count with
 * up to five failing samples per column.
 */
export function ImportMappingStep({ columns, sourceColumns, errors, onChange }: ImportMappingStepProps) {
  const pick = (target: string, source: string) => onChange(columns.map((c) => ({ target: c.target, source: c.target === target ? source : c.source })))
  return (
    <div className="flex flex-col gap-2">
      {errors.map((e) => (
        <p key={e} role="alert" className="m-0 text-danger">
          {e}
        </p>
      ))}
      <table aria-label="Column mapping" className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="px-2 py-1">Column</th>
            <th className="px-2 py-1">Type</th>
            <th className="px-2 py-1">Source column</th>
            <th className="px-2 py-1">Match</th>
            <th className="px-2 py-1">Check</th>
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => {
            const key = c.kind === 'partition' || c.kind === 'clustering'
            return (
              <tr key={c.target} className="border-t border-line2 align-top">
                <td className="px-2 py-1">
                  <span className="inline-flex items-center gap-1.5">
                    <KeyMarker kind={c.kind as ColumnKind} />
                    <span className="font-mono">{c.target}</span>
                  </span>
                </td>
                <td className="px-2 py-1">
                  <TypeBadge type={c.type} />
                </td>
                <td className="px-2 py-1">
                  <Select
                    aboveDialog
                    aria-label={`Source for ${c.target}`}
                    value={c.source}
                    options={[
                      key ? { value: '', label: 'Choose a column…', disabled: true } : { value: '', label: 'Skip' },
                      ...sourceColumns.map((s) => ({ value: s, label: s })),
                    ]}
                    onChange={(s) => pick(c.target, s)}
                  />
                </td>
                <td className="px-2 py-1">{c.source && c.confidence && <Badge data-testid={`confidence-${c.target}`}>{c.confidence}</Badge>}</td>
                <td className="px-2 py-1 text-xs">
                  {c.source && c.failures > 0 && (
                    <details>
                      <summary className="cursor-pointer text-danger">
                        {c.failures.toLocaleString()} of the checked rows fail
                      </summary>
                      <ul className="m-0 mt-1 list-none p-0 font-mono text-muted">
                        {c.samples.map((s, i) => (
                          <li key={i}>
                            line {s.line}: “{s.value}” — {s.reason}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {c.source && c.failures === 0 && <span className="text-muted">OK</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
