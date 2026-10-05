import { ResultsGrid } from './ResultsGrid'
import { cellOf } from '../lib/seedModel'
import type { SeedColumnInfo } from '../api/types'
import type { Row } from '../mocks/types'

export interface SeedPreviewStepProps {
  columns: SeedColumnInfo[]
  rows: unknown[][]
  statement: string
  notes: string[]
  pending: boolean
}

/** Step 3 of the seed wizard: the first 20 generated rows in a grid, the sample statement and any notes. */
export function SeedPreviewStep({ columns, rows, statement, notes, pending }: SeedPreviewStepProps) {
  const gridRows: Row[] = rows.map((r) => Object.fromEntries(columns.map((c, i) => [c.name, cellOf(r[i])])))
  return (
    <div className="flex flex-col gap-3">
      <div className="h-[300px] min-h-0 overflow-hidden rounded border border-line2" aria-busy={pending}>
        <ResultsGrid columns={columns.map((c) => ({ name: c.name, type: c.type, kind: c.kind }))} rows={gridRows} />
      </div>
      <div>
        <h3 className="mb-1 mt-0 text-[13px] font-semibold">Sample statement</h3>
        <pre className="m-0 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded border border-line2 bg-editor p-2 font-mono text-xs">{statement}</pre>
      </div>
      {notes.map((n) => (
        <p key={n} className="m-0 text-xs text-warn">
          {n}
        </p>
      ))}
    </div>
  )
}
