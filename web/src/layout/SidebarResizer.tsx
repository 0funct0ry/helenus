import type { KeyboardEvent, PointerEvent } from 'react'

export const MIN_SIDEBAR = 200
export const MAX_SIDEBAR = 600

export const clampSidebar = (w: number) => Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, Math.round(w)))

export interface SidebarResizerProps {
  /** Current sidebar width in px. */
  width: number
  /** Called with the new (already clamped) width while dragging or using arrow keys. */
  onResize: (width: number) => void
  /** Called when the width is reset (double-click). */
  onReset: () => void
}

/**
 * A thin vertical drag handle overlaying the sidebar's right edge. Drag with the pointer, or focus it
 * and use the left/right arrow keys; double-click resets to the default width. The width is clamped
 * to 200–600px. Place it inside a `relative` container that wraps the sidebar.
 */
export function SidebarResizer({ width, onResize, onReset }: SidebarResizerProps) {
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = width
    const move = (ev: globalThis.PointerEvent) => onResize(clampSidebar(startW + ev.clientX - startX))
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 40 : 10
    if (e.key === 'ArrowLeft') onResize(clampSidebar(width - step))
    else if (e.key === 'ArrowRight') onResize(clampSidebar(width + step))
    else return
    e.preventDefault()
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuenow={width}
      aria-valuemin={MIN_SIDEBAR}
      aria-valuemax={MAX_SIDEBAR}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onReset}
      onKeyDown={onKeyDown}
      className="group absolute inset-y-0 -right-[3px] z-10 flex w-[6px] cursor-col-resize justify-center outline-none"
    />
  )
}
