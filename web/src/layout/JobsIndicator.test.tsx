import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { JobsIndicator } from './JobsIndicator'
import { mockApi, renderWithClient as render } from '../test/api'
import { seedJob } from '../test/seedFixture'

describe('JobsIndicator', () => {
  it('renders nothing without jobs', async () => {
    const calls = mockApi({ 'GET /p/local/jobs': { jobs: [] } })
    const { container } = render(<JobsIndicator profile="local" enabled />)
    await waitFor(() => expect(calls).toHaveLength(1))
    expect(container).toBeEmptyDOMElement()
  })
  it('does not fetch while disconnected', () => {
    const calls = mockApi({})
    render(<JobsIndicator profile="local" enabled={false} />)
    expect(calls).toHaveLength(0)
  })
  it('lists running jobs and cancels one', async () => {
    const calls = mockApi({ 'GET /p/local/jobs': { jobs: [seedJob()] }, 'DELETE /p/local/jobs/job1': { status: 202, body: seedJob({ state: 'cancelled' }) } })
    render(<JobsIndicator profile="local" enabled />)
    const btn = await screen.findByRole('button', { name: 'Jobs, 1 running' })
    expect(btn).toHaveTextContent('Jobs (1)')
    await userEvent.click(btn)
    expect(screen.getByText(/25% \(250\/1,000\)/)).toBeInTheDocument()
    expect(screen.getByText(/lost when helenus restarts/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true))
  })
})
