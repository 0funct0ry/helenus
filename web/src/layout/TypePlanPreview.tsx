import type { TypePlan } from '../api/types'

export interface TypePlanPreviewProps {
  plan: TypePlan
  /** True while the preview for the latest input is still loading. */
  pending: boolean
}

/**
 * The statement a UDT dialog will run, shown live under its form. Validation errors from the server
 * appear in red above it, and builder notes (such as fields that were frozen automatically) in muted text.
 */
export function TypePlanPreview({ plan, pending }: TypePlanPreviewProps) {
  return (
    <div aria-label="DDL preview" className="flex flex-col gap-2">
      {plan.errors.length > 0 && (
        <ul role="alert" className="m-0 list-none rounded-md border border-danger p-2 text-[12.5px] text-danger">
          {plan.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <pre className={`m-0 min-h-[48px] whitespace-pre-wrap rounded-md border border-line2 bg-editor p-3 font-mono text-[12.5px] leading-5 ${pending ? 'opacity-60' : ''}`}>
        {plan.statement || (pending ? 'Building…' : '-- fix the errors above to see the statement')}
      </pre>
      {plan.notes.map((n) => (
        <p key={n} className="m-0 text-xs text-muted">
          {n}
        </p>
      ))}
    </div>
  )
}
