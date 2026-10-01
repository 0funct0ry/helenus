import { render, screen } from '@testing-library/react'
import { StatusDot } from './StatusDot'

describe('StatusDot', () => {
  it.each(['connected', 'connecting', 'error'] as const)('labels %s', (s) => {
    render(<StatusDot status={s} />)
    expect(screen.getByRole('img', { name: s })).toHaveAttribute('data-status', s)
  })
})
