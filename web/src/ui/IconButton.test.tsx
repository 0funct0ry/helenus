import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { IconButton } from './IconButton'

describe('IconButton', () => {
  it('is named by its label', async () => {
    const onClick = vi.fn()
    render(<IconButton label="Refresh" icon={<span>i</span>} onClick={onClick} />)
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
