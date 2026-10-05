import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SecurityView } from './SecurityView'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'
import { rolesData } from '../test/rolesFixture'

describe('SecurityView', () => {
  beforeEach(() => connectedWorkspace())

  it('lists roles and opens the new-role dialog', async () => {
    mockApi({ 'GET /p/local/roles': rolesData, 'GET /p/local/roles/cassandra/permissions': { authorizer_enabled: true, permissions: [] } })
    render(<SecurityView />)
    expect(await screen.findByRole('button', { name: /analyst/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'New role…' }))
    expect(screen.getByRole('dialog', { name: 'New role' })).toBeInTheDocument()
  })

  it('explains and disables everything when auth is off', async () => {
    mockApi({ 'GET /p/local/roles': { ...rolesData, auth_enabled: false, roles: [] } })
    render(<SecurityView />)
    expect(await screen.findByText(/Authentication is disabled on this cluster \(AllowAllAuthenticator\); roles have no effect/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New role…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Edit role…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Drop role…' })).toBeDisabled()
  })
})
