import { useId } from 'react'
import type { InputHTMLAttributes } from 'react'

export interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Visible label rendered above the input and associated with it. */
  label: string
  /** Use the monospace font for the value. */
  mono?: boolean
}

/** A labelled text input styled for forms and dialogs. */
export function Field({ label, mono, className, ...rest }: FieldProps) {
  const id = useId()
  return (
    <div className={`mb-3 flex flex-col gap-[5px] ${className ?? ''}`}>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        className={`h-7 w-full rounded border border-line bg-editor px-2 placeholder:text-faint focus:border-focus ${mono ? 'font-mono text-[12.5px]' : ''}`}
        {...rest}
      />
    </div>
  )
}
