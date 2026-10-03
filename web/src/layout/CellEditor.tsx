import { useRef } from 'react'
import { Ban } from 'lucide-react'
import type { TypeDesc } from '../api/types'
import { Input } from '../ui/Input'
import { IconButton } from '../ui/IconButton'
import { isTextType, parseInput } from '../lib/cellInput'

/** What an inline edit produces: a new value, a cleared cell, or a counter increment. */
export type CellResult = { kind: 'value'; value: unknown } | { kind: 'null' } | { kind: 'delta'; value: string }

export interface CellEditorProps {
  /** Column name, used for the accessible label. */
  name: string
  type: TypeDesc
  /** The text the editor opens with. */
  initial: string
  /** The column is a counter: the editor takes an increment (+5, -3) instead of a value. */
  counter?: boolean
  onCommit: (result: CellResult) => void
  onCancel: () => void
  /** Reports the validation message while the text is invalid, and null once it is valid. */
  onInvalid: (message: string | null) => void
}

/**
 * The inline editor that replaces a cell's content. Enter commits, Escape cancels, and leaving the
 * cell commits when the text is valid and discards it otherwise. Text is validated against the column
 * type as it is typed. Empty input clears non-text cells; text cells can be set to the empty string or,
 * with the null button, to null. Counter cells accept only an increment.
 */
export function CellEditor({ name, type, initial, counter, onCommit, onCancel, onInvalid }: CellEditorProps) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  const read = (text: string): CellResult | { error: string } => {
    if (counter) {
      const p = parseInput({ name: 'bigint' }, text)
      return p.ok ? { kind: 'delta', value: String(p.value) } : { error: p.error.replace('bigint', 'increment') }
    }
    if (text.trim() === '' && !isTextType(type)) return { kind: 'null' }
    const p = parseInput(type, text)
    return p.ok ? { kind: 'value', value: p.value } : { error: p.error }
  }
  const finish = (r: CellResult) => {
    if (done.current) return
    done.current = true
    onInvalid(null)
    onCommit(r)
  }
  const cancel = () => {
    if (done.current) return
    done.current = true
    onInvalid(null)
    onCancel()
  }

  return (
    <div className="flex h-full items-center gap-0.5 pr-0.5">
      <Input
        ref={ref}
        autoFocus
        mono
        aria-label={`Edit ${name}`}
        className="h-[24px] flex-1 border-0 bg-transparent px-2.5 focus:border-0"
        defaultValue={initial}
        placeholder={counter ? '+5 or -3' : undefined}
        onChange={(e) => {
          const r = read(e.target.value)
          onInvalid('error' in r ? r.error : null)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            cancel()
          } else if (e.key === 'Enter') {
            e.preventDefault()
            const r = read(e.currentTarget.value)
            if ('error' in r) onInvalid(r.error)
            else finish(r)
          }
        }}
        onBlur={(e) => {
          const r = read(e.currentTarget.value)
          if ('error' in r || e.currentTarget.value === initial) cancel()
          else finish(r)
        }}
      />
      {!counter && (
        <IconButton
          label="Set null"
          icon={<Ban size={12} />}
          className="size-5"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => finish({ kind: 'null' })}
        />
      )}
    </div>
  )
}
