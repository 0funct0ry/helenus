import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DropRoleDialog } from './DropRoleDialog'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'

describe('DropRoleDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('requires the role name', async () => {
    mockApi({
      'POST /p/local/roles/preview': { body: { statement: 'DROP ROLE analyst;', errors: [], notes: [] } },
      'POST /p/local/roles/apply': { body: { ok: true } },
    })
    const onDropped = vi.fn()
    render(<DropRoleDialog role="analyst" onDropped={onDropped} onClose={vi.fn()} />)
    const drop = screen.getByRole('button', { name: 'Drop role' })
    expect(drop).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Type "analyst" to confirm'), 'analyst')
    await vi.waitFor(() => expect(drop).toBeEnabled())
    await userEvent.click(drop)
    expect(onDropped).toHaveBeenCalled()
  })

  it('blocks dropping the connected role', async () => {
    mockApi({ 'POST /p/local/roles/preview': { body: { statement: '', errors: [{ field: 'role', message: 'You are signed in as cassandra' }], notes: [] } } })
    render(<DropRoleDialog role="cassandra" onDropped={vi.fn()} onClose={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Type "cassandra" to confirm'), 'cassandra')
    expect(await screen.findByText('You are signed in as cassandra')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Drop role' })).toBeDisabled()
  })
})
