import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './Tabs'

const items = [
  { id: 'data', label: 'Data' },
  { id: 'schema', label: 'Schema' },
  { id: 'views', label: 'Views', badge: 1 },
]

describe('Tabs', () => {
  it('marks the selected tab and reports clicks', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} value="data" onChange={onChange} />)
    expect(screen.getByRole('tab', { name: 'Data' })).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(screen.getByRole('tab', { name: /Views/ }))
    expect(onChange).toHaveBeenCalledWith('views')
  })
  it('supports arrow key navigation with wraparound', async () => {
    const onChange = vi.fn()
    render(<Tabs items={items} value="views" onChange={onChange} />)
    screen.getByRole('tab', { name: /Views/ }).focus()
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith('data')
    await userEvent.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith('schema')
  })
})
