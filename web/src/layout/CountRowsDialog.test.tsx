import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CountRowsDialog } from './CountRowsDialog'

describe('CountRowsDialog', () => {
  it('warns first and runs nothing until confirmed', async () => {
    const onRun = vi.fn().mockResolvedValue('1234')
    render(<CountRowsDialog open onClose={() => {}} onRun={onRun} />)
    expect(screen.getByText(/reads every matching row/)).toBeInTheDocument()
    expect(onRun).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Count rows' }))
    expect(await screen.findByText('1234')).toBeInTheDocument()
    expect(onRun).toHaveBeenCalledTimes(1)
  })
  it('shows an error from the count', async () => {
    render(<CountRowsDialog open onClose={() => {}} onRun={() => Promise.reject(new Error('timed out'))} />)
    await userEvent.click(screen.getByRole('button', { name: 'Count rows' }))
    expect(await screen.findByText('timed out')).toBeInTheDocument()
  })
  it('cancels without running', async () => {
    const onClose = vi.fn()
    const onRun = vi.fn()
    render(<CountRowsDialog open onClose={onClose} onRun={onRun} />)
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(onRun).not.toHaveBeenCalled()
  })
})
