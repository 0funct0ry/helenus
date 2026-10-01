import { render, screen } from '@testing-library/react'
import { ConnectionTestResult } from './ConnectionTestResult'
import { cluster } from '../test/api'

describe('ConnectionTestResult', () => {
  it('renders nothing without a result or error', () => {
    const { container } = render(<ConnectionTestResult />)
    expect(container).toBeEmptyDOMElement()
  })
  it('shows a transport error', () => {
    render(<ConnectionTestResult error="network down" />)
    expect(screen.getByRole('alert')).toHaveTextContent('network down')
  })
  it('summarizes a successful test', () => {
    render(<ConnectionTestResult result={{ ok: true, rtt_ms: 41.6, stages: [{ name: 'dns', ok: true }], info: cluster }} />)
    expect(screen.getByRole('status')).toHaveTextContent('Connected in 42 ms')
    expect(screen.getByRole('status')).toHaveTextContent('Cassandra 5.0.2, 2 datacenters, 6 nodes')
  })
  it('names the failing stage and shows warnings', () => {
    render(
      <ConnectionTestResult
        result={{ ok: false, failed_stage: 'auth', stages: [{ name: 'tcp', ok: true }, { name: 'auth', ok: false, detail: 'bad credentials' }], warnings: ['insecure'] }}
      />,
    )
    expect(screen.getByText('Failed at the auth stage.')).toBeInTheDocument()
    expect(screen.getByText('bad credentials')).toBeInTheDocument()
    expect(screen.getByLabelText('failed')).toBeInTheDocument()
    expect(screen.getByLabelText('passed')).toBeInTheDocument()
    expect(screen.getByText('insecure')).toBeInTheDocument()
  })
})
