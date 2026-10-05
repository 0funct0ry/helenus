import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ReadOnlyBadge } from './ReadOnlyBadge'

describe('ReadOnlyBadge', () => {
  it('renders the label', () => {
    render(<ReadOnlyBadge />)
    expect(screen.getByText('Read-only')).toBeInTheDocument()
  })
})
