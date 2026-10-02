import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaTree } from './SchemaTree'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, tableTab } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'

const loaded = async () => screen.findByRole('treeitem', { name: /^payments/ })

describe('SchemaTree', () => {
  beforeEach(() => {
    connectedWorkspace()
    mockSchemaApi()
  })

  it('asks to connect when no profile is connected', () => {
    useWorkspace.setState({ connections: {} })
    render(<SchemaTree />)
    expect(screen.getByText('Connect a profile to browse its schema.')).toBeInTheDocument()
  })
  it('shows keyspace groups from the real schema and a collapsed System group', async () => {
    render(<SchemaTree />)
    await loaded()
    expect(screen.getAllByRole('treeitem', { name: /^Tables/ })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /^Views/ })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /^Types/ })[0]).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /System/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('system_auth')).not.toBeInTheDocument()
    expect(screen.getAllByText('NTS · eu-west-1:3')).toHaveLength(2)
    expect(screen.getAllByText('2 keyspaces')).toHaveLength(2) // footer count and the System group
    expect(screen.getByText('4 tables')).toBeInTheDocument()
  })
  it('shows a key summary on hover (title)', async () => {
    render(<SchemaTree />)
    await loaded()
    expect(screen.getByRole('treeitem', { name: /^transactions_by_merchant/ })).toHaveAttribute('title', 'PK (merchant_id, txn_day) · CK txn_time DESC')
  })
  it('lists a materialized view under Views and under its base table', async () => {
    render(<SchemaTree />)
    await loaded()
    expect(screen.getAllByRole('treeitem', { name: /transactions_by_status/ })).toHaveLength(2)
  })
  it('expands System on click', async () => {
    render(<SchemaTree />)
    await loaded()
    await userEvent.click(screen.getByRole('treeitem', { name: /System/ }))
    expect(screen.getByText('system_auth')).toBeInTheDocument()
  })
  it('filters', async () => {
    render(<SchemaTree />)
    await loaded()
    await userEvent.type(screen.getByLabelText('Filter schema'), 'ledger')
    expect(screen.getByRole('treeitem', { name: /ledger_counters/ })).toBeInTheDocument()
    expect(screen.queryByRole('treeitem', { name: /^merchants/ })).not.toBeInTheDocument()
  })
  it('opens a table in a tab and shows its columns with markers', async () => {
    useWorkspace.setState({ tabs: [tableTab], activeId: tableTab.id })
    render(<SchemaTree />)
    await loaded()
    expect(screen.getByLabelText('Partition key 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Clustering key 1 DESC')).toBeInTheDocument()
    expect(screen.getByLabelText('Static column')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('treeitem', { name: /^ledger_counters/ }))
    expect(useWorkspace.getState().activeId).toBe('table:payments.ledger_counters')
  })
  it('refreshes the schema from the toolbar', async () => {
    const calls = mockSchemaApi()
    render(<SchemaTree />)
    await loaded()
    await userEvent.click(screen.getByRole('button', { name: 'Refresh schema' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path.endsWith('/schema/refresh'))).toBe(true))
  })
  it('shows an error with retry when the schema cannot be read', async () => {
    mockSchemaApi({ 'GET /p/local/schema': { status: 502, body: { error: { code: 'schema_failed', message: 'boom' } } } })
    render(<SchemaTree />)
    expect(await screen.findByRole('alert')).toHaveTextContent('boom')
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  describe('context menu', () => {
    it('opens on right-click with the five actions', async () => {
      render(<SchemaTree />)
      await loaded()
      await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name: /^ledger_counters/ }) })
      const menu = screen.getByRole('menu', { name: 'payments.ledger_counters' })
      expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map((e) => e.textContent)).toEqual(['Open', 'New query here', 'Copy name', 'Copy DDL', 'Refresh'])
    })
    it('"New query here" prefills a SELECT', async () => {
      render(<SchemaTree />)
      await loaded()
      await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name: /^ledger_counters/ }) })
      await userEvent.click(screen.getByRole('menuitem', { name: 'New query here' }))
      const tab = useWorkspace.getState().tabs.at(-1)
      expect(tab).toMatchObject({ kind: 'query', keyspace: 'payments', initialCql: 'SELECT * FROM payments.ledger_counters LIMIT 100;' })
    })
    it('"Open" opens the object', async () => {
      render(<SchemaTree />)
      await loaded()
      await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name: /^address/ }) })
      await userEvent.click(screen.getByRole('menuitem', { name: 'Open' }))
      expect(useWorkspace.getState().activeId).toBe('type:payments.address')
    })
    it('"Copy DDL" fetches DESCRIBE output and copies it', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      render(<SchemaTree />)
      await loaded()
      await userEvent.pointer({ keys: '[MouseRight]', target: screen.getByRole('treeitem', { name: /^transactions_by_merchant/ }) })
      await userEvent.click(screen.getByRole('menuitem', { name: 'Copy DDL' }))
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('CREATE TABLE payments.transactions_by_merchant')))
    })
  })
})
