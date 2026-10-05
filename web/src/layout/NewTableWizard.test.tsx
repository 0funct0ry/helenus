import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTableWizard } from './NewTableWizard'
import { renderWithClient as render, mockApi } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, rowsResponse } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'
import type { TableRequest } from '../api/types'

const cluster = { name: 'c', release_version: '5.0', cql_version: '3', protocol_version: '5', local_dc: 'eu', node_count: 1, datacenters: ['eu'], nodes: [] }
const CQL = 'CREATE TABLE payments.users (\n  id uuid,\n  PRIMARY KEY (id)\n);'

// A tiny stand-in for the server planner covering the rules the wizard UI depends on.
function plan(r: TableRequest) {
  const errors: { step: number; field: string; message: string }[] = []
  if (!r.name) errors.push({ step: 1, field: 'name', message: 'Table name is required' })
  r.columns.forEach((c, i) => !c.name && errors.push({ step: 1, field: `columns.${i}.name`, message: 'Column name is required' }))
  if (r.partition_key.length === 0) errors.push({ step: 2, field: 'partition_key', message: 'Choose at least one partition key column' })
  return { statement: errors.length ? '' : CQL, errors, notes: [] }
}

function setup(query: unknown = { body: rowsResponse({ kind: 'schema_change', executed_cql: CQL }) }) {
  connectedWorkspace()
  const calls: Call[] = mockApi({
    'GET /p/local/cluster': cluster,
    'GET /p/local/schema': { version: '5.0', generated_at: '', keyspaces: [] },
    'POST /p/local/tables/preview': (c: Call) => ({ body: plan(c.body as TableRequest) }),
    'POST /p/local/query': query,
  })
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<NewTableWizard keyspace="payments" onClose={onClose} onCreated={onCreated} />)
  return { calls, onClose, onCreated }
}
const next = () => screen.getByRole('button', { name: 'Next' })
const queries = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/query'))

async function fillAll() {
  await userEvent.type(screen.getByLabelText('Table name'), 'users')
  await userEvent.type(screen.getByLabelText('Column 1 name'), 'id')
  await waitFor(() => expect(next()).toBeEnabled())
  await userEvent.click(next())
  await userEvent.click(screen.getByRole('button', { name: 'Add to Partition key' }))
  await userEvent.click(await screen.findByRole('option', { name: 'id' }))
  await waitFor(() => expect(next()).toBeEnabled())
  await userEvent.click(next())
  await userEvent.click(next())
}

describe('NewTableWizard', () => {
  it('is titled with the keyspace and lists the four steps', () => {
    setup()
    expect(screen.getByText('New table in payments')).toBeInTheDocument()
    for (const s of ['1 Columns', '2 Keys', '3 Options', '4 Review']) expect(screen.getByRole('button', { name: s })).toBeInTheDocument()
  })
  it('blocks Next until the step is valid', async () => {
    setup()
    await waitFor(() => expect(next()).toBeDisabled())
    await userEvent.type(screen.getByLabelText('Table name'), 'users')
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'id')
    await waitFor(() => expect(next()).toBeEnabled())
  })
  it('walks through the steps, keeps data on Back, and creates the previewed CQL once', async () => {
    const { calls, onClose, onCreated } = setup()
    await fillAll()
    expect(await screen.findByText(/CREATE TABLE payments\.users/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByLabelText('Table name')).toHaveValue('users')
    await userEvent.click(screen.getByRole('button', { name: '4 Review' }))
    const create = screen.getByRole('button', { name: 'Create table' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.dblClick(create)
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('users'))
    expect(onClose).toHaveBeenCalled()
    expect(queries(calls)).toHaveLength(1)
    expect((queries(calls)[0].body as { cql: string; keyspace: string }).cql).toBe(CQL)
  })
  it('stays on Review and shows the server message when Create fails', async () => {
    setup({ status: 400, body: { error: { code: 'query_failed', message: 'Cassandra said no' } } })
    await fillAll()
    const create = screen.getByRole('button', { name: 'Create table' })
    await waitFor(() => expect(create).toBeEnabled())
    await userEvent.click(create)
    expect(await screen.findByRole('alert')).toHaveTextContent('Cassandra said no')
    expect(screen.getByRole('button', { name: 'Create table' })).toBeInTheDocument()
  })
  it('marks a visited step with errors', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Table name'), 'users')
    await userEvent.type(screen.getByLabelText('Column 1 name'), 'id')
    await waitFor(() => expect(next()).toBeEnabled())
    await userEvent.click(next())
    await userEvent.click(screen.getByRole('button', { name: '1 Columns' }))
    await userEvent.clear(screen.getByLabelText('Column 1 name'))
    await userEvent.click(screen.getByRole('button', { name: '2 Keys' }))
    expect(await screen.findByRole('img', { name: 'Columns has errors' })).toBeInTheDocument()
  })
  it('opens the CQL in a new query tab without executing', async () => {
    const { calls, onClose } = setup()
    await fillAll()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open in editor' })).toBeEnabled())
    const before = useWorkspace.getState().tabs.length
    await userEvent.click(screen.getByRole('button', { name: 'Open in editor' }))
    expect(useWorkspace.getState().tabs.length).toBe(before + 1)
    expect(queries(calls)).toHaveLength(0)
    expect(onClose).toHaveBeenCalled()
  })
  it('closes without asking when nothing was edited', async () => {
    const { onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
  it('asks to discard after edits, via Cancel and Escape', async () => {
    const { onClose } = setup()
    await userEvent.type(screen.getByLabelText('Table name'), 'u')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Discard this table?')).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalled()
  })
  it('asks to discard on Escape', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Table name'), 'u')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText('Discard this table?')).toBeInTheDocument()
  })
})
