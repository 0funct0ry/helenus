import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportRunStep } from './ImportRunStep'
import { importJob } from '../test/importFixture'

const base = { job: undefined, starting: false, startError: null, canStart: true, errorsUrl: null, onStart: () => {}, onCancel: () => {}, onOpenTable: () => {} }

describe('ImportRunStep', () => {
  it('starts, and blocks start while the plan has problems', async () => {
    const onStart = vi.fn()
    const { rerender } = render(<ImportRunStep {...base} onStart={onStart} />)
    await userEvent.click(screen.getByRole('button', { name: 'Start import' }))
    expect(onStart).toHaveBeenCalled()
    rerender(<ImportRunStep {...base} canStart={false} startError="Map a source column to id" />)
    expect(screen.getByRole('button', { name: 'Start import' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('Map a source column')
  })
  it('shows progress, rate, ETA and cancels', async () => {
    const onCancel = vi.fn()
    render(<ImportRunStep {...base} job={importJob()} onCancel={onCancel} />)
    expect(screen.getByRole('progressbar', { name: 'Import progress' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('500 rows/s')).toBeInTheDocument()
    expect(screen.getByText('ETA 2 s')).toBeInTheDocument()
    expect(screen.getByText('1 rejected')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
  it('offers the table and the error report when finished with rejected rows', async () => {
    const onOpenTable = vi.fn()
    const result = { rows: 1000, written: 997, rejected: 3, first_errors: [{ line: 5, column: 'user_id', value: 'x', reason: 'bad uuid' }], keyspace: 'k', table: 't' }
    render(<ImportRunStep {...base} errorsUrl="/api/v1/p/local/import/job1/errors" onOpenTable={onOpenTable} job={importJob({ state: 'done', result })} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Download error report' })).toHaveAttribute('href', '/api/v1/p/local/import/job1/errors')
    expect(screen.getByText(/line 5 user_id: bad uuid/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open table' }))
    expect(onOpenTable).toHaveBeenCalled()
  })
  it('reports a failed job', () => {
    render(<ImportRunStep {...base} job={importJob({ state: 'failed', result: { error: 'aborted after more than 5 rejected rows' } })} />)
    expect(screen.getByText('Failed')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('aborted after')
  })
})
