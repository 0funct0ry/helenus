import { fireEvent, render, screen } from '@testing-library/react'
import { TimeRangeParams } from './TimeRangeParams'

describe('TimeRangeParams', () => {
  it('edits from and to', () => {
    const onChange = vi.fn()
    render(<TimeRangeParams spec={{ gen: 'time_range' }} type={{ name: 'timestamp' }} errors={{ 'params.from': 'not a time' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2025-01-31' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'time_range', params: { to: '2025-01-31' } })
    expect(screen.getByRole('alert')).toHaveTextContent('not a time')
  })
  it('suggests clock times for time columns', () => {
    render(<TimeRangeParams spec={{ gen: 'time_range' }} type={{ name: 'time' }} errors={{}} onChange={() => {}} />)
    expect(screen.getByLabelText('From')).toHaveAttribute('placeholder', '00:00:00')
  })
})
