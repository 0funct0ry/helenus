import { screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'
import { useWorkspace } from '../store/workspace'
import { apiProfile, cluster, mockApi, renderWithClient as render } from '../test/api'

const reset = { profileId: '', connections: {}, consistency: 'LOCAL_QUORUM' }

describe('StatusBar', () => {
  afterEach(() => useWorkspace.setState(reset))

  it('shows version, datacenter and node count from /cluster', async () => {
    mockApi({
      'GET /profiles': { profiles: [apiProfile({ name: 'prod-eu', tls: { enabled: true, insecure_skip_verify: false } })] },
      'GET /p/prod-eu/cluster': cluster,
    })
    useWorkspace.setState({ ...reset, profileId: 'prod-eu', connections: { 'prod-eu': { status: 'connected' } } })
    render(<StatusBar />)
    expect(await screen.findByText('Cassandra 5.0.2')).toBeInTheDocument()
    expect(screen.getByText('eu-west-1 · 6 nodes')).toBeInTheDocument()
    expect(screen.getByText('TLS')).toBeInTheDocument()
    expect(screen.getByText('LOCAL_QUORUM')).toBeInTheDocument()
    expect(screen.queryByText('Insecure TLS')).not.toBeInTheDocument()
  })
  it('warns persistently when certificate verification is off', async () => {
    mockApi({ 'GET /profiles': { profiles: [apiProfile({ name: 'p', tls: { enabled: true, insecure_skip_verify: true } })] } })
    useWorkspace.setState({ ...reset, profileId: 'p' })
    render(<StatusBar />)
    expect(await screen.findByText('Insecure TLS')).toBeInTheDocument()
  })
  it('shows the connection error', async () => {
    mockApi({ 'GET /profiles': { profiles: [apiProfile({ name: 'p' })] } })
    useWorkspace.setState({ ...reset, profileId: 'p', connections: { p: { status: 'error', error: 'Failed at the tls stage: bad certificate' } } })
    render(<StatusBar />)
    expect(await screen.findByText(/bad certificate/)).toBeInTheDocument()
  })
  it('shows the cursor position on query tabs only', () => {
    mockApi({})
    useWorkspace.setState({ activeId: 'query-1', cursor: { line: 4, col: 12 } })
    const { unmount } = render(<StatusBar />)
    expect(screen.getByText('Ln 4, Col 12')).toBeInTheDocument()
    unmount()
    useWorkspace.setState({ activeId: 'type:payments.address' })
    render(<StatusBar />)
    expect(screen.queryByText(/Ln 4/)).not.toBeInTheDocument()
  })
})
