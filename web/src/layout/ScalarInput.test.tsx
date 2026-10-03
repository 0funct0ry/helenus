import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScalarInput } from './ScalarInput'
import { InputValidity } from '../lib/inputValidity'
import type { TypeDesc } from '../api/types'

function Harness({ type, initial, optional, onChange, report }: { type: TypeDesc; initial: unknown; optional?: boolean; onChange?: (v: unknown) => void; report?: (id: string, e: string | null) => void }) {
  const [v, setV] = useState(initial)
  return (
    <InputValidity.Provider value={report ?? (() => {})}>
      <ScalarInput
        aria-label="value"
        type={type}
        value={v}
        optional={optional}
        onChange={(x) => {
          setV(x)
          onChange?.(x)
        }}
      />
      <button onClick={() => setV('7')}>reset</button>
    </InputValidity.Provider>
  )
}

describe('ScalarInput', () => {
  it('emits valid values in the API encoding as they are typed', async () => {
    const onChange = vi.fn()
    render(<Harness type={{ name: 'bigint' }} initial={null} onChange={onChange} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'value' }), '12')
    expect(onChange).toHaveBeenLastCalledWith('12')
  })
  it('reports invalid text and does not emit it', async () => {
    const onChange = vi.fn()
    const report = vi.fn()
    render(<Harness type={{ name: 'uuid' }} initial={null} onChange={onChange} report={report} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'value' }), 'nope')
    expect(onChange).not.toHaveBeenCalled()
    expect(report).toHaveBeenLastCalledWith(expect.any(String), expect.stringMatching(/UUID/))
    expect(screen.getByRole('textbox', { name: 'value' })).toHaveAttribute('aria-invalid', 'true')
  })
  it('clears the report once the text is valid again', async () => {
    const report = vi.fn()
    render(<Harness type={{ name: 'int' }} initial={null} report={report} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'value' }), '5')
    expect(report).toHaveBeenLastCalledWith(expect.any(String), null)
  })
  it('treats an empty optional input as null', async () => {
    const onChange = vi.fn()
    render(<Harness type={{ name: 'int' }} initial={4} optional onChange={onChange} />)
    await userEvent.clear(screen.getByRole('textbox', { name: 'value' }))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })
  it('follows a value changed from outside', async () => {
    render(<Harness type={{ name: 'int' }} initial={1} />)
    await userEvent.click(screen.getByText('reset'))
    expect(screen.getByRole('textbox', { name: 'value' })).toHaveValue('7')
  })
  it('edits a boolean through the custom dropdown', async () => {
    const onChange = vi.fn()
    render(<Harness type={{ name: 'boolean' }} initial={false} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: 'value' }))
    await userEvent.click(screen.getByRole('option', { name: 'true' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })
  it('shows a truncated blob but does not let it be edited', () => {
    render(<Harness type={{ name: 'blob' }} initial={{ $truncated: true, preview: '0x00', bytes: 99999 }} />)
    expect(screen.getByRole('textbox', { name: 'value' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'value' })).toHaveValue('0x00… (99999 B, too large to edit)')
  })
})
