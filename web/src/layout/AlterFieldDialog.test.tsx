import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlterFieldDialog } from './AlterFieldDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import type { Call } from '../test/api'
import type { TypeRequest } from '../api/types'

const plan = (call: Call) => {
  const r = call.body as TypeRequest
  const stmt = r.action === 'add_field' ? `ALTER TYPE payments.address ADD ${r.field?.name};` : `ALTER TYPE payments.address RENAME ${r.from} TO ${r.to};`
  return { body: { statement: stmt, errors: [], notes: [], dependents: [] } }
}

describe('AlterFieldDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('adds a field and runs the statement', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/types/preview': plan })
    const onClose = vi.fn()
    render(<AlterFieldDialog keyspace="payments" type="address" mode="add" onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Field name' }), 'zip')
    expect(await screen.findByText('ALTER TYPE payments.address ADD zip;')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Field type' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(calls.find((c) => c.path === '/p/local/query')?.body).toMatchObject({ cql: 'ALTER TYPE payments.address ADD zip;' })
  })
  it('renames a field, with no type picker', async () => {
    const calls = mockSchemaApi({ 'POST /p/local/types/preview': plan })
    render(<AlterFieldDialog keyspace="payments" type="address" mode="rename" field="street" onClose={() => {}} />)
    const input = screen.getByRole('textbox', { name: 'New name for street' })
    await userEvent.clear(input)
    await userEvent.type(input, 'road')
    expect(await screen.findByText('ALTER TYPE payments.address RENAME street TO road;')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Field type' })).not.toBeInTheDocument()
    expect(calls.some((c) => c.path === '/p/local/types/preview')).toBe(true)
  })
})
