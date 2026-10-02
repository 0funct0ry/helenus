import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TableView } from './TableView'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, rowsResponse, tableTab, viewTab } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

describe('TableView', () => {
  beforeEach(() => {
    connectedWorkspace([tableTab])
    mockSchemaApi()
  })

  it('shows Data with real column markers, then switches sub-views', async () => {
    render(<TableView tab={tableTab} />)
    expect(await screen.findByRole('table', { name: 'Results' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Schema' }))
    expect(screen.getByRole('heading', { name: 'Primary key' })).toBeInTheDocument()
    expect(screen.getByText('default_time_to_live')).toBeInTheDocument()
    expect(screen.getByText('txn_by_currency_sai')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'DDL' }))
    expect(await screen.findByLabelText('DDL')).toHaveTextContent('CREATE TABLE payments.transactions_by_merchant')
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }))
    expect(screen.getByText('transactions_by_status')).toBeInTheDocument()
  })
  it('loads real rows read-only with elapsed time and paging', async () => {
    const calls = mockSchemaApi({
      'POST /p/local/query': (c: { body?: unknown }) =>
        (c.body as { page_state: string | null }).page_state ? { body: rowsResponse({ rows: [['PAGE TWO', '2']] }) } : { body: rowsResponse({ has_more: true, page_state: 'P2' }) },
    })
    render(<TableView tab={tableTab} />)
    expect(await screen.findByText('SETTLED')).toBeInTheDocument()
    expect(screen.getByText('12.5 ms')).toBeInTheDocument()
    const first = calls.find((c) => c.path === '/p/local/query')?.body
    expect(first).toMatchObject({ cql: 'SELECT * FROM payments.transactions_by_merchant;', keyspace: 'payments', page_size: 100, page_state: null })
    await userEvent.click(screen.getByRole('button', { name: 'Next page' }))
    expect(await screen.findByText('PAGE TWO')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Previous page' }))
    expect(await screen.findByText('SETTLED')).toBeInTheDocument()
  })
  it('shows a query failure in the Data sub-view', async () => {
    mockSchemaApi({ 'POST /p/local/query': { status: 502, body: { error: { code: 'query_failed', message: 'read timeout' } } } })
    render(<TableView tab={tableTab} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('read timeout')
  })
  it('counts rows after confirmation', async () => {
    mockSchemaApi({
      'POST /p/local/query': (c: { body?: unknown }) =>
        /COUNT/.test((c.body as { cql: string }).cql) ? { body: rowsResponse({ columns: [{ name: 'count', type: { name: 'bigint' } }], rows: [['9001']] }) } : { body: rowsResponse() },
    })
    render(<TableView tab={tableTab} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Count rows' }))
    await userEvent.click(screen.getAllByRole('button', { name: 'Count rows' }).at(-1)!)
    expect(await screen.findByText('9001')).toBeInTheDocument()
  })
  it('opens a view from the Views sub-view', async () => {
    render(<TableView tab={tableTab} />)
    await userEvent.click(await screen.findByRole('tab', { name: /Views/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(useWorkspace.getState().activeId).toBe('view:payments.transactions_by_status')
  })
  it('hides the Views sub-view for materialized views', async () => {
    render(<TableView tab={viewTab} />)
    expect(await screen.findByRole('button', { name: /Insert row/ })).toBeDisabled()
    expect(screen.queryByRole('tab', { name: /Views/ })).not.toBeInTheDocument()
  })
  it('opens the DDL in a query tab', async () => {
    render(<TableView tab={tableTab} />)
    await userEvent.click(await screen.findByRole('tab', { name: 'DDL' }))
    await screen.findByText(/CREATE TABLE payments/)
    await userEvent.click(screen.getByRole('button', { name: /Open in query tab/ }))
    expect(useWorkspace.getState().tabs.at(-1)).toMatchObject({ kind: 'query', keyspace: 'payments' })
  })
  it('says so when the table is not in the schema', async () => {
    const gone: WorkspaceTab = { ...tableTab, object: 'dropped' }
    render(<TableView tab={gone} />)
    expect(await screen.findByText(/payments.dropped is not in the current schema/)).toBeInTheDocument()
  })
  it('changes consistency through the custom select', async () => {
    render(<TableView tab={tableTab} />)
    await userEvent.click(await screen.findByRole('button', { name: /Consistency/ }))
    await userEvent.click(screen.getByRole('option', { name: 'QUORUM' }))
    expect(useWorkspace.getState().consistency).toBe('QUORUM')
    useWorkspace.getState().setConsistency('LOCAL_QUORUM')
  })
})
