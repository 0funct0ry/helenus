import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SegmentedControl } from './SegmentedControl'

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
]

describe('SegmentedControl', () => {
  it('marks the current option and reports clicks', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Mode" options={options} value="a" onChange={onChange} />)
    expect(screen.getByRole('radiogroup', { name: 'Mode' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Alpha' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('radio', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
  it('moves with the arrow keys', async () => {
    const onChange = vi.fn()
    render(<SegmentedControl label="Mode" options={options} value="a" onChange={onChange} />)
    screen.getByRole('radio', { name: 'Alpha' }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenCalledWith('b')
  })
  it('does not select a disabled option and exposes its reason', async () => {
    const onChange = vi.fn()
    const opts = [...options, { value: 'c', label: 'Gamma', disabled: true, title: 'Not available' }]
    render(<SegmentedControl label="Mode" options={opts} value="a" onChange={onChange} />)
    const g = screen.getByRole('radio', { name: 'Gamma' })
    expect(g).toBeDisabled()
    expect(g).toHaveAttribute('title', 'Not available')
    await userEvent.click(g)
    expect(onChange).not.toHaveBeenCalled()
  })
})
