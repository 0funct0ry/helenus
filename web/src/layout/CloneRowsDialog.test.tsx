import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { CloneRowsDialog } from './CloneRowsDialog'
import type { QueryColumn } from '../api/types'

const columns: QueryColumn[] = [
  { name: 'id', type: { name: 'int' }, kind: 'partition', position: 1 },
  { name: 'name', type: { name: 'text' }, kind: 'regular' },
]
const rows = [{ id: 1, name: 'a' }, { id: 2, name: null }]

describe('CloneRowsDialog', () => {
  it('blocks keys equal to the source or to each other, then confirms with copied values', async () => {
    const onConfirm = vi.fn()
    render(<CloneRowsDialog open onClose={() => {}} columns={columns} rows={rows} onConfirm={onConfirm} />)
    const ok = screen.getByRole('button', { name: 'Stage 2 inserts' })
    expect(ok).toBeDisabled()
    const one = screen.getByRole('textbox', { name: 'id (new row 1)' })
    const two = screen.getByRole('textbox', { name: 'id (new row 2)' })
    await userEvent.clear(one)
    await userEvent.type(one, '10')
    await userEvent.clear(two)
    await userEvent.type(two, '10')
    expect(screen.getByText(/same as new row 1/)).toBeInTheDocument()
    expect(ok).toBeDisabled()
    await userEvent.clear(two)
    await userEvent.type(two, '11')
    expect(ok).toBeEnabled()
    await userEvent.click(ok)
    expect(onConfirm).toHaveBeenCalledWith([{ id: 10, name: 'a' }, { id: 11 }])
  })
})
