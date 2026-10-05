import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { NewRoleDialog } from './NewRoleDialog'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'

describe('NewRoleDialog', () => {
  beforeEach(() => connectedWorkspace())

  it('previews a masked password and applies through /roles/apply', async () => {
    const calls = mockApi({
      'POST /p/local/roles/preview': { body: { statement: "CREATE ROLE analyst WITH PASSWORD = '••••••' AND LOGIN = true AND SUPERUSER = false;", errors: [], notes: [] } },
      'POST /p/local/roles/apply': { body: { ok: true } },
    })
    const onCreated = vi.fn()
    render(<NewRoleDialog onCreated={onCreated} onClose={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Role name'), 'analyst')
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'longenough1')
    expect(await screen.findByText(/PASSWORD = '••••••'/)).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('longenough1')
    await userEvent.click(screen.getByRole('button', { name: 'Create role' }))
    expect(onCreated).toHaveBeenCalledWith('analyst')
    expect(calls.some((c) => c.path === '/p/local/roles/apply')).toBe(true)
    expect(calls.some((c) => c.path.endsWith('/query'))).toBe(false)
  })

  it('blocks a mismatched confirmation', async () => {
    mockApi({ 'POST /p/local/roles/preview': { body: { statement: 'CREATE ROLE a;', errors: [], notes: [] } } })
    render(<NewRoleDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Role name'), 'a')
    await userEvent.type(screen.getByLabelText('Password'), 'longenough1')
    await userEvent.type(screen.getByLabelText('Confirm password'), 'different11')
    expect(screen.getByText('Passwords do not match')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create role' })).toBeDisabled()
  })

  it('keeps inputs and shows a server error inline', async () => {
    mockApi({
      'POST /p/local/roles/preview': { body: { statement: 'CREATE ROLE a;', errors: [], notes: [] } },
      'POST /p/local/roles/apply': { status: 400, body: { error: { code: 'query_failed', message: 'Boom' } } },
    })
    render(<NewRoleDialog onCreated={vi.fn()} onClose={vi.fn()} />)
    await userEvent.type(screen.getByLabelText('Role name'), 'a')
    const btn = screen.getByRole('button', { name: 'Create role' })
    await vi.waitFor(() => expect(btn).toBeEnabled())
    await userEvent.click(btn)
    expect(await screen.findByText('Boom')).toBeInTheDocument()
    expect(screen.getByLabelText('Role name')).toHaveValue('a')
  })
})
