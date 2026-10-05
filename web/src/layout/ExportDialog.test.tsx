import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportDialog } from './ExportDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { ExportPreset, JobInfo } from '../api/types'

const job = (over: Partial<JobInfo> = {}): JobInfo => ({
  id: 'e1', kind: 'export', profile: 'local', state: 'running', started_at: '', progress: { done: 0, total: 0, errors: 0, rate_per_s: 0, eta_s: 0 }, ...over,
})
const finance: ExportPreset = { id: 3, profile: '', name: 'Finance CSV', format: 'csv', options: { delimiter: ';' }, columns: ['merchant_id', 'amount'], created_at: '', updated_at: '' }

function setup(extra: Record<string, unknown> = {}, source: Parameters<typeof ExportDialog>[0]['source'] = { kind: 'table', keyspace: 'payments', table: 'merchants' }) {
  connectedWorkspace()
  const calls = mockSchemaApi({
    'GET /p/local/export/presets': { presets: [finance] },
    'POST /p/local/export': { status: 202, body: { id: 'e1', job: job(), filename: 'merchants.csv' } },
    'GET /p/local/jobs/e1': { body: job({ state: 'done', result: { filename: 'merchants.csv', rows: 3, bytes: 10, format: 'csv' } }) },
    ...extra,
  })
  const onClose = vi.fn()
  render(<ExportDialog source={source} onClose={onClose} />)
  return { calls, onClose }
}

describe('ExportDialog', () => {
  it('exports a table with the chosen options and downloads the file', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const { calls } = setup()
    await screen.findByRole('checkbox', { name: /^merchant_id/ })
    await userEvent.click(screen.getByRole('checkbox', { name: /^hq/ }))
    await userEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    expect((screen.getByLabelText('File name') as HTMLInputElement).value).toMatch(/^merchants-\d{8}-\d{4}\.json$/)
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await screen.findByText(/Downloaded merchants.csv \(3 rows\)/)
    const start = calls.find((c) => c.path === '/p/local/export')
    expect(start?.body).toMatchObject({
      source: { table: { keyspace: 'payments', table: 'merchants', columns: ['merchant_id', 'name'] } },
      format: 'json',
    })
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    click.mockRestore()
  })

  it('exports a query result without a column list', async () => {
    const { calls } = setup({}, { kind: 'query', cql: 'SELECT * FROM payments.merchants' })
    expect(screen.queryByRole('checkbox', { name: /Select all/ })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    await waitFor(() => expect(calls.some((c) => c.path === '/p/local/export')).toBe(true))
    expect(calls.find((c) => c.path === '/p/local/export')?.body).toMatchObject({ source: { query: 'SELECT * FROM payments.merchants' } })
  })

  it('applies a preset and reports the columns this table lacks', async () => {
    setup()
    await screen.findByRole('checkbox', { name: /^merchant_id/ })
    await waitFor(() => expect(screen.getByRole('button', { name: /Load preset/ })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: /Load preset/ }))
    await userEvent.click(await screen.findByRole('option', { name: /Finance CSV/ }))
    expect(screen.getByText('Not in this table, unchecked: amount')).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: /^merchant_id/ })).toBeChecked()
    expect(screen.getByRole('checkbox', { name: /^name/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'CSV' })).toBeChecked()
    expect(within(screen.getByRole('radiogroup', { name: 'Format' })).getByRole('radio', { name: 'CSV' })).toBeChecked()
  })

  it('shows a failure such as the Excel row limit', async () => {
    setup({ 'GET /p/local/jobs/e1': { body: job({ state: 'failed', result: { error: 'Excel allows 1,048,576 rows; use CSV for more' } }) } })
    await screen.findByRole('checkbox', { name: /^merchant_id/ })
    await userEvent.click(screen.getByRole('radio', { name: 'Excel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Excel allows 1,048,576 rows; use CSV for more')
  })

  it('shows a start error and keeps the dialog open', async () => {
    setup({ 'POST /p/local/export': { status: 422, body: { error: { code: 'invalid_source', message: 'bad where' } } } })
    await userEvent.click(await screen.findByRole('button', { name: 'Export' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bad where')
  })
})
