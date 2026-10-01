import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle'

describe('Toggle', () => {
  it('reflects checked and requests the opposite on click', async () => {
    const onChange = vi.fn()
    render(<Toggle checked={false} onChange={onChange}>Trace</Toggle>)
    const sw = screen.getByRole('switch', { name: 'Trace' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(onChange).toHaveBeenCalledWith(true)
  })
  it('toggles with the keyboard', async () => {
    const onChange = vi.fn()
    render(<Toggle checked onChange={onChange}>Trace</Toggle>)
    screen.getByRole('switch').focus()
    await userEvent.keyboard(' ')
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
