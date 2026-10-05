/** "just now", "5 min ago", "3 h ago", "2 d ago" for an ISO timestamp; older than 30 days falls back to the date. */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return iso
  const s = Math.max(0, Math.round((now.getTime() - t.getTime()) / 1000))
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 30 * 86400) return `${Math.round(s / 86400)} d ago`
  return t.toISOString().slice(0, 10)
}
