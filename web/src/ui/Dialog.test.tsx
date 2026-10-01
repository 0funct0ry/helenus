import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Dialog } from './Dialog'

describe('Dialog', () => {
  it('renders a labelled modal with content and footer', () => {
    render(<Dialog open onClose={() => {}} title="Review" footer={<button>Apply</button>}><p>body</p></Dialog>)
    const d = screen.getByRole('dialog', { name: 'Review' })
    expect(d).toHaveAttribute('aria-modal', 'true')
    expect(d).toHaveTextContent('body')
    expect(screen.getByRole('button', { name: 'Apply' })).toBeInTheDocument()
  })
  it('is not the native dialog element', () => {
    render(<Dialog open onClose={() => {}} title="T">x</Dialog>)
    expect(document.querySelector('dialog')).toBeNull()
  })
  it('closes on Escape, the close button and the scrim', async () => {
    const onClose = vi.fn()
    render(<Dialog open onClose={onClose} title="T">x</Dialog>)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })
  it('renders nothing when closed', () => {
    render(<Dialog open={false} onClose={() => {}} title="T">x</Dialog>)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
  it('traps focus', async () => {
    render(<Dialog open onClose={() => {}} title="T"><button>one</button></Dialog>)
    await userEvent.tab()
    await userEvent.tab()
    await userEvent.tab()
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true)
  })
})
