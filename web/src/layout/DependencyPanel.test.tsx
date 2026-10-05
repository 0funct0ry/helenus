import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DependencyPanel } from './DependencyPanel'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi } from '../test/schemaFixture'
import { useWorkspace } from '../store/workspace'

const path = 'GET /p/local/deps?kind=table&keyspace=payments&name=t'

describe('DependencyPanel', () => {
  beforeEach(() => connectedWorkspace([]))
  it('lists dependents with a lock badge and dependencies, and opens an item', async () => {
    mockSchemaApi({
      [path]: {
        dependents: [{ kind: 'view', keyspace: 'payments', name: 'v', via: 'base table', blocking: true }],
        dependencies: [{ kind: 'keyspace', keyspace: '', name: 'payments', via: 'keyspace', blocking: false }],
      },
    })
    render(<DependencyPanel kind="table" keyspace="payments" name="t" />)
    await userEvent.click(await screen.findByRole('button', { name: 'payments.v' }))
    expect(screen.getByText('via base table')).toBeInTheDocument()
    expect(screen.getByText('blocks drop')).toBeInTheDocument()
    expect(screen.getByText('payments')).toBeInTheDocument()
    expect(useWorkspace.getState().tabs.some((t) => t.id === 'view:payments.v')).toBe(true)
  })
  it('shows the empty state', async () => {
    mockSchemaApi({ [path]: { dependents: [], dependencies: [] } })
    render(<DependencyPanel kind="table" keyspace="payments" name="t" />)
    expect(await screen.findByText('Nothing depends on t')).toBeInTheDocument()
  })
  it('shows server errors inline', async () => {
    mockSchemaApi({})
    render(<DependencyPanel kind="table" keyspace="payments" name="t" />)
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})
