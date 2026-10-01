import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SchemaTree } from './SchemaTree'
import { useWorkspace } from '../store/workspace'

describe('SchemaTree', () => {
  it('shows keyspace groups and a collapsed System group', () => {
    render(<SchemaTree />)
    expect(screen.getByRole('treeitem', { name: /^payments/ })).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /^Tables/ })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /^Views/ })[0]).toBeInTheDocument()
    expect(screen.getAllByRole('treeitem', { name: /^Types/ })[0]).toBeInTheDocument()
    expect(screen.getByRole('treeitem', { name: /System/ })).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('system_auth')).not.toBeInTheDocument()
  })
  it('shows a key summary on hover (title)', () => {
    render(<SchemaTree />)
    expect(screen.getByRole('treeitem', { name: /transactions_by_merchant/ })).toHaveAttribute(
      'title',
      'PK (merchant_id, txn_day) · CK txn_time DESC',
    )
  })
  it('expands System on click', async () => {
    render(<SchemaTree />)
    await userEvent.click(screen.getByRole('treeitem', { name: /System/ }))
    expect(screen.getByText('system_auth')).toBeInTheDocument()
  })
  it('filters', async () => {
    render(<SchemaTree />)
    await userEvent.type(screen.getByLabelText('Filter schema'), 'ledger')
    expect(screen.getByRole('treeitem', { name: /ledger_counters/ })).toBeInTheDocument()
    expect(screen.queryByRole('treeitem', { name: /merchants$/ })).not.toBeInTheDocument()
  })
  it('opens a table in a tab', async () => {
    render(<SchemaTree />)
    await userEvent.click(screen.getByRole('treeitem', { name: /ledger_counters/ }))
    expect(useWorkspace.getState().activeId).toBe('table:payments.ledger_counters')
  })
})
