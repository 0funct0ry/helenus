import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PendingBar } from './PendingBar'
import type { PendingItem } from '../lib/changes'

const items: PendingItem[] = [
  { id: 'i', type: 'insert', changes: [{ kind: 'insert_row' }] },
  { id: 'c', type: 'cell', rowKey: 'r', column: 'a', changes: [{ kind: 'set_cell' }] },
  { id: 'd', type: 'delete', rowKey: 'z', changes: [{ kind: 'delete_row' }] },
]

describe('PendingBar', () => {
  it('renders nothing without staged edits', () => {
    const { container } = render(<PendingBar items={[]} onDiscard={() => {}} onReview={() => {}} onApply={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
  it('shows the count and the kinds', () => {
    render(<PendingBar items={items} onDiscard={() => {}} onReview={() => {}} onApply={() => {}} />)
    expect(screen.getByText('3 pending changes')).toBeInTheDocument()
    expect(screen.getByText('1 insert, 1 update, 1 delete')).toBeInTheDocument()
  })
  it('uses the singular for one change', () => {
    render(<PendingBar items={items.slice(1, 2)} onDiscard={() => {}} onReview={() => {}} onApply={() => {}} />)
    expect(screen.getByText('1 pending change')).toBeInTheDocument()
  })
  it('wires Discard, Review CQL and Apply', async () => {
    const [d, r, a] = [vi.fn(), vi.fn(), vi.fn()]
    render(<PendingBar items={items} onDiscard={d} onReview={r} onApply={a} />)
    await userEvent.click(screen.getByRole('button', { name: 'Discard' }))
    await userEvent.click(screen.getByRole('button', { name: 'Review CQL' }))
    await userEvent.click(screen.getByRole('button', { name: 'Apply changes' }))
    expect([d, r, a].map((f) => f.mock.calls.length)).toEqual([1, 1, 1])
  })
  it('shows the failure that stopped the last apply and disables buttons while busy', () => {
    render(<PendingBar items={items} failure="write timeout" busy onDiscard={() => {}} onReview={() => {}} onApply={() => {}} />)
    expect(screen.getByText('write timeout')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Apply changes' })).toBeDisabled()
  })
})
