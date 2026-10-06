import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SidebarResizer } from './SidebarResizer'

describe('SidebarResizer', () => {
  it('resizes with arrow keys, clamped', () => {
    const onResize = vi.fn()
    render(<SidebarResizer width={205} onResize={onResize} onReset={() => {}} />)
    const h = screen.getByRole('separator', { name: 'Resize sidebar' })
    fireEvent.keyDown(h, { key: 'ArrowLeft' })
    expect(onResize).toHaveBeenLastCalledWith(200)
    fireEvent.keyDown(h, { key: 'ArrowRight', shiftKey: true })
    expect(onResize).toHaveBeenLastCalledWith(245)
  })

  it('resizes by dragging and resets on double-click', () => {
    const onResize = vi.fn()
    const onReset = vi.fn()
    render(<SidebarResizer width={300} onResize={onResize} onReset={onReset} />)
    const h = screen.getByRole('separator')
    fireEvent.pointerDown(h, { clientX: 300 })
    fireEvent(window, new MouseEvent('pointermove', { clientX: 350 }))
    expect(onResize).toHaveBeenLastCalledWith(350)
    fireEvent(window, new MouseEvent('pointerup'))
    fireEvent.doubleClick(h)
    expect(onReset).toHaveBeenCalled()
  })
})
