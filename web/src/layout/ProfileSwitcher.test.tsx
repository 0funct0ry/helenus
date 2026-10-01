import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileSwitcher } from './ProfileSwitcher'
import { useWorkspace } from '../store/workspace'
import { apiProfile, cluster, mockApi, renderWithClient as render } from '../test/api'

const profiles = [apiProfile({ name: 'local' }), apiProfile({ name: 'prod-eu', hosts: ['10.0.0.1', '10.0.0.2'] })]

describe('ProfileSwitcher', () => {
  beforeEach(() => useWorkspace.setState({ profileId: 'local', connections: {}, profileDialogOpen: false }))

  it('lists API profiles and connects the chosen one', async () => {
    const calls = mockApi({
      'GET /profiles': { profiles },
      'POST /p/prod-eu/connect': { body: { profile: 'prod-eu', connected: true, cluster, insecure_tls: false } },
    })
    render(<ProfileSwitcher />)
    await userEvent.click(await screen.findByRole('button', { name: /local/ }))
    expect(screen.getAllByRole('menuitemradio')).toHaveLength(2)
    await userEvent.click(screen.getByRole('menuitemradio', { name: /prod-eu/ }))
    expect(useWorkspace.getState().profileId).toBe('prod-eu')
    await waitFor(() => expect(useWorkspace.getState().connections['prod-eu']?.status).toBe('connected'))
    expect(calls.some((c) => c.method === 'POST' && c.path === '/p/prod-eu/connect')).toBe(true)
  })
  it('records a connection error with the failing stage', async () => {
    mockApi({
      'GET /profiles': { profiles },
      'POST /p/prod-eu/connect': { status: 502, body: { error: { code: 'connection_failed', message: 'x509: unknown authority', detail: { failed_stage: 'tls' } } } },
    })
    render(<ProfileSwitcher />)
    await userEvent.click(await screen.findByRole('button', { name: /local/ }))
    await userEvent.click(screen.getByRole('menuitemradio', { name: /prod-eu/ }))
    await waitFor(() => expect(useWorkspace.getState().connections['prod-eu']?.status).toBe('error'))
    expect(useWorkspace.getState().connections['prod-eu']?.error).toBe('Failed at the tls stage: x509: unknown authority')
    await userEvent.click(screen.getByRole('button', { name: /prod-eu/ }))
    expect(screen.getByText(/unknown authority/)).toBeInTheDocument()
    expect(screen.getAllByRole('img', { name: 'error' }).length).toBeGreaterThan(0)
  })
  it('opens the profile dialog', async () => {
    mockApi({ 'GET /profiles': { profiles } })
    render(<ProfileSwitcher />)
    await userEvent.click(await screen.findByRole('button', { name: /local/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: /Manage profiles/ }))
    expect(useWorkspace.getState().profileDialogOpen).toBe(true)
  })
})
