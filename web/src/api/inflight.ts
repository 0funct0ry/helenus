const controllers = new Map<string, AbortController>()

/** Start tracking a request for `key` (a query tab id), aborting any earlier one. Returns its signal. */
export function beginInflight(key: string): AbortSignal {
  controllers.get(key)?.abort()
  const c = new AbortController()
  controllers.set(key, c)
  return c.signal
}

/** Stop tracking `key` once its request settled (only if `signal` is still the current one). */
export function endInflight(key: string, signal: AbortSignal) {
  if (controllers.get(key)?.signal === signal) controllers.delete(key)
}

/** Abort the request running for `key`, if any. Used by Cancel and when a tab closes. */
export function abortInflight(key: string) {
  controllers.get(key)?.abort()
  controllers.delete(key)
}
