import { useRef } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Popover } from './Popover'

function Harness({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={ref}>anchor</button>
      <button>outside</button>
      <Popover open anchorRef={ref} onClose={onClose} aria-label="Pop">
        <span>content</span>
      </Popover>
    </div>
  )
}

describe('Popover', () => {
  it('renders content when open', () => {
    render(<Harness onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: 'Pop' })).toHaveTextContent('content')
  })
  it('closes on Escape and outside click but not on inside click', async () => {
    const onClose = vi.fn()
    render(<Harness onClose={onClose} />)
    await userEvent.click(screen.getByText('content'))
    expect(onClose).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('outside'))
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(2)
  })
  it('renders nothing when closed', () => {
    function Closed() {
      const ref = useRef<HTMLButtonElement>(null)
      return (
        <>
          <button ref={ref}>a</button>
          <Popover open={false} anchorRef={ref} onClose={() => {}}>x</Popover>
        </>
      )
    }
    render(<Closed />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('Popover stacking', () => {
  it('can sit above a dialog', () => {
    const anchor = { current: document.body }
    render(<Popover open onClose={() => {}} anchorRef={anchor} aboveDialog aria-label="Above">x</Popover>)
    expect(screen.getByRole('dialog', { name: 'Above' })).toHaveClass('z-[60]')
  })
})
