import { Lightbulb } from 'lucide-react'

export interface AdviceNoteProps {
  /** Rule id such as A002. */
  id: string
  message: string
  /** Docs link; defaults to the data-modeling page anchor for the rule. */
  helpUrl?: string
  /** Called when the user hides this rule; omit to hide the button. */
  onHide?: (id: string) => void
}

/**
 * One advisor finding as an amber note: the message, a "Learn more" link to the docs anchor for the
 * rule, and an optional "Hide this advice" button. Findings are advisory and never block an action.
 */
export function AdviceNote({ id, message, helpUrl, onHide }: AdviceNoteProps) {
  const href = helpUrl ?? `/docs/data-modeling-tips-in-helenus#${id.toLowerCase()}`
  return (
    <div role="note" className="flex items-start gap-2 rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-xs text-text">
      <Lightbulb size={13} className="mt-0.5 flex-none text-amber-500" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] text-muted">{id}</span> {message}
        <div className="mt-1 flex gap-3">
          <a href={href} target="_blank" rel="noreferrer" className="underline">
            Learn more
          </a>
          {onHide && (
            <button type="button" onClick={() => onHide(id)} className="text-muted underline hover:text-text">
              Hide this advice
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
