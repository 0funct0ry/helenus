const key = (profile: string) => `helenus.hiddenAdvice.${profile}`

/** Rule ids the user hid for a profile. Storage can be missing or blocked, so every access is guarded. */
export function hiddenAdvice(profile: string): Set<string> {
  try {
    const raw = localStorage.getItem(key(profile))
    const list: unknown = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    return new Set()
  }
}

/** Hide one rule id for a profile. */
export function hideAdvice(profile: string, id: string): void {
  try {
    const set = hiddenAdvice(profile)
    set.add(id)
    localStorage.setItem(key(profile), JSON.stringify([...set].sort()))
  } catch {
    /* hiding is a convenience; ignore storage failures */
  }
}

/** Show every hidden rule again for a profile. */
export function resetAdvice(profile: string): void {
  try {
    localStorage.removeItem(key(profile))
  } catch {
    /* ignore */
  }
}

const NOTE_RE = /^(A\d{3}): (.*)$/s

/** Splits an advisor note ("A002: message") into its rule id and message; other notes return null. */
export function parseAdviceNote(note: string): { id: string; message: string } | null {
  const m = NOTE_RE.exec(note)
  return m ? { id: m[1], message: m[2] } : null
}
