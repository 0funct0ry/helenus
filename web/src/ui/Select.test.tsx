import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Select } from './Select'

const options = [
  { value: 'ONE', label: 'ONE' },
  { value: 'QUORUM', label: 'QUORUM' },
  { value: 'ALL', label: 'ALL' },
]

describe('Select', () => {
  it('is not a native select', () => {
    const { container } = render(<Select value="ONE" options={options} onChange={() => {}} label="Consistency" />)
    expect(container.querySelector('select')).toBeNull()
    expect(screen.getByRole('button', { name: 'Consistency: ONE' })).toBeInTheDocument()
  })
  it('opens and picks with the mouse', async () => {
    const onChange = vi.fn()
    render(<Select value="ONE" options={options} onChange={onChange} label="Consistency" />)
    await userEvent.click(screen.getByRole('button'))
    await userEvent.click(screen.getByRole('option', { name: 'QUORUM' }))
    expect(onChange).toHaveBeenCalledWith('QUORUM')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
  it('picks with the keyboard and closes on Escape', async () => {
    const onChange = vi.fn()
    render(<Select value="ONE" options={options} onChange={onChange} aria-label="CL" />)
    screen.getByRole('button').focus()
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}')
    expect(onChange).toHaveBeenCalledWith('QUORUM')
    await userEvent.click(screen.getByRole('button'))
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })
})

describe('Select disabled options', () => {
  it('cannot pick a disabled option and shows its title', async () => {
    const onChange = vi.fn()
    render(<Select label="C" value="B" onChange={onChange} options={[{ value: 'A', label: 'A', disabled: true, title: 'nope' }, { value: 'B', label: 'B' }]} />)
    await userEvent.click(screen.getByRole('button', { name: /C/ }))
    const a = screen.getByRole('option', { name: 'A' })
    expect(a).toHaveAttribute('aria-disabled', 'true')
    expect(a).toHaveAttribute('title', 'nope')
    await userEvent.click(a)
    expect(onChange).not.toHaveBeenCalled()
  })
})
