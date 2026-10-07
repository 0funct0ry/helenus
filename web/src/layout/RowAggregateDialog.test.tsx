import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { RowAggregateDialog } from './RowAggregateDialog'

const { aggregateRows } = vi.hoisted(() => ({ aggregateRows: vi.fn() }))
vi.mock('../api/rows', () => ({ aggregateRows }))

const cols = [{ name: 'a', type: { name: 'int' } }]

describe('RowAggregateDialog', () => {
  it('shows the aligned figures and copies the same KEY: value text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    aggregateRows.mockResolvedValue({ lines: [{ key: 'AVG', value: '—' }, { key: 'COEFFICIENT_OF_VARIATION', value: '—' }], text: 'AVG: —\nCOEFFICIENT_OF_VARIATION: —' })
    render(<RowAggregateDialog open onClose={() => {}} profile="local" columns={cols} rows={[[1]]} />)
    const list = await screen.findByLabelText('Aggregate figures')
    expect(list.textContent).toBe('AVG:                      —\nCOEFFICIENT_OF_VARIATION: —')
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('AVG: —\nCOEFFICIENT_OF_VARIATION: —')
  })
  it('reports a server error', async () => {
    aggregateRows.mockRejectedValue(new Error('bad rows'))
    render(<RowAggregateDialog open onClose={() => {}} profile="local" columns={cols} rows={[[1]]} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('bad rows')
  })
  it('does nothing while closed', () => {
    aggregateRows.mockClear()
    render(<RowAggregateDialog open={false} onClose={() => {}} profile="local" columns={cols} rows={[]} />)
    expect(aggregateRows).not.toHaveBeenCalled()
  })
})
