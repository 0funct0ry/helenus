import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ResultsPanel } from './ResultsPanel'

describe('ResultsPanel', () => {
  it('shows results first and switches to trace and messages', async () => {
    render(<ResultsPanel />)
    expect(screen.getByRole('table', { name: 'Results' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Trace/ }))
    expect(screen.getByRole('img', { name: 'Trace waterfall' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: /Messages/ }))
    expect(screen.getByText(/Cassandra returned a warning/)).toBeInTheDocument()
  })
  it('shows statement chips and timing', () => {
    render(<ResultsPanel />)
    expect(screen.getByRole('tab', { name: 'Statement 2' })).toBeInTheDocument()
    expect(screen.getByText(/38.2 ms client/)).toBeInTheDocument()
  })
})
