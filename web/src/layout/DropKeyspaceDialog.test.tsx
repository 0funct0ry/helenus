import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropKeyspaceDialog } from './DropKeyspaceDialog'
import { renderWithClient as render } from '../test/api'
import type { Call } from '../test/api'
import { connectedWorkspace, mockSchemaApi, rowsResponse } from '../test/schemaFixture'

function setup() {
  connectedWorkspace()
  const calls: Call[] = mockSchemaApi({
    'POST /p/local/keyspaces/preview': { body: { statement: 'DROP KEYSPACE payments;', errors: [], notes: [] } },
    'POST /p/local/query': { body: rowsResponse({ kind: 'schema_change', executed_cql: 'DROP KEYSPACE payments;' }) },
  })
  const onDropped = vi.fn()
  const onClose = vi.fn()
  render(<DropKeyspaceDialog keyspace="payments" onDropped={onDropped} onClose={onClose} />)
  return { calls, onDropped, onClose }
}

describe('DropKeyspaceDialog', () => {
  it('lists object counts', async () => {
    setup()
    const list = await screen.findByLabelText('Keyspace contents')
    await waitFor(() => expect(list).toHaveTextContent('Tables: 3'))
    for (const t of ['Views: 1', 'Types: 1', 'Functions: 1', 'Aggregates: 0', 'Indexes: 1']) expect(list).toHaveTextContent(t)
  })
  it('requires the exact name (case-sensitive) and drops once', async () => {
    const { calls, onDropped, onClose } = setup()
    const drop = screen.getByRole('button', { name: 'Drop keyspace' })
    const input = screen.getByLabelText('Type "payments" to confirm')
    await screen.findByText('DROP KEYSPACE payments;')
    await userEvent.type(input, 'Payments')
    expect(drop).toBeDisabled()
    await userEvent.clear(input)
    await userEvent.type(input, 'payments')
    expect(drop).toBeEnabled()
    await userEvent.dblClick(drop)
    await waitFor(() => expect(onDropped).toHaveBeenCalledWith('payments'))
    expect(onClose).toHaveBeenCalled()
    expect(calls.filter((c) => c.path.endsWith('/query'))).toHaveLength(1)
  })
})
