import { fireEvent, render, screen } from '@testing-library/react'
import { BlobParams } from './BlobParams'

describe('BlobParams', () => {
  it('edits the byte length range', () => {
    const onChange = vi.fn()
    render(<BlobParams spec={{ gen: 'blob' }} type={{ name: 'blob' }} errors={{}} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Min bytes'), { target: { value: '4' } })
    expect(onChange).toHaveBeenCalledWith({ gen: 'blob', params: { min_len: 4 } })
  })
})
