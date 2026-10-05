import { fireEvent, render, screen } from '@testing-library/react'
import { ConstantParams } from './ConstantParams'

describe('ConstantParams', () => {
  it('parses the value by column type', () => {
    const onChange = vi.fn()
    render(<ConstantParams spec={{ gen: 'constant' }} type={{ name: 'int' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '42' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'constant', params: { value: 42 } })
  })
  it('keeps text as text and shows server errors', () => {
    const onChange = vi.fn()
    render(<ConstantParams spec={{ gen: 'constant', params: { value: 'x' } }} type={{ name: 'text' }} errors={{ 'params.value': 'bad' }} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Value'), { target: { value: '7' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'constant', params: { value: '7' } })
    expect(screen.getByRole('alert')).toHaveTextContent('bad')
  })
})
