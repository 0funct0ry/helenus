import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FakeParams } from './FakeParams'

describe('FakeParams', () => {
  it('picks a category', async () => {
    const onChange = vi.fn()
    render(<FakeParams spec={{ gen: 'fake', params: { category: 'word' } }} type={{ name: 'text' }} errors={{}} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: /Category/ }))
    await userEvent.click(screen.getByRole('option', { name: 'email' }))
    expect(onChange).toHaveBeenCalledWith({ gen: 'fake', params: { category: 'email' } })
  })
  it('limits inet columns to IP categories', async () => {
    render(<FakeParams spec={{ gen: 'fake' }} type={{ name: 'inet' }} errors={{}} onChange={() => {}} />)
    await userEvent.click(screen.getByRole('button', { name: /Category/ }))
    expect(screen.getAllByRole('option').map((o) => o.textContent)).toEqual(['ipv4', 'ipv6'])
  })
})
