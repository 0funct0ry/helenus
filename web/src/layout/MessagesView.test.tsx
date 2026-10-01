import { render, screen } from '@testing-library/react'
import { MessagesView } from './MessagesView'
import { messages } from '../mocks/trace'

describe('MessagesView', () => {
  it('renders each message with its level', () => {
    const { container } = render(<MessagesView messages={messages} />)
    expect(container.querySelector('[data-level="info"]')).toBeInTheDocument()
    expect(container.querySelector('[data-level="warning"]')).toHaveTextContent(/tombstone/)
    expect(screen.getByText(/SELECT txn_time/)).toBeInTheDocument()
  })
  it('shows an empty state', () => {
    render(<MessagesView messages={[]} />)
    expect(screen.getByText('No messages.')).toBeInTheDocument()
  })
})
