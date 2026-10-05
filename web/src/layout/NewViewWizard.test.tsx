import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewViewWizard } from './NewViewWizard'
import { renderWithClient as render, mockApi, cluster } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, mockSchemaApi, rowsResponse, snapshot } from '../test/schemaFixture'
import type { ViewRequest } from '../api/types'

const CQL = 'CREATE MATERIALIZED VIEW payments.v AS\n  SELECT merchant_id\n  FROM payments.transactions_by_merchant\n  WHERE merchant_id IS NOT NULL;'

// A tiny stand-in for the server planner covering the rules the wizard UI depends on.
function plan(r: ViewRequest) {
  const errors: { step: number; field: string; message: string }[] = []
  if (!r.name) errors.push({ step: 1, field: 'name', message: 'View name is required' })
  const extras = [...r.partition_key, ...r.clustering.map((c) => c.column)].filter((n) => ['tags', 'amount'].includes(n))
  if (extras.length > 1) errors.push({ step: 2, field: 'partition_key', message: 'A view can add at most one non-key column to the primary key' })
  return { statement: errors.length ? '' : CQL, errors, notes: ['Materialized views are experimental in Cassandra and can drift from the base table'] }
}

function setup(query: unknown = { body: rowsResponse({ kind: 'schema_change', executed_cql: CQL }) }, baseTable: string | undefined = 'transactions_by_merchant') {
  connectedWorkspace()
  const calls: Call[] = mockSchemaApi({
    'GET /p/local/cluster': cluster,
    'POST /p/local/views/preview': (c: Call) => ({ body: plan(c.body as ViewRequest) }),
    'POST /p/local/query': query,
  })
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<NewViewWizard keyspace="payments" baseTable={baseTable} onClose={onClose} onCreated={onCreated} />)
  return { calls, onClose, onCreated }
}
const next = () => screen.getByRole('button', { name: 'Next' })
const lastPreview = (calls: Call[]) => calls.filter((c) => c.path.endsWith('/views/preview')).at(-1)?.body as ViewRequest
void mockApi
void snapshot

describe('NewViewWizard', () => {
  it('lists the four steps and preselects the base table with its keys pre-placed', async () => {
    const { calls } = setup()
    expect(screen.getByText('New view in payments')).toBeInTheDocument()
    for (const s of ['1 Base & columns', '2 Keys', '3 Options', '4 Review']) expect(screen.getByRole('button', { name: s })).toBeInTheDocument()
    await waitFor(() => expect(lastPreview(calls)).toBeDefined())
    expect(lastPreview(calls).base_table).toBe('transactions_by_merchant')
    expect(lastPreview(calls).partition_key).toEqual(['merchant_id', 'txn_day'])
    expect(lastPreview(calls).clustering).toEqual([{ column: 'txn_time', order: 'DESC' }])
  })
  it('blocks Next until a name is given', async () => {
    setup()
    await waitFor(() => expect(next()).toBeDisabled())
    await userEvent.type(screen.getByLabelText('View name'), 'v')
    await waitFor(() => expect(next()).toBeEnabled())
  })
  it('blocks Next on the Keys step when two non-key columns are added', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('View name'), 'v')
    await waitFor(() => expect(next()).toBeEnabled())
    await userEvent.click(next())
    for (const col of ['tags', 'amount']) {
      await userEvent.click(screen.getByRole('button', { name: 'Add to Clustering columns' }))
      await userEvent.click(await screen.findByRole('option', { name: col }))
    }
    await userEvent.tab()
    expect((await screen.findAllByText('A view can add at most one non-key column to the primary key')).length).toBeGreaterThan(0)
    await waitFor(() => expect(next()).toBeDisabled())
  })
  it('creates the previewed CQL once and shows the experimental note on Review', async () => {
    const { calls, onClose, onCreated } = setup()
    await userEvent.type(screen.getByLabelText('View name'), 'v')
    await waitFor(() => expect(next()).toBeEnabled())
    await userEvent.click(next())
    await userEvent.click(next())
    await userEvent.click(next())
    expect(await screen.findByText(/CREATE MATERIALIZED VIEW payments\.v/)).toBeInTheDocument()
    expect(screen.getByText(/experimental in Cassandra/)).toBeInTheDocument()
    const create = screen.getByRole('button', { name: 'Create view' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.dblClick(create)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('v'))
    expect(onClose).toHaveBeenCalled()
    const queries = calls.filter((c) => c.method === 'POST' && c.path.endsWith('/query'))
    expect(queries).toHaveLength(1)
    expect((queries[0].body as { cql: string }).cql).toBe(CQL)
  })
  it('stays on Review and shows the server message when Create fails', async () => {
    setup({ status: 400, body: { error: { code: 'query_failed', message: 'Materialized views are disabled' } } })
    await userEvent.type(screen.getByLabelText('View name'), 'v')
    await waitFor(() => expect(next()).toBeEnabled())
    await userEvent.click(next())
    await userEvent.click(next())
    await userEvent.click(next())
    const create = screen.getByRole('button', { name: 'Create view' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.click(create)
    expect(await screen.findByRole('alert')).toHaveTextContent('Materialized views are disabled')
    expect(screen.getByRole('button', { name: 'Create view' })).toBeInTheDocument()
  })
  it('closes without asking when untouched and asks to discard after edits', async () => {
    const { onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.type(screen.getByLabelText('View name'), 'v')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Discard this view?')).toBeInTheDocument()
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
