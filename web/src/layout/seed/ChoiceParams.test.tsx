import { fireEvent, render, screen } from '@testing-library/react'
import { ChoiceParams } from './ChoiceParams'

describe('ChoiceParams', () => {
  it('splits values and weights on commas', () => {
    const onChange = vi.fn()
    render(<ChoiceParams spec={{ gen: 'choice' }} type={{ name: 'text' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Values (comma separated)'), { target: { value: 'red, green ,blue' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'choice', params: { values: ['red', 'green', 'blue'] } })
    fireEvent.change(screen.getByLabelText('Weights (optional)'), { target: { value: '1, 3' } })
    expect(onChange).toHaveBeenLastCalledWith({ gen: 'choice', params: { weights: [1, 3] } })
  })
  it('parses values by column type and clears empty lists', () => {
    const onChange = vi.fn()
    render(<ChoiceParams spec={{ gen: 'choice', params: { values: [1, 2] } }} type={{ name: 'int' }} errors={{}} onChange={onChange} />)
    expect(screen.getByLabelText('Values (comma separated)')).toHaveValue('1, 2')
    fireEvent.change(screen.getByLabelText('Values (comma separated)'), { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'choice', params: {} })
  })
})
