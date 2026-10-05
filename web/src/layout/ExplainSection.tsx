import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

export interface ExplainSectionProps {
  /** Plain-language lines from the server's `explain[]`. Nothing renders when empty. */
  lines?: string[]
}

/**
 * A collapsible "What this does" section shown under a CQL preview. Starts collapsed; the toggle is a
 * button so it works from the keyboard.
 */
export function ExplainSection({ lines }: ExplainSectionProps) {
  const [open, setOpen] = useState(false)
  if (!lines || lines.length === 0) return null
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <div className="text-xs">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-1 text-muted hover:text-text">
        <Icon size={12} />
        What this does
      </button>
      {open && (
        <ul className="m-0 mt-1 list-disc pl-5 text-[12.5px] text-text">
          {lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
