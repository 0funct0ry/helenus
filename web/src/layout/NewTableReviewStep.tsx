import { Copy, FileText } from 'lucide-react'
import { Button } from '../ui/Button'
import { TypePlanPreview } from './TypePlanPreview'
import type { TablePlan } from '../api/types'

export interface NewTableReviewStepProps {
  plan: TablePlan
  pending: boolean
  /** Copies the statement to the clipboard. */
  onCopy: () => void
  /** Opens a new query tab holding the statement without running it. */
  onOpenInEditor: () => void
  /** Cassandra's message when Create failed; shown as an alert. */
  error: string | null
}

/**
 * Step 4 of the New table wizard: the full CQL that Create will run, with Copy and "Open in editor"
 * buttons, the planner's notes, and the server's error message after a failed Create.
 */
export function NewTableReviewStep({ plan, pending, onCopy, onOpenInEditor, error }: NewTableReviewStepProps) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h3 className="m-0 flex-1 text-[13px] font-semibold">CQL</h3>
        <Button icon={<Copy size={13} />} disabled={!plan.statement} onClick={onCopy}>
          Copy
        </Button>
        <Button icon={<FileText size={13} />} disabled={!plan.statement} onClick={onOpenInEditor}>
          Open in editor
        </Button>
      </div>
      <TypePlanPreview plan={plan} pending={pending} />
      {error && (
        <p role="alert" className="mb-0 mt-3 text-[12.5px] text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
