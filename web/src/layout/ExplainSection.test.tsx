import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExplainSection } from './ExplainSection'

describe('ExplainSection', () => {
  it('is collapsed until toggled', async () => {
    render(<ExplainSection lines={['Creates table a.']} />)
    expect(screen.queryByText('Creates table a.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /what this does/i }))
    expect(screen.getByText('Creates table a.')).toBeInTheDocument()
  })
  it('renders nothing without lines', () => {
    const { container } = render(<ExplainSection lines={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})
