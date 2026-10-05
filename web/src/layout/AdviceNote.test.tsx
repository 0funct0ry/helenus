import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AdviceNote } from './AdviceNote'

describe('AdviceNote', () => {
  it('links to the rule anchor and hides on request', async () => {
    const onHide = vi.fn()
    render(<AdviceNote id="A002" message="Partitions grow without bound" onHide={onHide} />)
    expect(screen.getByRole('link', { name: 'Learn more' })).toHaveAttribute('href', '/docs/data-modeling-tips-in-helenus#a002')
    await userEvent.click(screen.getByRole('button', { name: 'Hide this advice' }))
    expect(onHide).toHaveBeenCalledWith('A002')
  })
  it('has no hide button without a handler', () => {
    render(<AdviceNote id="A001" message="x" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
