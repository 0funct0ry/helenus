import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoleDetail } from './RoleDetail'
import { renderWithClient as render, mockApi } from '../test/api'
import { connectedWorkspace } from '../test/schemaFixture'
import { rolesData } from '../test/rolesFixture'

const perms = { authorizer_enabled: true, permissions: [{ resource: { kind: 'keyspace', keyspace: 'shop' }, permission: 'SELECT' }] }

describe('RoleDetail', () => {
  beforeEach(() => connectedWorkspace())

  it('queues a GRANT from the matrix and reviews it', async () => {
    mockApi({
      'GET /p/local/roles/analyst/permissions': perms,
      'POST /p/local/roles/preview': { body: { statement: 'GRANT MODIFY ON KEYSPACE shop TO analyst;', errors: [], notes: [] } },
    })
    render(<RoleDetail role={rolesData.roles[1]} data={rolesData} />)
    expect(await screen.findByRole('checkbox', { name: 'SELECT on KEYSPACE shop' })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: 'MODIFY on KEYSPACE shop' }))
    expect(screen.getByText('1 pending permission change')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Review CQL' }))
    expect(await screen.findByLabelText('Statements')).toHaveTextContent('GRANT MODIFY ON KEYSPACE shop TO analyst;')
  })

  it('does not offer EXECUTE on keyspaces', async () => {
    mockApi({ 'GET /p/local/roles/analyst/permissions': perms })
    render(<RoleDetail role={rolesData.roles[1]} data={rolesData} />)
    await screen.findByRole('checkbox', { name: 'SELECT on KEYSPACE shop' })
    expect(screen.queryByRole('checkbox', { name: /EXECUTE on KEYSPACE/ })).not.toBeInTheDocument()
  })

  it('explains when the authorizer is off', async () => {
    mockApi({ 'GET /p/local/roles/analyst/permissions': { authorizer_enabled: false, permissions: [] } })
    render(<RoleDetail role={rolesData.roles[1]} data={rolesData} />)
    expect(await screen.findByText(/AllowAllAuthorizer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add resource' })).toBeDisabled()
  })
})
