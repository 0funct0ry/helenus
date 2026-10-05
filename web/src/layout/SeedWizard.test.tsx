import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SeedWizard } from './SeedWizard'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import { seedConfig, seedJob, seedPreview } from '../test/seedFixture'
import { useWorkspace } from '../store/workspace'

const saved = { id: 1, keyspace: 'payments', table: 'merchants', name: 'big', config: seedConfig, created_at: '', updated_at: '' }

function setup(extra: Record<string, unknown> = {}) {
  connectedWorkspace()
  const calls = mockSchemaApi({
    'POST /p/local/seed/preview': { body: seedPreview() },
    'GET /p/local/seed/profiles?keyspace=payments&table=merchants': { profiles: [saved] },
    'POST /p/local/seed/run': { status: 202, body: { id: 'job1', job: seedJob() } },
    'GET /p/local/jobs/job1': { body: seedJob({ state: 'done', progress: { done: 1000, total: 1000, errors: 0, rate_per_s: 800, eta_s: 0 }, result: { written: 1000, errors: 0, skipped_duplicates: 0, partitions: 10, first_errors: [], keyspace: 'payments', table: 'merchants' } }) },
    ...extra,
  })
  const onClose = vi.fn()
  render(<SeedWizard keyspace="payments" table="merchants" onClose={onClose} />)
  return { calls, onClose }
}

describe('SeedWizard', () => {
  it('picks the default generators from the first preview', async () => {
    setup()
    const email = await screen.findByRole('region', { name: 'Column email' })
    expect(within(email).getByRole('button', { name: /email generator/ })).toHaveTextContent('Fake data')
    expect(within(await screen.findByRole('region', { name: 'Column id' })).getByRole('button', { name: /id generator/ })).toHaveTextContent('UUID')
    expect(within(await screen.findByRole('region', { name: 'Column created' })).getByRole('button', { name: /created generator/ })).toHaveTextContent('Date/time range')
  })

  it('walks the steps, runs the job and opens the table', async () => {
    const { calls, onClose } = setup()
    await screen.findByRole('region', { name: 'Column email' })
    const next = screen.getByRole('button', { name: 'Next' })
    await waitFor(() => expect(next).toBeEnabled())
    await userEvent.click(next)
    expect(screen.getByLabelText('Total rows')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/INSERT INTO payments.merchants/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start seeding' }))
    await screen.findByText('Done')
    const run = calls.find((c) => c.path === '/p/local/seed/run')
    expect(run?.body).toMatchObject({ table: { keyspace: 'payments', table: 'merchants' }, config: { seed: expect.any(Number), total_rows: 1000 } })
    await userEvent.click(screen.getByRole('button', { name: 'Open table' }))
    expect(useWorkspace.getState().activeId).toBe('table:payments.merchants')
    expect(onClose).toHaveBeenCalled()
  })

  it('blocks Next while a column has errors and keeps the message visible', async () => {
    setup({ 'POST /p/local/seed/preview': { body: seedPreview({ errors: [{ field: 'columns.email.params.category', message: 'unknown category "x"' }] }) } })
    await screen.findByRole('region', { name: 'Column email' })
    await screen.findByText('unknown category "x"')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('loads a saved profile through the server', async () => {
    const { calls } = setup()
    await screen.findByRole('region', { name: 'Column email' })
    await userEvent.click(await screen.findByRole('button', { name: /Load recipe/ }))
    await userEvent.click(await screen.findByRole('option', { name: 'big' }))
    await waitFor(() => expect(calls.filter((c) => c.path === '/p/local/seed/preview').some((c) => JSON.stringify(c.body).includes('"gen":"fake"'))).toBe(true))
  })

  it('asks before discarding edits', async () => {
    const { onClose } = setup()
    await screen.findByRole('region', { name: 'Column email' })
    await userEvent.click(screen.getByRole('button', { name: /email generator/ }))
    await userEvent.click(screen.getByRole('option', { name: 'Regex' }))
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalled()
  })

  it('closes straight away when nothing was edited', async () => {
    const { onClose } = setup()
    await screen.findByRole('region', { name: 'Column email' })
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
