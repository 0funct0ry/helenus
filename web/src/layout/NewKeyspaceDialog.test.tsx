import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewKeyspaceDialog } from './NewKeyspaceDialog'
import { renderWithClient as render, mockApi } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, rowsResponse } from '../test/schemaFixture'
import type { KeyspaceRequest } from '../api/types'

const SIMPLE = "CREATE KEYSPACE shop WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1} AND durable_writes = true;"
const cluster = {
  name: 'c', release_version: '5.0', cql_version: '3', protocol_version: '5', local_dc: 'eu', node_count: 4,
  datacenters: ['eu', 'us'],
  nodes: ['eu', 'eu', 'eu', 'eu', 'us'].map((dc, i) => ({ address: `10.0.0.${i}`, dc, rack: 'r', version: '5.0', host_id: `${i}` })),
}

function setup(opts: { query?: unknown } = {}) {
  connectedWorkspace()
  const calls: Call[] = mockApi({
    'GET /p/local/cluster': cluster,
    'POST /p/local/keyspaces/preview': (c: Call) => {
      const r = c.body as KeyspaceRequest
      const errors: { field: string; message: string }[] = []
      if (r.name === 'system_foo') errors.push({ field: 'name', message: 'Names starting with system are reserved' })
      if (r.strategy === 'NetworkTopologyStrategy' && r.datacenters.length === 0) errors.push({ field: 'datacenters', message: 'Add at least one datacenter' })
      const statement =
        errors.length || !r.name
          ? ''
          : r.strategy === 'SimpleStrategy'
            ? `CREATE KEYSPACE ${r.name} WITH replication = {'class': 'SimpleStrategy', 'replication_factor': ${r.replication_factor}} AND durable_writes = ${r.durable_writes};`
            : `NTS ${r.datacenters.map((d) => `${d.name}:${d.rf}`).join(',')}`
      return { body: { statement, errors: r.name ? errors : [{ field: 'name', message: 'Name is required' }], notes: [] } }
    },
    'POST /p/local/query': opts.query ?? { body: rowsResponse({ kind: 'schema_change', executed_cql: SIMPLE }) },
  })
  const onClose = vi.fn()
  const onCreated = vi.fn()
  render(<NewKeyspaceDialog onClose={onClose} onCreated={onCreated} />)
  return { calls, onClose, onCreated }
}
const queries = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path.endsWith('/query'))

describe('NewKeyspaceDialog', () => {
  it('focuses Name, previews the statement and creates it verbatim', async () => {
    const { calls, onClose, onCreated } = setup()
    const name = screen.getByLabelText('Name')
    expect(name).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Create keyspace' })).toBeDisabled()
    await userEvent.type(name, 'shop')
    expect(await screen.findByText(SIMPLE)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Create keyspace' }))
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith('shop'))
    expect(onClose).toHaveBeenCalled()
    expect((queries(calls)[0].body as { cql: string }).cql).toBe(SIMPLE)
  })
  it('shows a field error under Name after blur and keeps Create disabled', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Name'), 'system_foo')
    await userEvent.tab()
    expect((await screen.findAllByText('Names starting with system are reserved')).length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Create keyspace' })).toBeDisabled()
  })
  it('switches to NetworkTopologyStrategy with datacenters prefilled from the cluster', async () => {
    setup()
    await userEvent.click(screen.getByRole('radio', { name: 'NetworkTopologyStrategy' }))
    expect(screen.queryByLabelText('Replication factor')).not.toBeInTheDocument()
    expect(await screen.findByLabelText('Datacenter 1 name')).toHaveValue('eu')
    expect(screen.getByLabelText('Datacenter 1 replication factor')).toHaveValue(3)
    expect(screen.getByLabelText('Datacenter 2 name')).toHaveValue('us')
    expect(screen.getByLabelText('Datacenter 2 replication factor')).toHaveValue(1)
  })
  it('adds and removes datacenter rows, and flags zero rows', async () => {
    setup()
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await userEvent.click(screen.getByRole('radio', { name: 'NetworkTopologyStrategy' }))
    await screen.findByLabelText('Datacenter 2 name')
    await userEvent.click(screen.getByRole('button', { name: 'Remove datacenter 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove datacenter 1' }))
    expect((await screen.findAllByText('Add at least one datacenter')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'Create keyspace' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Add datacenter' }))
    expect(screen.getByLabelText('Datacenter 1 name')).toHaveValue('')
  })
  it('sends the toggles in the request', async () => {
    const { calls } = setup()
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await userEvent.click(screen.getByRole('switch', { name: 'Durable writes' }))
    await userEvent.click(screen.getByRole('switch', { name: "Create only if it doesn't exist" }))
    await waitFor(() => {
      const last = calls.filter((c) => c.path.endsWith('/keyspaces/preview')).at(-1)?.body as KeyspaceRequest
      expect(last).toMatchObject({ durable_writes: false, if_not_exists: true })
    })
  })
  it('shows the server error, keeps the values and re-enables Create', async () => {
    setup({ query: { status: 400, body: { error: { code: 'query_failed', message: 'unauthorized' } } } })
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await screen.findByText(SIMPLE)
    await userEvent.click(screen.getByRole('button', { name: 'Create keyspace' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('unauthorized')
    expect(screen.getByLabelText('Name')).toHaveValue('shop')
    expect(screen.getByRole('button', { name: 'Create keyspace' })).toBeEnabled()
  })
  it('sends one request when Create is double-clicked', async () => {
    const { calls } = setup()
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await screen.findByText(SIMPLE)
    await userEvent.dblClick(screen.getByRole('button', { name: 'Create keyspace' }))
    await waitFor(() => expect(queries(calls)).toHaveLength(1))
  })
  it('submits with Enter in Name', async () => {
    const { onCreated } = setup()
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await screen.findByText(SIMPLE)
    await userEvent.type(screen.getByLabelText('Name'), '{Enter}')
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
  })
  it('closes without asking when Name is empty, and asks to discard when it is not', async () => {
    const { onClose } = setup()
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
  it('asks via a confirm dialog before discarding a typed name', async () => {
    const { onClose } = setup()
    await userEvent.type(screen.getByLabelText('Name'), 'shop')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByText('Discard this keyspace?')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    expect(onClose).toHaveBeenCalled()
  })
})
