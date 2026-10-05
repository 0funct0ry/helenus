import { fireEvent, render, screen } from '@testing-library/react'
import { SequenceParams } from './SequenceParams'

describe('SequenceParams', () => {
  it('edits start and step, and offers a prefix only for text columns', () => {
    const onChange = vi.fn()
    const { rerender } = render(<SequenceParams spec={{ gen: 'sequence' }} type={{ name: 'int' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '10' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'sequence', params: { start: 10 } })
    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument()
    rerender(<SequenceParams spec={{ gen: 'sequence' }} type={{ name: 'text' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Prefix'), { target: { value: 'user-' } })
    expect(onChange).toHaveBeenLastCalledWith({ gen: 'sequence', params: { prefix: 'user-' } })
  })
})
