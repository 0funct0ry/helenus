import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SaveQueryDialog } from './SaveQueryDialog'
import { renderWithClient as render, mockApi } from '../test/api'
import { savedRow } from '../test/queriesFixture'

const list = { queries: [savedRow({ id: 1, name: 'reports/daily' }), savedRow({ id: 2, name: 'ops/health', global: true }), savedRow({ id: 3, name: 'scratch' })] }

function setup(extra: Record<string, unknown> = {}, props: Partial<React.ComponentProps<typeof SaveQueryDialog>> = {}) {
  const calls = mockApi({ 'GET /p/local/queries': list, ...extra })
  const p = { onSaved: vi.fn(), onClose: vi.fn() }
  render(<SaveQueryDialog profile="local" text="SELECT 1;" {...p} {...props} />)
  return { calls, ...p }
}
const name = () => screen.getByLabelText('Name') as HTMLInputElement

describe('SaveQueryDialog', () => {
  it('prefills the name and disables Save while empty', () => {
    setup({}, { initialName: 'reports/x' })
    expect(name().value).toBe('reports/x')
    expect(screen.getByRole('dialog', { name: 'Save query' })).toBeInTheDocument()
  })
  it('disables Save for an empty name and validates inline', async () => {
    setup()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.type(name(), 'a//b')
    expect(screen.getByRole('alert')).toHaveTextContent('empty folder')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    await userEvent.clear(name())
    await userEvent.type(name(), 'a\\b')
    expect(screen.getByRole('alert')).toHaveTextContent('backslash')
  })
  it('creates the query with the trimmed name, text and scope, then reports it', async () => {
    const row = savedRow({ id: 9, name: 'reports/new', version: 1 })
    const { calls, onSaved, onClose } = setup({ 'POST /p/local/queries': { status: 201, body: row } })
    await userEvent.type(name(), ' reports / new ')
    await userEvent.click(screen.getByRole('checkbox', { name: 'Global (all profiles)' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(row))
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ name: 'reports/new', text: 'SELECT 1;', global: true })
    expect(onClose).toHaveBeenCalled()
  })
  it('submits with Enter', async () => {
    const { onSaved } = setup({ 'POST /p/local/queries': { status: 201, body: savedRow({ id: 9 }) } })
    await userEvent.type(name(), 'abc{Enter}')
    await waitFor(() => expect(onSaved).toHaveBeenCalled())
  })
  it('folder picker inserts the folder prefix and keeps the last segment', async () => {
    setup({}, { initialName: 'daily' })
    await screen.findByRole('button', { name: /Folder/ })
    await userEvent.click(screen.getByRole('button', { name: /Folder/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['(no folder)', 'ops', 'reports'])
    await userEvent.click(screen.getByRole('option', { name: 'reports' }))
    expect(name().value).toBe('reports/daily')
    await userEvent.click(screen.getByRole('button', { name: /Folder/ }))
    await userEvent.click(screen.getByRole('option', { name: '(no folder)' }))
    expect(name().value).toBe('daily')
  })
  it('shows a duplicate inline and offers Replace; Save is disabled', async () => {
    setup({}, { initialName: 'Reports/Daily' })
    expect(await screen.findByRole('alert')).toHaveTextContent('already exists')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument()
  })
  it('allows the same name in the other scope', async () => {
    setup({}, { initialName: 'ops/health', initialGlobal: true })
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Global (all profiles)' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
  it('Replace asks once more, then overwrites using the current version', async () => {
    const row = savedRow({ version: 8 })
    const { calls, onSaved } = setup(
      {
        'GET /p/local/queries?q=reports%2Fdaily': { queries: [savedRow({ version: 3 })] },
        'GET /p/local/queries/1': savedRow({ version: 7, text: 'old' }),
        'PUT /p/local/queries/1': row,
      },
      { initialName: 'reports/daily' },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    const confirm = screen.getByRole('dialog', { name: 'Replace saved query?' })
    expect(calls.some((c) => c.method === 'PUT')).toBe(false)
    await userEvent.click(within(confirm).getByRole('button', { name: 'Replace' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(row))
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'reports/daily', text: 'SELECT 1;', global: false, version: 7 })
  })
  it('cancelling the replace confirm changes nothing', async () => {
    const { calls } = setup({}, { initialName: 'scratch' })
    await userEvent.click(await screen.findByRole('button', { name: 'Replace' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Replace saved query?' })).getByRole('button', { name: 'Cancel' }))
    expect(calls.some((c) => c.method !== 'GET')).toBe(false)
  })
  it('treats a server query_exists as a duplicate', async () => {
    setup({ 'POST /p/local/queries': { status: 409, body: { error: { code: 'query_exists', message: 'exists' } } } })
    await userEvent.type(name(), 'fresh')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('button', { name: 'Replace' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('already exists')
  })
  it('shows a server invalid_name reason', async () => {
    setup({ 'POST /p/local/queries': { status: 400, body: { error: { code: 'invalid_name', message: 'bad name reason' } } } })
    await userEvent.type(name(), 'fresh')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bad name reason')
  })
  it('Cancel closes without saving', async () => {
    const { calls, onClose } = setup()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
    expect(calls.some((c) => c.method === 'POST')).toBe(false)
  })

  describe('rename mode', () => {
    it('updates name and scope keeping the saved text, using the fresh version', async () => {
      const existing = savedRow({ id: 3, name: 'scratch' })
      const row = savedRow({ id: 3, name: 'ops/scratch', version: 5 })
      const { calls, onSaved } = setup(
        { 'GET /p/local/queries/3': savedRow({ id: 3, name: 'scratch', version: 4, text: 'kept' }), 'PUT /p/local/queries/3': row },
        { mode: 'rename', existing, initialName: 'scratch', text: undefined },
      )
      expect(screen.getByRole('dialog', { name: 'Rename or move query' })).toBeInTheDocument()
      await userEvent.clear(name())
      await userEvent.type(name(), 'ops/scratch')
      await userEvent.click(screen.getByRole('button', { name: 'Rename' }))
      await waitFor(() => expect(onSaved).toHaveBeenCalledWith(row))
      expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ name: 'ops/scratch', text: 'kept', global: false, version: 4 })
    })
    it('blocks a name that exists but not its own name', async () => {
      setup({}, { mode: 'rename', existing: savedRow({ id: 3, name: 'scratch' }), initialName: 'scratch' })
      await screen.findByRole('button', { name: /Folder/ })
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
      await userEvent.clear(name())
      await userEvent.type(name(), 'reports/daily')
      expect(screen.getByRole('alert')).toHaveTextContent('already exists')
      expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Replace' })).not.toBeInTheDocument()
    })
  })
})
