import { render, screen } from '@testing-library/react'
import { TraceView } from './TraceView'
import type { TraceResponse } from '../api/types'

const trace: TraceResponse = {
  id: '5b0f8a40-9c9d-11f1-8b3a-0242ac120002',
  started_at: '2026-09-30T12:00:00Z',
  duration_us: 31700,
  summary: { coordinator: '10.20.0.11', request: 'Execute CQL3 query', coordinator_ms: 31.7, replicas_contacted: 2, event_count: 4, node_count: 3 },
  lanes: [
    { node: '10.20.0.11', role: 'coordinator', bars: [{ start_us: 412, end_us: 31700, label: 'Parsing SELECT' }, { start_us: 31700, end_us: 31700, label: 'Request complete' }] },
    { node: '10.20.0.12', role: 'replica', bars: [{ start_us: 6500, end_us: 6500, label: 'READ message received' }] },
    { node: '10.20.0.13', role: 'replica', bars: [{ start_us: 7004, end_us: 18390, label: 'Merged data from memtables and 2 sstables' }] },
  ],
  events: [
    { activity: 'Parsing SELECT', source: '10.20.0.11', elapsed_us: 412, thread: 'Native-Transport-Requests-4', timestamp_ms: 0.4 },
    { activity: 'READ message received', source: '10.20.0.12', elapsed_us: 6500, thread: 'MessagingService-Inbound', timestamp_ms: 6.5 },
    { activity: 'Merged data from memtables and 2 sstables', source: '10.20.0.13', elapsed_us: 18390, thread: 'ReadStage-2', timestamp_ms: 18.4 },
    { activity: 'Request complete', source: '10.20.0.11', elapsed_us: 31700, thread: 'Native-Transport-Requests-4', timestamp_ms: 31.7 },
  ],
}

describe('TraceView', () => {
  it('shows summary, a lane per node and the events table', () => {
    render(<TraceView trace={trace} clientMs={38.2} />)
    expect(screen.getAllByText('31.7 ms').length).toBeGreaterThan(0)
    expect(screen.getByText('38.2 ms')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Trace waterfall' })).toBeInTheDocument()
    expect(screen.getAllByText('10.20.0.12').length).toBe(2)
    expect(screen.getAllByText('Replica')).toHaveLength(2)
    expect(screen.getByRole('table', { name: 'Trace events' })).toHaveTextContent('Request complete')
  })
  it('exposes the full activity text as the bar tooltip', () => {
    const { container } = render(<TraceView trace={trace} />)
    expect(container.querySelector('[title="Merged data from memtables and 2 sstables"]')).not.toBeNull()
    expect(screen.queryByText('Client round trip')).not.toBeInTheDocument()
  })
})
