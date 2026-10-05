import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EditRoleDialog } from './EditRoleDialog'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'
import { rolesData } from '../test/rolesFixture'

describe('EditRoleDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('saves flag changes without a password', async () => {
    const calls = mockApi({
      'POST /p/local/roles/preview': { body: { statement: 'ALTER ROLE analyst WITH LOGIN = true AND SUPERUSER = true;', errors: [], notes: [] } },
      'POST /p/local/roles/apply': { body: { ok: true } },
    })
    const onSaved = vi.fn()
    render(<EditRoleDialog role={rolesData.roles[1]} onSaved={onSaved} onClose={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Superuser' }))
    await vi.waitFor(() => expect(screen.getByRole('button', { name: 'Save role' })).toBeEnabled())
    await userEvent.click(screen.getByRole('button', { name: 'Save role' }))
    expect(onSaved).toHaveBeenCalled()
    const applied = calls.find((c) => c.path === '/p/local/roles/apply')?.body as Record<string, unknown>
    expect(applied.password).toBeUndefined()
    expect(applied.superuser).toBe(true)
  })
})
