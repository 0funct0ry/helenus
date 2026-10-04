import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ToastViewport } from './ToastViewport'
import { TOAST_MS, useToasts } from '../store/toast'

describe('ToastViewport', () => {
  beforeEach(() => useToasts.setState({ toasts: [] }))

  it('shows a pushed message in a live region and dismisses it on click', async () => {
    render(<ToastViewport />)
    act(() => useToasts.getState().push('Keyspace shop created'))
    expect(screen.getByRole('status')).toHaveTextContent('Keyspace shop created')
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('Keyspace shop created')).not.toBeInTheDocument()
  })
  it('removes a toast after the timeout', () => {
    vi.useFakeTimers()
    try {
      render(<ToastViewport />)
      act(() => useToasts.getState().push('Hello'))
      act(() => void vi.advanceTimersByTime(TOAST_MS + 10))
      expect(screen.queryByText('Hello')).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })
})
