import { CompletionContext } from '@codemirror/autocomplete'
import { EditorState } from '@codemirror/state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompleteResponse } from '../api/types'
import { COMPLETION_DEBOUNCE_MS, createCompletionSource, keyMarkerOption, keyMarkerText, toCompletion } from './cqlCompletion'

const ctx = (doc: string, explicit = false) => new CompletionContext(EditorState.create({ doc }), doc.length, explicit)

const response: CompleteResponse = {
  from: 14,
  items: [
    { label: 'merchant_id', kind: 'column', detail: 'uuid', insert: 'merchant_id', key: 'partition', position: 1 },
    { label: 'txn_time', kind: 'column', detail: 'timeuuid', insert: 'txn_time', key: 'clustering', position: 1, order: 'DESC' },
    { label: 'Orders', kind: 'table', insert: '"Orders"' },
  ],
}

describe('toCompletion', () => {
  it('uses the insert text as label and maps kinds to icon types', () => {
    const c = toCompletion(response.items[2])
    expect(c).toMatchObject({ label: '"Orders"', displayLabel: 'Orders', type: 'class' })
    expect(toCompletion(response.items[0])).toMatchObject({ type: 'property', detail: 'uuid' })
    expect(toCompletion({ label: 'x', kind: 'keyspace', insert: 'x' }).type).toBe('namespace')
    expect(toCompletion({ label: 'now()', kind: 'function', insert: 'now()' }).type).toBe('function')
  })
})

describe('key markers', () => {
  it('describes partition, clustering and static columns', () => {
    expect(keyMarkerText(toCompletion(response.items[0]))).toBe('PK1')
    expect(keyMarkerText(toCompletion(response.items[1]))).toBe('CK1↓')
    expect(keyMarkerText({ label: 'a', key: 'static' })).toBe('S')
    expect(keyMarkerText({ label: 'a' })).toBeNull()
  })
  it('renders a node only for key columns', () => {
    expect(keyMarkerOption.render(toCompletion(response.items[2]))).toBeNull()
    expect(keyMarkerOption.render(toCompletion(response.items[0]))?.textContent).toBe('PK1')
  })
})

describe('createCompletionSource', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (fetcher = vi.fn().mockResolvedValue(response)) => ({
    fetcher,
    source: createCompletionSource({ profile: () => 'local', keyspace: () => 'payments', fetcher }),
  })

  it('waits for the debounce, then asks the server with the document, cursor and keyspace', async () => {
    const { source, fetcher } = make()
    const doc = 'SELECT * FROM payments.'
    const p = source(ctx(doc))
    await vi.advanceTimersByTimeAsync(COMPLETION_DEBOUNCE_MS - 1)
    expect(fetcher).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    const res = await p
    expect(fetcher).toHaveBeenCalledWith('local', { text: doc, cursor: doc.length, keyspace: 'payments' }, expect.any(AbortSignal))
    expect(res).toMatchObject({ from: 14, filter: false })
    expect(res && 'options' in res && res.options.map((o) => o.label)).toEqual(['merchant_id', 'txn_time', '"Orders"'])
  })

  it('skips the debounce for an explicit request', async () => {
    const { source, fetcher } = make()
    const p = source(ctx('SEL', true))
    await vi.advanceTimersByTimeAsync(0)
    await p
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('cancels the previous request when a new one starts', async () => {
    const { source, fetcher } = make()
    const first = source(ctx('S'))
    const second = source(ctx('SE'))
    await vi.advanceTimersByTimeAsync(COMPLETION_DEBOUNCE_MS)
    expect(await first).toBeNull()
    expect(await second).not.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('aborts the in-flight HTTP request when superseded', async () => {
    let signal: AbortSignal | undefined
    const fetcher = vi.fn((_p: string, _b: unknown, s?: AbortSignal) => {
      signal = s
      return new Promise<CompleteResponse>(() => {})
    })
    const source = createCompletionSource({ profile: () => 'local', keyspace: () => '', fetcher })
    void source(ctx('S'))
    await vi.advanceTimersByTimeAsync(COMPLETION_DEBOUNCE_MS)
    expect(signal?.aborted).toBe(false)
    void source(ctx('SE'))
    expect(signal?.aborted).toBe(true)
  })

  it('falls back to keywords when the request fails', async () => {
    const { source } = make(vi.fn().mockRejectedValue(new Error('down')))
    const p = source(ctx('sel'))
    await vi.advanceTimersByTimeAsync(COMPLETION_DEBOUNCE_MS)
    const res = await p
    expect(res && 'options' in res && res.options.some((o) => o.label === 'SELECT')).toBe(true)
  })

  it('offers keywords without a profile and never calls the server', async () => {
    const fetcher = vi.fn()
    const source = createCompletionSource({ profile: () => '', keyspace: () => '', fetcher })
    const res = await source(ctx('sel'))
    expect(fetcher).not.toHaveBeenCalled()
    expect(res && 'options' in res && res.options.some((o) => o.label === 'SELECT')).toBe(true)
  })

  it('returns nothing when the server has no candidates', async () => {
    const { source } = make(vi.fn().mockResolvedValue({ from: 0, items: [] }))
    const p = source(ctx('-- '))
    await vi.advanceTimersByTimeAsync(COMPLETION_DEBOUNCE_MS)
    expect(await p).toBeNull()
  })
})
