import { fireEvent, render, screen } from '@testing-library/react'
import { SeedVolumeStep } from './SeedVolumeStep'
import { seedConfig } from '../test/seedFixture'

const props = { config: seedConfig, errors: [], hasClustering: true, counter: false, partitions: 10 }

describe('SeedVolumeStep', () => {
  it('edits volume settings', () => {
    const onChange = vi.fn()
    render(<SeedVolumeStep {...props} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Total rows'), { target: { value: '5000' } })
    expect(onChange).toHaveBeenCalledWith({ ...seedConfig, total_rows: 5000 })
    expect(screen.getByText('10 partitions')).toBeInTheDocument()
  })
  it('randomizes the seed', () => {
    const onChange = vi.fn()
    render(<SeedVolumeStep {...props} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Randomize' }))
    expect(onChange.mock.calls[0][0].seed).not.toBe(42)
  })
  it('warns about IF NOT EXISTS and never offers ANY', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<SeedVolumeStep {...props} onChange={onChange} />)
    fireEvent.click(screen.getByRole('switch', { name: 'IF NOT EXISTS' }))
    expect(onChange).toHaveBeenCalledWith({ ...seedConfig, if_not_exists: true })
    rerender(<SeedVolumeStep {...props} config={{ ...seedConfig, if_not_exists: true }} onChange={onChange} />)
    expect(screen.getByText(/much slower/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Consistency/ }))
    expect(screen.queryByRole('option', { name: 'ANY' })).not.toBeInTheDocument()
  })
  it('disables rows per partition without clustering columns and TTL for counters', () => {
    render(<SeedVolumeStep {...props} hasClustering={false} counter onChange={() => {}} />)
    expect(screen.getByLabelText('Rows per partition')).toBeDisabled()
    expect(screen.getByLabelText('TTL seconds (0 = none)')).toBeDisabled()
    expect(screen.getByRole('switch', { name: 'IF NOT EXISTS' })).toBeDisabled()
  })
  it('shows field errors', () => {
    render(<SeedVolumeStep {...props} errors={[{ field: 'total_rows', message: 'total rows must be between 1 and 1000000' }]} onChange={() => {}} />)
    expect(screen.getByRole('alert')).toHaveTextContent('between 1 and 1000000')
  })
})
