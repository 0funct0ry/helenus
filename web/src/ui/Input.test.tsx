import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Input } from './Input'

describe('Input', () => {
  it('is a labelled text box that reports typing', async () => {
    const onChange = vi.fn()
    render(<Input aria-label="Name" onChange={onChange} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Name' }), 'ab')
    expect(onChange).toHaveBeenCalledTimes(2)
  })
  it('marks an invalid input for assistive technology', () => {
    render(<Input aria-label="Port" invalid />)
    expect(screen.getByRole('textbox', { name: 'Port' })).toHaveAttribute('aria-invalid', 'true')
  })
  it('uses the mono font on request', () => {
    render(<Input aria-label="Key" mono />)
    expect(screen.getByRole('textbox', { name: 'Key' })).toHaveClass('font-mono')
  })
})
