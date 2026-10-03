import { ChevronRight } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { ScalarInput } from './ScalarInput'
import { formatCell } from '../lib/cellFormat'
import { isComposite } from '../lib/valueModel'

export interface ElementInputProps {
  type: TypeDesc
  value: unknown
  onChange: (value: unknown) => void
  /** Accessible name of the input or button. */
  label: string
  /** For a composite element: opens the nested editor for it. */
  onDrill: () => void
  /** An empty input means null (UDT fields, tuple elements and insert columns). */
  optional?: boolean
  /** Outline as invalid (a duplicate key). */
  flagged?: boolean
}

/**
 * One element of a collection, UDT or tuple. Scalars get a validated typed input; nested collections,
 * UDTs, tuples and frozen values show their CQL literal on a button that drills into a nested editor.
 */
export function ElementInput({ type, value, onChange, label, onDrill, optional, flagged }: ElementInputProps) {
  if (!isComposite(type)) return <ScalarInput type={type} value={value} onChange={onChange} aria-label={label} optional={optional} flagged={flagged} />
  const text = formatCell(type, value) ?? 'null'
  return (
    <button
      type="button"
      aria-label={label}
      title={text}
      onClick={onDrill}
      className="flex h-7 w-full min-w-0 items-center gap-1 rounded border border-line bg-editor px-2 text-left font-mono text-[12.5px] hover:bg-hover"
    >
      <span className="min-w-0 flex-1 truncate text-syn-const">{text}</span>
      <ChevronRight size={12} className="flex-none text-muted" />
    </button>
  )
}
