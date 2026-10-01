import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileDialog } from './ProfileDialog'
import { useWorkspace } from '../store/workspace'
import { apiProfile, cluster, mockApi, renderWithClient as render } from '../test/api'

const profiles = [
  apiProfile({ name: 'local', username: 'u', password_set: true }),
  apiProfile({ name: 'prod-eu', hosts: ['10.0.0.1', '10.0.0.2'], tls: { enabled: true, ca_cert: '/ca.pem', insecure_skip_verify: false } }),
]

const open = () => useWorkspace.setState({ profileDialogOpen: true, profileId: 'local', connections: {} })

describe('ProfileDialog', () => {
  afterEach(() => useWorkspace.setState({ profileDialogOpen: false, profileId: '' }))

  it('renders nothing when closed', () => {
    mockApi({})
    useWorkspace.setState({ profileDialogOpen: false })
    render(<ProfileDialog />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('lists profiles and fills the form from the selection', async () => {
    mockApi({ 'GET /profiles': { profiles } })
    open()
    render(<ProfileDialog />)
    expect(await screen.findAllByRole('option')).toHaveLength(2)
    expect(screen.getByLabelText('Profile name')).toHaveValue('local')
    await userEvent.click(screen.getByRole('option', { name: /prod-eu/ }))
    expect(screen.getByLabelText('Profile name')).toHaveValue('prod-eu')
    expect(screen.getByLabelText('Contact points')).toHaveValue('10.0.0.1, 10.0.0.2')
    expect(screen.getByLabelText('CA certificate')).toHaveValue('/ca.pem')
  })

  it('shows a stored password as saved and never exposes it', async () => {
    mockApi({ 'GET /profiles': { profiles } })
    open()
    render(<ProfileDialog />)
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(document.querySelector('input[type=password]')).toBeNull()
  })

  it('saves edits without sending an untouched password, then connects', async () => {
    const calls = mockApi({
      'GET /profiles': { profiles },
      'PUT /profiles/local': { body: profiles[0] },
      'POST /p/local/connect': { body: { profile: 'local', connected: true, cluster, insecure_tls: false } },
    })
    open()
    render(<ProfileDialog />)
    const ks = await screen.findByLabelText('Keyspace')
    await userEvent.type(ks, 'payments')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(useWorkspace.getState().profileDialogOpen).toBe(false))
    const put = calls.find((c) => c.method === 'PUT')!
    const body = put.body as Record<string, unknown>
    expect(body.keyspace).toBe('payments')
    expect(body.password).toBe('')
    expect(body.name).toBeUndefined()
    expect(calls.some((c) => c.path === '/p/local/connect')).toBe(true)
  })

  it('creates a new profile with a typed password', async () => {
    const calls = mockApi({
      'GET /profiles': { profiles },
      'POST /profiles': { status: 201, body: apiProfile({ name: 'new' }) },
      'POST /p/new/connect': { body: { profile: 'new', connected: true, cluster, insecure_tls: false } },
    })
    open()
    render(<ProfileDialog />)
    await userEvent.click(await screen.findByRole('button', { name: 'New profile' }))
    await userEvent.type(screen.getByLabelText('Profile name'), 'new')
    await userEvent.type(screen.getByLabelText('Password'), 'pw1')
    await userEvent.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/profiles')).toBe(true))
    const body = calls.find((c) => c.method === 'POST' && c.path === '/profiles')!.body as Record<string, unknown>
    expect(body).toMatchObject({ name: 'new', password: 'pw1', hosts: ['127.0.0.1'] })
  })

  it('shows save errors from the API', async () => {
    mockApi({ 'GET /profiles': { profiles }, 'PUT /profiles/local': { status: 400, body: { error: { code: 'invalid_request', message: 'bad port' } } } })
    open()
    render(<ProfileDialog />)
    await userEvent.click(await screen.findByRole('button', { name: 'Save profile' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bad port')
    expect(useWorkspace.getState().profileDialogOpen).toBe(true)
  })

  it('tests the unsaved form and shows the stages', async () => {
    const calls = mockApi({
      'GET /profiles': { profiles },
      'POST /profiles/test': {
        body: {
          ok: false, failed_stage: 'tls', error: 'x509: certificate signed by unknown authority',
          stages: [{ name: 'dns', ok: true }, { name: 'tcp', ok: true }, { name: 'tls', ok: false, detail: 'x509: certificate signed by unknown authority' }],
        },
      },
    })
    open()
    render(<ProfileDialog />)
    await userEvent.click(await screen.findByRole('button', { name: 'Test connection' }))
    const result = await screen.findByRole('status', { name: 'Connection test result' })
    expect(within(result).getByText('Failed at the tls stage.')).toBeInTheDocument()
    expect(within(result).getAllByRole('listitem')).toHaveLength(3)
    expect((calls.find((c) => c.path === '/profiles/test')!.body as Record<string, unknown>).name).toBe('local')
  })

  it('asks for confirmation before deleting', async () => {
    const calls = mockApi({ 'GET /profiles': { profiles }, 'DELETE /profiles/local': { status: 204 } })
    open()
    render(<ProfileDialog />)
    await userEvent.click(await screen.findByRole('button', { name: /Delete profile/ }))
    const confirm = screen.getByRole('dialog', { name: 'Delete profile' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: /Delete profile/ }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Delete profile' })).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE' && c.path === '/profiles/local')).toBe(true))
  })

  it('switches to the Astra tab and uploads a bundle', async () => {
    const calls = mockApi({
      'GET /profiles': { profiles },
      'POST /profiles/astra/bundle': { body: { path: '/data/bundles/b.zip', host: 'h', keyspace: 'inv', local_dc: 'dc' } },
    })
    open()
    render(<ProfileDialog />)
    await userEvent.click(await screen.findByRole('tab', { name: 'Astra DB' }))
    expect(screen.getByLabelText('Secure connect bundle')).toBeInTheDocument()
    await userEvent.upload(screen.getByLabelText('Upload secure connect bundle'), new File(['x'], 'b.zip', { type: 'application/zip' }))
    await waitFor(() => expect(screen.getByLabelText('Secure connect bundle')).toHaveValue('/data/bundles/b.zip'))
    expect(screen.getByLabelText('Keyspace')).toHaveValue('inv')
    expect(calls.some((c) => c.path === '/profiles/astra/bundle')).toBe(true)
  })
})
