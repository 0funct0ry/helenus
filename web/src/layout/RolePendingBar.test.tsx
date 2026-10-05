import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RolePendingBar } from './RolePendingBar'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'

const items = [
  { key: 'a', request: { action: 'grant' as const, role: 'analyst', permission: 'SELECT', resource: { kind: 'keyspace', keyspace: 'shop' } } },
  { key: 'b', request: { action: 'grant' as const, role: 'analyst', permission: 'MODIFY', resource: { kind: 'keyspace', keyspace: 'shop' } } },
]

describe('RolePendingBar', () => {
  beforeEach(() => connectedWorkspace())

  it('renders nothing when empty', () => {
    const { container } = render(<RolePendingBar items={[]} onDiscard={vi.fn()} onApplied={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows the reviewed CQL', async () => {
    mockApi({ 'POST /p/local/roles/preview': { body: { statement: 'GRANT SELECT ON KEYSPACE shop TO analyst;', errors: [], notes: [] } } })
    render(<RolePendingBar items={items} onDiscard={vi.fn()} onApplied={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Review CQL' }))
    expect(await screen.findByLabelText('Statements')).toHaveTextContent('GRANT SELECT ON KEYSPACE shop TO analyst;')
  })

  it('stops at the first failure', async () => {
    let n = 0
    const calls = mockApi({
      'POST /p/local/roles/apply': () => (++n === 1 ? { body: { ok: true } } : { status: 400, body: { error: { code: 'query_failed', message: 'Unauthorized' } } }),
    })
    const onApplied = vi.fn()
    render(<RolePendingBar items={[...items, { ...items[0], key: 'c' }]} onDiscard={vi.fn()} onApplied={onApplied} />)
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Unauthorized')
    expect(calls.filter((c) => c.path.endsWith('/roles/apply'))).toHaveLength(2)
    expect(onApplied).toHaveBeenCalledWith(['a'])
  })
})
