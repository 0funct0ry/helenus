import { vi } from 'vitest'
import { copyRowsAs, formatDisabledReason } from './copyRows'
import { useToasts } from '../store/toast'

const { formatRows } = vi.hoisted(() => ({ formatRows: vi.fn() }))
vi.mock('../api/rows', () => ({ formatRows }))

const keyed = [{ kind: 'partition' }, { kind: 'regular' }]
const source = { keyspace: 'ks', table: 't', keysComplete: true }

describe('formatDisabledReason', () => {
  it('only restricts the three SQL formats', () => {
    for (const f of ['json', 'csv', 'tsv', 'xml', 'yaml', 'markdown', 'html'] as const) expect(formatDisabledReason(f, null, keyed)).toBeNull()
  })
  it('needs a single source table', () => {
    for (const f of ['sql_inserts', 'sql_updates', 'where'] as const) expect(formatDisabledReason(f, null, keyed)).toMatch(/single table/)
  })
  it('needs every key column for Updates and Where, but not for Inserts', () => {
    const partial = { ...source, keysComplete: false }
    expect(formatDisabledReason('sql_inserts', partial, keyed)).toBeNull()
    expect(formatDisabledReason('sql_updates', partial, keyed)).toMatch(/primary key/)
    expect(formatDisabledReason('where', partial, keyed)).toMatch(/primary key/)
  })
  it('refuses Updates for counter tables and for results without non-key columns', () => {
    expect(formatDisabledReason('sql_updates', { ...source, counter: true }, keyed)).toMatch(/Counter/)
    expect(formatDisabledReason('sql_updates', source, [{ kind: 'partition' }])).toMatch(/non-key/)
    expect(formatDisabledReason('where', source, [{ kind: 'partition' }])).toBeNull()
    expect(formatDisabledReason('sql_updates', source, keyed)).toBeNull()
  })
})

describe('copyRowsAs', () => {
  const req = { format: 'csv' as const, source: null, columns: [], rows: [[1], [2], [3]] }
  beforeEach(() => useToasts.setState({ toasts: [] }))
  it('copies the server text and toasts the count and format', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    formatRows.mockResolvedValue('a\n1')
    expect(await copyRowsAs('local', req)).toBe(true)
    expect(writeText).toHaveBeenCalledWith('a\n1')
    expect(useToasts.getState().toasts.map((t) => t.message)).toEqual(['Copied 3 rows as CSV'])
  })
  it('shows an error toast and never touches the clipboard on failure', async () => {
    const writeText = vi.fn()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    formatRows.mockRejectedValue(new Error('nope'))
    expect(await copyRowsAs('local', req)).toBe(false)
    expect(writeText).not.toHaveBeenCalled()
    expect(useToasts.getState().toasts[0].message).toMatch(/Copy failed: nope/)
  })
})
