import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TreeRow } from './TreeRow'

describe('TreeRow', () => {
  it('renders label, meta and handles click', async () => {
    const onClick = vi.fn()
    render(<TreeRow indent={40} label="payments" meta="5" expanded onClick={onClick} />)
    const row = screen.getByRole('treeitem', { name: /payments/ })
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(row)
    expect(onClick).toHaveBeenCalled()
  })
  it('marks selection', () => {
    render(<TreeRow indent={0} label="t" selected />)
    expect(screen.getByRole('treeitem')).toHaveAttribute('aria-selected', 'true')
  })
})
