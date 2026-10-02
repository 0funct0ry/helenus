import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TableView } from './TableView'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, tableTab, viewTab } from '../test/schemaFixture'
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
