import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Button } from './Button'

describe('Button', () => {
  it('renders label and fires onClick', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick} kbd="⌘↵">Run</Button>)
    await userEvent.click(screen.getByRole('button', { name: /run/i }))
    expect(onClick).toHaveBeenCalled()
    expect(screen.getByText('⌘↵')).toBeInTheDocument()
  })
  it('does not fire when disabled', async () => {
    const onClick = vi.fn()
    render(<Button disabled onClick={onClick}>Go</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).not.toHaveBeenCalled()
  })
})
