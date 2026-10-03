import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewTypeDialog } from './NewTypeDialog'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'
import type { Call } from '../test/api'
import type { TypeRequest } from '../api/types'

const planFor = (call: Call) => {
  const r = call.body as TypeRequest
  const named = !!r.name && !!r.fields?.every((f) => f.name)
  return { body: { statement: named ? `CREATE TYPE ${r.keyspace}.${r.name} (${r.fields?.map((f) => f.name).join(', ')});` : '', errors: named ? [] : ['type name is required'], notes: [], dependents: [] } }
}

describe('NewTypeDialog', () => {
  let calls: Call[]
  beforeEach(() => {
    connectedWorkspace()
    calls = mockSchemaApi({ 'POST /p/local/types/preview': planFor })
  })

  it('previews live, then creates the type and opens its tab', async () => {
    const onClose = vi.fn()
    render(<NewTypeDialog keyspace="payments" onClose={onClose} />)
    expect(screen.getByRole('button', { name: 'Create type' })).toBeDisabled()
    await userEvent.type(screen.getByRole('textbox', { name: 'Type name' }), 'geo_point')
    await userEvent.type(screen.getByRole('textbox', { name: 'Field 1 name' }), 'lat')
    expect(await screen.findByText('CREATE TYPE payments.geo_point (lat);')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add field' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Field 2 name' }), 'lon')
    expect(await screen.findByText('CREATE TYPE payments.geo_point (lat, lon);')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Create type' }))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    const query = calls.find((c) => c.path === '/p/local/query')
    expect(query?.body).toMatchObject({ cql: 'CREATE TYPE payments.geo_point (lat, lon);', keyspace: 'payments' })
    expect(useWorkspace.getState().tabs.some((t) => t.id === 'type:payments.geo_point')).toBe(true)
  })
  it('shows server errors and keeps Create disabled', async () => {
    render(<NewTypeDialog keyspace="payments" onClose={() => {}} />)
    expect(await screen.findByText('type name is required')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create type' })).toBeDisabled()
  })
  it('shows an execution error and stays open', async () => {
    mockSchemaApi({ 'POST /p/local/types/preview': planFor, 'POST /p/local/query': { status: 400, body: { error: { code: 'query_failed', message: 'boom' } } } })
    const onClose = vi.fn()
    render(<NewTypeDialog keyspace="payments" onClose={onClose} />)
    await userEvent.type(screen.getByRole('textbox', { name: 'Type name' }), 'x')
    await userEvent.type(screen.getByRole('textbox', { name: 'Field 1 name' }), 'a')
    await screen.findByText('CREATE TYPE payments.x (a);')
    await userEvent.click(screen.getByRole('button', { name: 'Create type' }))
    expect(await screen.findByText(/boom/)).toBeInTheDocument()
    expect(onClose).not.toHaveBeenCalled()
  })
})
