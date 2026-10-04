import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DatacenterRows } from './DatacenterRows'

describe('DatacenterRows', () => {
  it('shows rows with per-row errors and reports edits, adds and removals', async () => {
    const onChange = vi.fn()
    render(<DatacenterRows rows={[{ name: 'dc1', rf: 3 }]} errors={{ 'datacenters.0.rf': 'bad rf' }} onChange={onChange} />)
    expect(screen.getByLabelText('Datacenter 1 name')).toHaveValue('dc1')
    expect(screen.getByText('bad rf')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Add datacenter' }))
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'dc1', rf: 3 }, { name: '', rf: 1 }])
    await userEvent.click(screen.getByRole('button', { name: 'Remove datacenter 1' }))
    expect(onChange).toHaveBeenLastCalledWith([])
    await userEvent.type(screen.getByLabelText('Datacenter 1 name'), 'x')
    expect(onChange).toHaveBeenLastCalledWith([{ name: 'dc1x', rf: 3 }])
  })
  it('shows the table-level error', () => {
    render(<DatacenterRows rows={[]} errors={{ datacenters: 'Add at least one datacenter' }} onChange={vi.fn()} />)
    expect(screen.getByText('Add at least one datacenter')).toBeInTheDocument()
  })
})
