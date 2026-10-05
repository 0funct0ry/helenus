import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTableReviewStep } from './NewTableReviewStep'

const plan = { statement: 'CREATE TABLE shop.t (\n  a int,\n  PRIMARY KEY (a)\n);', errors: [], notes: ['Column a is frozen'] }

describe('NewTableReviewStep', () => {
  it('shows the CQL and notes and wires Copy and Open in editor', async () => {
    const onCopy = vi.fn()
    const onOpen = vi.fn()
    render(<NewTableReviewStep plan={plan} pending={false} error={null} onCopy={onCopy} onOpenInEditor={onOpen} />)
    expect(screen.getByText(/CREATE TABLE shop\.t/)).toBeInTheDocument()
    expect(screen.getByText('Column a is frozen')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await userEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(onCopy).toHaveBeenCalled()
    expect(onOpen).toHaveBeenCalled()
  })
  it('shows the server error as an alert', () => {
    render(<NewTableReviewStep plan={plan} pending={false} error="boom" onCopy={vi.fn()} onOpenInEditor={vi.fn()} />)
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
  })
})
