import { render, screen } from '@testing-library/react'
import { InsecureBindBadge } from './InsecureBindBadge'

describe('InsecureBindBadge', () => {
  it('warns about plain HTTP on the network', () => {
    render(<InsecureBindBadge />)
    expect(screen.getByText(/plain HTTP/)).toBeInTheDocument()
    expect(screen.getByTitle(/without TLS/)).toBeInTheDocument()
  })
})
