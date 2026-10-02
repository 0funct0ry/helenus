import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FilteringError } from './FilteringError'

describe('FilteringError', () => {
  it('explains and offers a one-shot ALLOW FILTERING run', async () => {
    const onRun = vi.fn()
    render(<FilteringError message="Cannot execute this query" onRun={onRun} />)
    expect(screen.getByRole('alert')).toHaveTextContent('needs ALLOW FILTERING')
    expect(screen.getByText('Cannot execute this query')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Run with ALLOW FILTERING' }))
    expect(onRun).toHaveBeenCalled()
  })
})
