import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditKeyspaceDialog } from './EditKeyspaceDialog'
import { renderWithClient as render } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, mockSchemaApi, rowsResponse } from '../test/schemaFixture'
import type { KeyspaceRequest } from '../api/types'

const ALTER = "ALTER KEYSPACE payments WITH replication = {'class': 'NetworkTopologyStrategy', 'eu-west-1': 4};"

function setup() {
  connectedWorkspace()
  const calls: Call[] = mockSchemaApi({
    'POST /p/local/keyspaces/preview': (c: Call) => {
      const r = c.body as KeyspaceRequest
      const rf = r.datacenters[0]?.rf
      if (rf === 3 && r.durable_writes) return { body: { statement: '', errors: [{ field: '', message: 'Nothing to change' }], notes: [] } }
      return { body: { statement: rf === 4 ? ALTER : 'ALTER KEYSPACE payments WITH durable_writes = false;', errors: [], notes: rf === 4 ? ['Run `nodetool repair -full` on every node in eu-west-1'] : [] } }
    },
    'POST /p/local/query': { body: rowsResponse({ kind: 'schema_change', executed_cql: ALTER }) },
  })
  const onClose = vi.fn()
  const onChanged = vi.fn()
  render(<EditKeyspaceDialog keyspace="payments" onChanged={onChanged} onClose={onClose} />)
  return { calls, onClose, onChanged }
}

describe('EditKeyspaceDialog', () => {
  it('disables Apply until something changes, then runs the previewed statement', async () => {
    const { calls, onChanged, onClose } = setup()
    expect(await screen.findByText('Nothing to change')).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveAttribute('readonly')
    const apply = screen.getByRole('button', { name: 'Apply changes' })
    expect(apply).toBeDisabled()
    const rf = screen.getAllByRole('spinbutton')[0]
    await userEvent.clear(rf)
    await userEvent.type(rf, '4')
    expect(await screen.findByText(ALTER)).toBeInTheDocument()
    expect(screen.getByText(/nodetool repair -full/)).toBeInTheDocument()
    await waitFor(() => expect(apply).toBeEnabled())
    await userEvent.click(apply)
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith('payments'))
    expect(onClose).toHaveBeenCalled()
    const q = calls.filter((c) => c.path.endsWith('/query'))
    expect(q).toHaveLength(1)
    expect((q[0].body as { cql: string }).cql).toBe(ALTER)
  })
  it('previews a durable-writes-only change', async () => {
    setup()
    await userEvent.click(await screen.findByText('Durable writes'))
    expect(await screen.findByText('ALTER KEYSPACE payments WITH durable_writes = false;')).toBeInTheDocument()
  })
  it('shows a server error inline and keeps the form', async () => {
    connectedWorkspace()
    mockSchemaApi({
      'POST /p/local/keyspaces/preview': { body: { statement: ALTER, errors: [], notes: [] } },
      'POST /p/local/query': { status: 400, body: { error: { code: 'bad', message: 'boom' } } },
    })
    render(<EditKeyspaceDialog keyspace="payments" onChanged={vi.fn()} onClose={vi.fn()} />)
    const apply = await screen.findByRole('button', { name: 'Apply changes' })
    await waitFor(() => expect(apply).toBeEnabled())
    await userEvent.click(apply)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
  })
})
