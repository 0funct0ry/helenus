import type { KeyboardEvent, PointerEvent } from 'react'

export interface PanelSplitterProps {
  /** Accessible name, e.g. "Resize results panel". */
  label: string
  /** Called with the pointer's clientY while dragging. */
  onDrag: (clientY: number) => void
  /** Called with ±px when the arrow keys are used (positive = move the splitter down). */
  onNudge: (delta: number) => void
  /** Called on double-click (reset). */
  onReset?: () => void
}

/**
 * A horizontal splitter between two stacked panes: a 1px line with a taller invisible hit area.
 * Drag with the pointer, or focus it and use Up/Down (Shift for bigger steps); double-click resets.
 */
export function PanelSplitter({ label, onDrag, onNudge, onReset }: PanelSplitterProps) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const move = (ev: globalThis.PointerEvent) => onDrag(ev.clientY)
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 60 : 12
    if (e.key === 'ArrowUp') onNudge(-step)
    else if (e.key === 'ArrowDown') onNudge(step)
    else return
    e.preventDefault()
  }
  return (
    <div className="group relative bg-line">
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label={label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onDoubleClick={onReset}
        onKeyDown={onKeyDown}
        className="absolute inset-x-0 -top-[3px] z-10 flex h-[7px] cursor-row-resize items-center outline-none"
      >
        <span className="h-px w-full bg-transparent transition-colors group-hover:bg-accent/25 group-focus-within:bg-accent/35" />
      </div>
    </div>
  )
}
