import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { UserMenu } from './UserMenu'
import { renderWithClient as render, mockApi } from '../test/api'
import { useSession } from '../store/session'
import { useWorkspace } from '../store/workspace'

describe('UserMenu', () => {
  it('signs out, revoking the session and clearing the workspace', async () => {
    useSession.setState({ user: 'alice', expired: false })
    useWorkspace.setState({ tabs: [{ id: 'q', kind: 'query', title: 'q.cql', keyspace: '', object: '', closable: true }], activeId: 'q' })
    const calls = mockApi({ 'POST /auth/logout': { status: 204 } })
    render(<UserMenu username="alice" />)
    await userEvent.click(screen.getByRole('button', { name: 'User menu: alice' }))
    expect(screen.getByRole('menu', { name: 'User' })).toHaveTextContent('Signed in as alice')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }))
    await waitFor(() => expect(useSession.getState().user).toBeNull())
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/logout' })
    expect(useWorkspace.getState().tabs).toEqual([])
  })
})
