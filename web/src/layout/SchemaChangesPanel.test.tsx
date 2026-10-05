import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaChangesPanel } from './SchemaChangesPanel'
import { mockApi, renderWithClient as render } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'
import type { SchemaChange } from '../api/types'

function change(over: Partial<SchemaChange>): SchemaChange {
  return {
    id: 1, keyspace: 'shop', object_kind: 'type', object_name: 'addr', action: 'create', statement: 'CREATE TYPE shop.addr (a text);',
    reverse: 'DROP TYPE shop.addr;', reverse_note: '', status: 'ok', error: '', duration_ms: 12, created_at: new Date().toISOString(), ...over,
  }
}

describe('SchemaChangesPanel', () => {
  beforeEach(() => connectedWorkspace([]))

  it('lists entries and expands one to show the statement and reverse', async () => {
    mockApi({ 'GET /p/local/schema-changes?limit=50': { items: [change({})], next_before: null } })
    render(<SchemaChangesPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /shop\.addr/ }))
    expect(screen.getByText('CREATE TYPE shop.addr (a text);')).toBeInTheDocument()
    expect(screen.getByText('DROP TYPE shop.addr;')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'ok' })).toBeInTheDocument()
  })

  it('opens the reverse in a new query tab without running anything', async () => {
    const calls = mockApi({ 'GET /p/local/schema-changes?limit=50': { items: [change({})], next_before: null } })
    render(<SchemaChangesPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /shop\.addr/ }))
    await userEvent.click(screen.getByRole('button', { name: /Open reverse in editor/ }))
    const st = useWorkspace.getState()
    expect(st.tabs.at(-1)?.kind).toBe('query')
    expect(st.queryStates[st.activeId].text).toBe('DROP TYPE shop.addr;')
    expect(calls.some((c) => c.path.endsWith('/query'))).toBe(false)
  })

  it('shows the error and disables the reverse action when there is none', async () => {
    mockApi({ 'GET /p/local/schema-changes?limit=50': { items: [change({ status: 'error', error: 'already exists', reverse: '' })], next_before: null } })
    render(<SchemaChangesPanel />)
    await userEvent.click(await screen.findByRole('button', { name: /shop\.addr/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('button', { name: /Open reverse in editor/ })).toBeDisabled()
  })

  it('loads the next page with the cursor', async () => {
    const calls = mockApi({
      'GET /p/local/schema-changes?limit=50': { items: [change({ id: 5 })], next_before: 5 },
      'GET /p/local/schema-changes?limit=50&before=5': { items: [change({ id: 4, object_name: 'older' })], next_before: null },
    })
    render(<SchemaChangesPanel />)
    await userEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByRole('button', { name: /shop\.older/ })).toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('before=5'))).toBe(true)
  })

  it('searches server-side', async () => {
    const calls = mockApi({
      'GET /p/local/schema-changes?limit=50': { items: [change({})], next_before: null },
      'GET /p/local/schema-changes?limit=50&q=users': { items: [], next_before: null },
    })
    render(<SchemaChangesPanel />)
    await screen.findByRole('button', { name: /shop\.addr/ })
    await userEvent.type(screen.getByLabelText('Search schema changes'), 'users')
    expect(await screen.findByText('No changes match the search.')).toBeInTheDocument()
    expect(calls.some((c) => c.path.endsWith('q=users'))).toBe(true)
  })

  it('clears the history only after confirmation', async () => {
    const calls = mockApi({
      'GET /p/local/schema-changes?limit=50': { items: [change({})], next_before: null },
      'DELETE /p/local/schema-changes': { deleted: 1 },
    })
    render(<SchemaChangesPanel />)
    await screen.findByRole('button', { name: /shop\.addr/ })
    await userEvent.click(screen.getByRole('button', { name: 'Clear history' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear history' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })

  it('shows the empty state', async () => {
    mockApi({ 'GET /p/local/schema-changes?limit=50': { items: [], next_before: null } })
    render(<SchemaChangesPanel />)
    expect(await screen.findByText(/No schema changes yet/)).toBeInTheDocument()
  })
})
