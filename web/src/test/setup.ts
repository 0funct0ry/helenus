import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= RO as unknown as typeof ResizeObserver
Element.prototype.scrollIntoView ??= () => {}

// This jsdom build has no usable localStorage; give components a Map-backed one.
if (typeof localStorage === 'undefined' || typeof localStorage.clear !== 'function') {
  const store = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
    },
  })
}

afterEach(() => {
  cleanup()
  document.cookie = 'helenus_theme=; max-age=0; path=/'
  document.documentElement.removeAttribute('data-theme')
})

// jsdom lacks layout APIs that CodeMirror measures with.
const emptyRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as unknown as DOMRectList
Range.prototype.getClientRects ??= emptyRects
Range.prototype.getBoundingClientRect ??= () => new DOMRect()

// Give elements a viewport-sized box so TanStack Virtual renders rows.
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 600 })
Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 })

// Components call the API through fetch; tests opt in with mockApi() and otherwise get a network error.
beforeEach(() => {
  globalThis.fetch = (() => Promise.reject(new TypeError('network disabled in tests'))) as typeof fetch
})
