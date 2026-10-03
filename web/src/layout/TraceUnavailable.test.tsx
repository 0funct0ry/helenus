import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TraceUnavailable } from './TraceUnavailable'

describe('TraceUnavailable', () => {
  it('explains the state and retries on click', async () => {
    const onRetry = vi.fn()
    render(<TraceUnavailable onRetry={onRetry} />)
    expect(screen.getByText('Trace not yet available')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })
  it('shows a custom message for other failures', () => {
    render(<TraceUnavailable onRetry={vi.fn()} message="boom" />)
    expect(screen.getByText('boom')).toBeInTheDocument()
  })
})
