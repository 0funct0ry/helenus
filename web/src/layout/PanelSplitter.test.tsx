import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PanelSplitter } from './PanelSplitter'

describe('PanelSplitter', () => {
  it('nudges with arrow keys', () => {
    const onNudge = vi.fn()
    render(<PanelSplitter label="Resize" onDrag={() => {}} onNudge={onNudge} />)
    const s = screen.getByRole('separator', { name: 'Resize' })
    fireEvent.keyDown(s, { key: 'ArrowUp' })
    expect(onNudge).toHaveBeenLastCalledWith(-12)
    fireEvent.keyDown(s, { key: 'ArrowDown', shiftKey: true })
    expect(onNudge).toHaveBeenLastCalledWith(60)
  })

  it('reports drag positions and resets on double-click', () => {
    const onDrag = vi.fn()
    const onReset = vi.fn()
    render(<PanelSplitter label="Resize" onDrag={onDrag} onNudge={() => {}} onReset={onReset} />)
    const s = screen.getByRole('separator')
    fireEvent.pointerDown(s, { clientY: 100 })
    fireEvent(window, new MouseEvent('pointermove', { clientY: 140 }))
    expect(onDrag).toHaveBeenLastCalledWith(140)
    fireEvent(window, new MouseEvent('pointerup'))
    fireEvent.doubleClick(s)
    expect(onReset).toHaveBeenCalled()
  })
})
