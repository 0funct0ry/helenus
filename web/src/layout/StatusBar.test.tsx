import { render, screen } from '@testing-library/react'
import { StatusBar } from './StatusBar'
import { useWorkspace } from '../store/workspace'

describe('StatusBar', () => {
  it('shows connection details and consistency', () => {
    useWorkspace.setState({ profileId: 'prod-eu', consistency: 'LOCAL_QUORUM' })
    render(<StatusBar />)
    expect(screen.getByText('prod-eu')).toBeInTheDocument()
    expect(screen.getByText('Cassandra 5.0.2')).toBeInTheDocument()
    expect(screen.getByText('TLS')).toBeInTheDocument()
    expect(screen.getByText('LOCAL_QUORUM')).toBeInTheDocument()
  })
  it('shows the cursor position on query tabs only', () => {
    useWorkspace.setState({ activeId: 'query-1', cursor: { line: 4, col: 12 } })
    const { unmount } = render(<StatusBar />)
    expect(screen.getByText('Ln 4, Col 12')).toBeInTheDocument()
    unmount()
    useWorkspace.setState({ activeId: 'type:payments.address' })
    render(<StatusBar />)
    expect(screen.queryByText(/Ln 4/)).not.toBeInTheDocument()
  })
  it('shows profile errors', () => {
    useWorkspace.setState({ profileId: 'astra-dev' })
    render(<StatusBar />)
    expect(screen.getByText(/expired/)).toBeInTheDocument()
    useWorkspace.setState({ profileId: 'prod-eu' })
  })
})
