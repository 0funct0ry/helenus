import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AggregateFunctionSelect } from './AggregateFunctionSelect'
import type { AggregateCandidate } from '../api/types'

const need = 'Needs (tuple<int, bigint>, int) → tuple<int, bigint>'
const candidates: AggregateCandidate[] = [
  { name: 'state_avg', signature: 'state_avg(tuple<int, bigint>, int)', returns: 'tuple<int, bigint>', ok: true },
  { name: 'bad', signature: 'bad(int, int)', returns: 'int', ok: false, reason: need },
]

describe('AggregateFunctionSelect', () => {
  it('lists matching functions and disables the others with the reason', async () => {
    const onChange = vi.fn()
    render(<AggregateFunctionSelect label="State function" value="" candidates={candidates} onChange={onChange} onCreate={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: 'State function' }))
    const bad = screen.getByRole('option', { name: new RegExp(need.replace(/[()]/g, '\\$&')) })
    expect(bad).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(bad)
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('option', { name: /state_avg/ }))
    expect(onChange).toHaveBeenCalledWith('state_avg(tuple<int, bigint>, int)')
  })
  it('offers none when optional and a create shortcut', async () => {
    const onChange = vi.fn()
    const onCreate = vi.fn()
    render(<AggregateFunctionSelect label="Final function" optional value="x" candidates={candidates} onChange={onChange} onCreate={onCreate} />)
    await userEvent.click(screen.getByRole('button', { name: 'Create function…' }))
    expect(onCreate).toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Final function' }))
    await userEvent.click(screen.getByRole('option', { name: '(none)' }))
    expect(onChange).toHaveBeenCalledWith('')
  })
})
