import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TableView } from './TableView'
import { initialTabs, useWorkspace } from '../store/workspace'
import type { WorkspaceTab } from '../store/workspace'

const tab = initialTabs[0]

describe('TableView', () => {
  it('shows Data by default and switches sub-views', async () => {
    render(<TableView tab={tab} />)
    expect(screen.getByRole('table', { name: 'Results' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'Schema' }))
    expect(screen.getByRole('heading', { name: 'Primary key' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'DDL' }))
    expect(screen.getByLabelText('DDL')).toHaveTextContent('CREATE TABLE')
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }))
    expect(screen.getByText('transactions_by_status')).toBeInTheDocument()
  })
  it('opens a view from the Views sub-view', async () => {
    render(<TableView tab={tab} />)
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }))
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(useWorkspace.getState().activeId).toBe('view:payments.transactions_by_status')
  })
  it('hides the Views sub-view for materialized views', () => {
    const v: WorkspaceTab = { id: 'view:payments.transactions_by_status', kind: 'view', title: 'transactions_by_status', keyspace: 'payments', object: 'transactions_by_status', closable: true }
    render(<TableView tab={v} />)
    expect(screen.queryByRole('tab', { name: /Views/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Insert row/ })).toBeDisabled()
  })
  it('changes consistency through the custom select', async () => {
    render(<TableView tab={tab} />)
    await userEvent.click(screen.getByRole('button', { name: /Consistency/ }))
    await userEvent.click(screen.getByRole('option', { name: 'QUORUM' }))
    expect(useWorkspace.getState().consistency).toBe('QUORUM')
    useWorkspace.getState().setConsistency('LOCAL_QUORUM')
  })
})
