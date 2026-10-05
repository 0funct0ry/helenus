import { relativeTime } from './relativeTime'

describe('relativeTime', () => {
  const now = new Date('2026-01-10T12:00:00Z')
  it.each([
    ['2026-01-10T11:59:50Z', 'just now'],
    ['2026-01-10T11:55:00Z', '5 min ago'],
    ['2026-01-10T09:00:00Z', '3 h ago'],
    ['2026-01-08T12:00:00Z', '2 d ago'],
    ['2025-11-01T12:00:00Z', '2025-11-01'],
    ['not a date', 'not a date'],
  ])('%s -> %s', (iso, want) => expect(relativeTime(iso, now)).toBe(want))
})
