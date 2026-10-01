import { render, screen } from '@testing-library/react'
import { TraceView } from './TraceView'
import { traceEvents, traceSummary } from '../mocks/trace'

describe('TraceView', () => {
  it('shows summary, waterfall and events', () => {
    render(<TraceView events={traceEvents} summary={traceSummary} />)
    expect(screen.getAllByText('31.7 ms')[0]).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Trace waterfall' })).toBeInTheDocument()
    expect(screen.getByText('Request complete')).toBeInTheDocument()
    expect(screen.getAllByText('10.20.0.12').length).toBeGreaterThan(0)
  })
})
