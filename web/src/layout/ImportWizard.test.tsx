import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ImportWizard } from './ImportWizard'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import { importJob, importPlan, importUpload } from '../test/importFixture'
import { useWorkspace } from '../store/workspace'
import * as importApi from '../api/useImport'

vi.mock('../api/useImport', async (orig) => ({ ...(await orig<typeof import('../api/useImport')>()), uploadImport: vi.fn() }))

const done = { rows: 1000, written: 1000, rejected: 0, first_errors: [], keyspace: 'payments', table: 'merchants' }

function setup(extra: Record<string, unknown> = {}) {
  connectedWorkspace()
  vi.mocked(importApi.uploadImport).mockResolvedValue(importUpload)
  const calls = mockSchemaApi({
    'POST /p/local/import/plan': { body: importPlan() },
    'POST /p/local/import/dry-run': { body: { rows: 100, valid: 100, invalid: 0, errors: [], truncated: false } },
    'POST /p/local/import/run': { status: 202, body: { id: 'job1', job: importJob() } },
    'GET /p/local/jobs/job1': { body: importJob({ state: 'done', progress: { done: 1000, total: 1000, errors: 0, rate_per_s: 800, eta_s: 0 }, result: done }) },
    ...extra,
  })
  const onClose = vi.fn()
  render(<ImportWizard keyspace="payments" table="merchants" onClose={onClose} />)
  return { calls, onClose }
}

async function uploadFile() {
  await userEvent.upload(screen.getByLabelText('Import file'), new File(['x'], 'users.csv'))
  await waitFor(() => expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled())
}

describe('ImportWizard', () => {
  it('walks the six steps, dry-runs, imports and opens the table', async () => {
    const { calls, onClose } = setup()
    await uploadFile()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('table', { name: 'Raw preview' })).toHaveTextContent('a@x.com')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByTestId('confidence-user_id')).toHaveTextContent('normalized')
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByLabelText('Batch size')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/rows are valid/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start import' }))
    await screen.findByText('Done')
    const run = calls.find((c) => c.path === '/p/local/import/run')
    expect(run?.body).toMatchObject({
      upload: 'up1',
      table: { keyspace: 'payments', table: 'merchants' },
      format: { format: 'csv', delimiter: ';', header: true },
      mapping: [{ target: 'user_id', source: 'UserId' }, { target: 'email', source: 'E-Mail' }, { target: 'created_at', source: 'createdAt' }],
      options: { consistency: 'LOCAL_QUORUM', batch_size: 1 },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Open table' }))
    expect(useWorkspace.getState().activeId).toBe('table:payments.merchants')
    expect(onClose).toHaveBeenCalled()
  })

  it('blocks Next on the mapping step while a key column has no source', async () => {
    setup({ 'POST /p/local/import/plan': { body: importPlan({ errors: ['Map a source column to user_id'] }) } })
    await uploadFile()
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Map a source column to user_id')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('shows upload errors and stays on step 1', async () => {
    setup()
    vi.mocked(importApi.uploadImport).mockRejectedValue(new Error('too big'))
    await userEvent.upload(screen.getByLabelText('Import file'), new File(['x'], 'big.csv'))
    expect(await screen.findByRole('alert')).toHaveTextContent('too big')
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('asks before discarding an uploaded file', async () => {
    const { onClose } = setup()
    await uploadFile()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalled()
  })
})
