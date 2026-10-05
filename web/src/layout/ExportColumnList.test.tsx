import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ExportColumnList } from './ExportColumnList'
import type { Column } from '../lib/schemaModel'

const cols: Column[] = [
  { name: 'id', type: 'uuid', kind: 'partition', position: 1 },
  { name: 'name', type: 'text', kind: 'regular' },
  { name: 'qty', type: 'int', kind: 'regular' },
]

describe('ExportColumnList', () => {
  it('unchecks a column and keeps table order', async () => {
    const onChange = vi.fn()
    render(<ExportColumnList columns={cols} selected={['id', 'name', 'qty']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^name/ }))
    expect(onChange).toHaveBeenCalledWith(['id', 'qty'])
  })
  it('re-checks a column in table order', async () => {
    const onChange = vi.fn()
    render(<ExportColumnList columns={cols} selected={['qty']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /^id/ }))
    expect(onChange).toHaveBeenCalledWith(['id', 'qty'])
  })
  it('selects and clears all', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<ExportColumnList columns={cols} selected={['id']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Select all \(1\/3\)/ }))
    expect(onChange).toHaveBeenLastCalledWith(['id', 'name', 'qty'])
    rerender(<ExportColumnList columns={cols} selected={['id', 'name', 'qty']} onChange={onChange} />)
    await userEvent.click(screen.getByRole('checkbox', { name: /Select all \(3\/3\)/ }))
    expect(onChange).toHaveBeenLastCalledWith([])
  })
})
