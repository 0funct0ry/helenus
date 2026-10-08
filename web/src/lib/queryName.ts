/** Helpers for saved-query names, which are folder paths separated by `/` (SPEC §9.4). */

export const MAX_QUERY_NAME = 200

/** The reason `name` is not a valid saved-query name, or null when it is valid. Mirrors the server rules. */
export function validateQueryName(name: string): string | null {
  const n = normalizeQueryName(name)
  if (n === '') return 'Enter a name.'
  if (n.length > MAX_QUERY_NAME) return `Use at most ${MAX_QUERY_NAME} characters.`
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(n)) return 'The name cannot contain control characters.'
  if (n.includes('\\')) return 'The name cannot contain a backslash.'
  if (n.startsWith('/') || n.endsWith('/')) return 'The name cannot start or end with “/”.'
  if (n.split('/').some((s) => s.trim() === '')) return 'The name cannot have an empty folder (“//”).'
  return null
}

/** Drop a trailing `.cql` (any case): names are stored without it, tab titles add it back. */
export function stripCqlExtension(name: string): string {
  return name.replace(/\.cql$/i, '')
}

/** Trim the name and each of its segments and drop a trailing `.cql`. */
export function normalizeQueryName(name: string): string {
  return stripCqlExtension(
    name
      .trim()
      .split('/')
      .map((s) => s.trim())
      .join('/'),
  ).trim()
}

/** The last segment of a name: `reports/daily` gives `daily`. */
export function lastSegment(name: string): string {
  const i = name.lastIndexOf('/')
  return i < 0 ? name : name.slice(i + 1)
}

/** The folder part of a name including its trailing slash (`reports/`), or an empty string. */
export function folderOf(name: string): string {
  const i = name.lastIndexOf('/')
  return i < 0 ? '' : name.slice(0, i + 1)
}

/** Tab title for a saved query: its last segment plus `.cql`. */
export function queryTabTitle(name: string): string {
  return `${stripCqlExtension(lastSegment(name))}.cql`
}

/** Every folder path (`a`, `a/b`) implied by the names, sorted case-insensitively. */
export function folderPaths(names: string[]): string[] {
  const set = new Set<string>()
  for (const n of names) {
    const parts = n.split('/')
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'))
  }
  return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
