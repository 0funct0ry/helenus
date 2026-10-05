import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeedRunStep } from './SeedRunStep'
import { seedJob } from '../test/seedFixture'

const base = { starting: false, startError: null, totalRows: 1000, canStart: true, onStart: () => {}, onCancel: () => {}, onOpenTable: () => {} }

describe('SeedRunStep', () => {
  it('starts the job', async () => {
    const onStart = vi.fn()
    render(<SeedRunStep {...base} job={undefined} onStart={onStart} />)
    expect(screen.getByText(/writes 1,000 rows/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Start seeding' }))
    expect(onStart).toHaveBeenCalled()
  })
  it('blocks start while the configuration has errors and shows start failures', () => {
    render(<SeedRunStep {...base} job={undefined} canStart={false} startError="not connected" />)
    expect(screen.getByRole('button', { name: 'Start seeding' })).toBeDisabled()
    expect(screen.getByRole('alert')).toHaveTextContent('not connected')
  })
  it('shows progress, rate and ETA, and cancels', async () => {
    const onCancel = vi.fn()
    render(<SeedRunStep {...base} job={seedJob()} onCancel={onCancel} />)
    expect(screen.getByRole('progressbar', { name: 'Seed progress' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('500 rows/s')).toBeInTheDocument()
    expect(screen.getByText('ETA 2 s')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalled()
  })
  it('offers Open table and lists errors when finished', async () => {
    const onOpenTable = vi.fn()
    const result = { written: 990, errors: 10, skipped_duplicates: 0, partitions: 10, first_errors: ['timeout'], keyspace: 'k', table: 't' }
    render(<SeedRunStep {...base} onOpenTable={onOpenTable} job={seedJob({ state: 'done', progress: { done: 990, total: 1000, errors: 10, rate_per_s: 900, eta_s: 0 }, result })} />)
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByText('10 errors')).toBeInTheDocument()
    expect(screen.getByText('timeout')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open table' }))
    expect(onOpenTable).toHaveBeenCalled()
  })
  it('reports a cancelled job with the rows written so far', () => {
    const result = { written: 120, errors: 0, skipped_duplicates: 0, partitions: 10, first_errors: [], keyspace: 'k', table: 't' }
    render(<SeedRunStep {...base} job={seedJob({ state: 'cancelled', result })} />)
    expect(screen.getByText('Cancelled')).toBeInTheDocument()
    expect(screen.getByText('120 of 1,000 rows')).toBeInTheDocument()
  })
})
