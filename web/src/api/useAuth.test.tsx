import { screen, waitFor } from '@testing-library/react'
import { App } from '../App'
import { renderWithClient as render } from '../test/api'
import { connectedWorkspace, mockSchemaApi, queryTab } from '../test/schemaFixture'
import { useSession } from '../store/session'
import { useWorkspace } from '../store/workspace'

describe('sign-in gate', () => {
  beforeEach(() => {
    useSession.setState({ user: null, expired: false })
    connectedWorkspace([queryTab])
  })

  it('shows the sign-in screen when auth is on and nobody is signed in', async () => {
    mockSchemaApi({ 'GET /meta': { version: 't', auth_enabled: true }, 'GET /profiles': { profiles: [] } })
    render(<App />)
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
  })
  it('does not show it when auth is off', async () => {
    mockSchemaApi({ 'GET /meta': { version: 't', auth_enabled: false }, 'GET /profiles': { profiles: [] } })
    render(<App />)
    await screen.findByRole('banner')
    expect(screen.queryByRole('form', { name: 'Sign in' })).not.toBeInTheDocument()
  })
  it('returns to sign-in on a 401 and keeps the open tabs', async () => {
    mockSchemaApi({ 'GET /meta': { version: 't', auth_enabled: true, user: 'alice' }, 'GET /profiles': { status: 401, body: { error: { code: 'unauthorized', message: 'x' } } } })
    const tabs = useWorkspace.getState().tabs
    render(<App />)
    expect(await screen.findByRole('form', { name: 'Sign in' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText(/open tabs are kept/)).toBeInTheDocument())
    expect(useWorkspace.getState().tabs).toEqual(tabs)
  })
  it('shows the user menu and the insecure-bind warning', async () => {
    mockSchemaApi({ 'GET /meta': { version: 't', auth_enabled: true, user: 'alice', insecure_bind: true }, 'GET /profiles': { profiles: [] } })
    render(<App />)
    expect(await screen.findByRole('button', { name: 'User menu: alice' })).toBeInTheDocument()
    expect(await screen.findByText(/plain HTTP/)).toBeInTheDocument()
  })
})
