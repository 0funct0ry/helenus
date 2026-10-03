import { useContext, useEffect, useId, useState } from 'react'
import type { TypeDesc } from '../api/types'
import { Input } from '../ui/Input'
import { Select } from '../ui/Select'
import { inputText, parseInput } from '../lib/cellInput'
import type { Parsed } from '../lib/cellInput'
import { InputValidity } from '../lib/inputValidity'
import { canonical } from '../lib/valueModel'

export interface ScalarInputProps {
  /** The scalar type to edit and validate against. */
  type: TypeDesc
  /** The current value in the API's JSON encoding. */
  value: unknown
  /** Called with each valid value as it is typed. Invalid text is reported through InputValidity instead. */
  onChange: (value: unknown) => void
  'aria-label': string
  /** An empty input means null instead of an error (used for optional columns). */
  optional?: boolean
  disabled?: boolean
  /** Outline the input as invalid even though its text is valid (e.g. a duplicate map key). */
  flagged?: boolean
  className?: string
}

const isTruncated = (v: unknown): v is { $truncated: true; preview: string; bytes: number } => typeof v === 'object' && v !== null && '$truncated' in v

/**
 * A validated input for one scalar value inside the collection editors and the insert dialog. It keeps
 * the typed text, parses it against the type (UUID, number range, date, time, timestamp, inet, blob hex,
 * duration), shows invalid text with a red outline and tooltip, and reports validity to the nearest
 * InputValidity provider. Booleans use a custom dropdown. Truncated blobs are shown but cannot be edited.
 */
export function ScalarInput({ type, value, onChange, optional, disabled, flagged, className, ...rest }: ScalarInputProps) {
  const id = useId()
  const report = useContext(InputValidity)
  const [text, setText] = useState(() => inputText(value))
  const frozen = type.name === 'boolean' || isTruncated(value)
  const read = (t: string): Parsed => (t === '' && optional ? { ok: true, value: null } : parseInput(type, t))
  const error = frozen ? null : (() => {
    const p = read(text)
    return p.ok ? null : p.error
  })()

  // Keep the text in step when the value is changed from outside (reordering, resetting).
  useEffect(() => {
    if (frozen) return
    const p = read(text)
    if (!(p.ok && canonical(p.value) === canonical(value ?? null))) setText(inputText(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useEffect(() => {
    report(id, error)
    return () => report(id, null)
  }, [id, error, report])

  if (isTruncated(value)) return <Input aria-label={rest['aria-label']} mono disabled value={`${value.preview}… (${value.bytes} B, too large to edit)`} readOnly className={className} />
  if (type.name === 'boolean') {
    return (
      <Select
        aria-label={rest['aria-label']}
        mono
        value={String(value === true)}
        onChange={(v) => onChange(v === 'true')}
        options={[{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }]}
        className={className}
      />
    )
  }
  return (
    <Input
      aria-label={rest['aria-label']}
      mono
      disabled={disabled}
      invalid={flagged || (!!error && text !== '')}
      title={error ?? undefined}
      value={text}
      placeholder={optional ? 'null' : undefined}
      className={className}
      onChange={(e) => {
        setText(e.target.value)
        const p = read(e.target.value)
        if (p.ok) onChange(p.value)
      }}
    />
  )
}
