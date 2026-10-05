import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportDryRunStep } from './ImportDryRunStep'

const base = { rows: 100, onRowsChange: () => {}, result: undefined, running: false, error: null, onRun: () => {} }

describe('ImportDryRunStep', () => {
  it('runs on demand and says nothing is written', async () => {
    const onRun = vi.fn()
    render(<ImportDryRunStep {...base} onRun={onRun} />)
    expect(screen.getByText('Nothing is written.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run dry run' }))
    expect(onRun).toHaveBeenCalled()
  })
  it('shows the valid count and the rejected rows', () => {
    const result = { rows: 100, valid: 98, invalid: 2, truncated: false, errors: [{ line: 7, column: 'user_id', value: 'x', reason: 'bad uuid' }] }
    render(<ImportDryRunStep {...base} result={result} />)
    expect(screen.getByText(/98/)).toBeInTheDocument()
    expect(screen.getByText(/2 would be rejected/)).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Rejected rows' })).toHaveTextContent('bad uuid')
  })
  it('shows failures and disables the button while checking', () => {
    render(<ImportDryRunStep {...base} running error="unreadable" />)
    expect(screen.getByRole('button', { name: 'Checking…' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('unreadable')
  })
})
