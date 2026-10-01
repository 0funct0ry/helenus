import { render, screen } from '@testing-library/react'
import { Badge } from './Badge'

describe('Badge', () => {
  it('renders children with a tone', () => {
    render(<Badge tone="vec">vector</Badge>)
    expect(screen.getByText('vector')).toHaveAttribute('data-tone', 'vec')
  })
  it('renders neutral pills without a tone attribute', () => {
    render(<Badge>3</Badge>)
    expect(screen.getByText('3')).not.toHaveAttribute('data-tone')
  })
})
