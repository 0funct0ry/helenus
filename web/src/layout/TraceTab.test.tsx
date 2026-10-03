import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TraceTab } from './TraceTab'
import { rowsResponse } from '../test/schemaFixture'
import type { TraceResponse } from '../api/types'

const data: TraceResponse = {
  id: 'tr-1',
  started_at: '2026-09-30T12:00:00Z',
  duration_us: 31700,
  summary: { coordinator: '10.0.0.1', request: 'Execute CQL3 query', coordinator_ms: 31.7, replicas_contacted: 0, event_count: 1, node_count: 1 },
  lanes: [{ node: '10.0.0.1', role: 'coordinator', bars: [{ start_us: 0, end_us: 0, label: 'Parsing' }] }],
  events: [{ activity: 'Parsing', source: '10.0.0.1', elapsed_us: 0, thread: 't', timestamp_ms: 0 }],
}
const traced = rowsResponse({ trace_id: 'tr-1' })

describe('TraceTab', () => {
  it('hints to turn tracing on when the statement was not traced', () => {
    render(<TraceTab response={rowsResponse()} />)
    expect(screen.getByText(/Turn on Trace/)).toBeInTheDocument()
  })
  it('waits while the trace loads', () => {
    render(<TraceTab response={traced} trace={{ loading: true, onRetry: vi.fn() }} />)
    expect(screen.getByText(/Waiting for Cassandra/)).toBeInTheDocument()
  })
  it('shows the viewer once loaded', () => {
    render(<TraceTab response={traced} trace={{ data, loading: false, onRetry: vi.fn() }} />)
    expect(screen.getByRole('img', { name: 'Trace waterfall' })).toBeInTheDocument()
  })
  it('offers a retry when the trace is not yet available', async () => {
    const onRetry = vi.fn()
    render(<TraceTab response={traced} trace={{ loading: false, error: { code: 'trace_unavailable', message: 'x' }, onRetry }} />)
    expect(screen.getByText('Trace not yet available')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalled()
  })
  it('shows other errors with a retry', () => {
    render(<TraceTab response={traced} trace={{ loading: false, error: { code: 'trace_failed', message: 'node down' }, onRetry: vi.fn() }} />)
    expect(screen.getByText('node down')).toBeInTheDocument()
  })
})
