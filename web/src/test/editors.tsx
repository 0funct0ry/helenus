import { useState } from 'react'
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import { InputValidity } from '../lib/inputValidity'

/** Records what each input under an editor reports to InputValidity: the current error messages by input id. */
export function renderEditor(ui: ReactElement): RenderResult & { errors: () => string[] } {
  const reported = new Map<string, string>()
  const view = render(
    <InputValidity.Provider
      value={(id, e) => {
        if (e === null) reported.delete(id)
        else reported.set(id, e)
      }}
    >
      {ui}
    </InputValidity.Provider>,
  )
  return Object.assign(view, { errors: () => [...reported.values()] })
}

/** Holds editor state for a test: renders `children(value, setValue)` and exposes the latest value to assertions. */
export function Stateful<T>({ initial, children, onValue }: { initial: T; children: (value: T, set: (v: T) => void) => ReactElement; onValue?: (v: T) => void }) {
  const [v, setV] = useState(initial)
  return children(v, (x) => {
    setV(x)
    onValue?.(x)
  })
}
