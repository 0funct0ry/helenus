import { create } from 'zustand'

export interface Toast {
  id: number
  message: string
}

interface ToastState {
  toasts: Toast[]
  /** Show a message; it dismisses itself after a few seconds. */
  push: (message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1
export const TOAST_MS = 4000

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (message) => {
    const id = nextId++
    set((s) => ({ toasts: [...s.toasts, { id, message }] }))
    setTimeout(() => get().dismiss(id), TOAST_MS)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))
