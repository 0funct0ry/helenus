import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import type { ImportDryRun } from '../api/types'

export interface ImportDryRunStepProps {
  rows: number
  onRowsChange: (rows: number) => void
  result: ImportDryRun | undefined
  running: boolean
  error: string | null
  onRun: () => void
}

/**
 * Step 5 of the import wizard: parses and validates the first N rows (default 100) without writing anything, and shows
 * the valid count and a table of rejected values with line, column, value and reason.
 */
export function ImportDryRunStep({ rows, onRowsChange, result, running, error, onRun }: ImportDryRunStepProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-end gap-2">
        <Field label="Rows to check" value={String(rows)} className="!mb-0 w-32" onChange={(e) => onRowsChange(Number(e.target.value) || 0)} />
        <Button disabled={running || rows < 1} onClick={onRun}>
          {running ? 'Checking…' : 'Run dry run'}
        </Button>
        <span className="text-xs text-muted">Nothing is written.</span>
      </div>
      {error && (
        <p role="alert" className="m-0 text-danger">
          {error}
        </p>
      )}
      {result && (
        <>
          <p className="m-0">
            <strong>{result.valid.toLocaleString()}</strong> of {result.rows.toLocaleString()} rows are valid
            {result.invalid > 0 && <span className="text-danger">, {result.invalid.toLocaleString()} would be rejected</span>}.
          </p>
          {result.errors.length > 0 && (
            <div className="max-h-64 overflow-auto rounded border border-line2">
              <table aria-label="Rejected rows" className="w-full border-collapse font-mono text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="px-2 py-1">Line</th>
                    <th className="px-2 py-1">Column</th>
                    <th className="px-2 py-1">Value</th>
                    <th className="px-2 py-1">Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {result.errors.map((e, i) => (
                    <tr key={i} className="border-t border-line2">
                      <td className="px-2 py-0.5">{e.line}</td>
                      <td className="px-2 py-0.5">{e.column}</td>
                      <td className="max-w-[200px] truncate px-2 py-0.5">{e.value}</td>
                      <td className="px-2 py-0.5 text-danger">{e.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {result.truncated && <p className="m-0 text-xs text-muted">Only the first errors are listed.</p>}
        </>
      )}
    </div>
  )
}
