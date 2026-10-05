import { useId } from 'react'
import { Input } from '../../ui/Input'

export interface ParamFieldProps {
  label: string
  value: string
  onChange: (text: string) => void
  /** Server message for this parameter, shown under the input. */
  error?: string
  placeholder?: string
  mono?: boolean
  className?: string
}

/** A labelled single-line parameter input with an inline error message; the building block of every generator parameter editor. */
export function ParamField({ label, value, onChange, error, placeholder, mono, className }: ParamFieldProps) {
  const id = useId()
  return (
    <div className={`flex min-w-[96px] flex-col gap-1 ${className ?? ''}`}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <Input id={id} mono={mono} value={value} placeholder={placeholder} invalid={!!error} onChange={(e) => onChange(e.target.value)} />
      {error && (
        <p role="alert" className="m-0 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
