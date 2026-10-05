import { useState } from 'react'
import type { AdviceFinding } from '../api/types'
import { hiddenAdvice, hideAdvice, resetAdvice } from '../lib/adviceHidden'
import { AdviceNote } from './AdviceNote'

export interface AdviceListProps {
  profile: string
  findings: AdviceFinding[]
  /** Prefix each finding with its table name (used for keyspace-wide lists). */
  showTable?: boolean
}

/**
 * Findings as amber notes, minus the rules hidden for this profile. A footer link brings hidden rules
 * back. Shows a reassuring line when nothing is left to report.
 */
export function AdviceList({ profile, findings, showTable }: AdviceListProps) {
  const [, bump] = useState(0)
  const hidden = hiddenAdvice(profile)
  const shown = findings.filter((f) => !hidden.has(f.id))
  const hiddenCount = findings.length - shown.length
  return (
    <div className="flex flex-col gap-2">
      {shown.length === 0 && <p className="m-0 text-[12.5px] text-muted">No data-model advice.</p>}
      {shown.map((f) => (
        <AdviceNote
          key={`${f.table ?? ''}:${f.id}`}
          id={f.id}
          helpUrl={f.help_url}
          message={showTable && f.table ? `${f.table}: ${f.message}` : f.message}
          onHide={(id) => {
            hideAdvice(profile, id)
            bump((x) => x + 1)
          }}
        />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="self-start text-xs text-muted underline hover:text-text"
          onClick={() => {
            resetAdvice(profile)
            bump((x) => x + 1)
          }}
        >
          Show {hiddenCount} hidden
        </button>
      )}
    </div>
  )
}
