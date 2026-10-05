import { defaultImportOptions, formatBytes, formatEta, validateImportOptions } from './importModel'

describe('importModel', () => {
  it('accepts the defaults and flags out-of-range options', () => {
    expect(validateImportOptions(defaultImportOptions)).toEqual({})
    expect(validateImportOptions({ ...defaultImportOptions, concurrency: 0, batch_size: 101, max_errors: 0, ttl: -1 })).toEqual({
      concurrency: 'Use 1 to 64.',
      batch_size: 'Use 1 to 100.',
      max_errors: 'Use at least 1.',
      ttl: 'Use 0 or more seconds.',
    })
  })
  it('formats sizes and ETAs', () => {
    expect(formatBytes(512)).toBe('512 bytes')
    expect(formatBytes(3 << 20)).toBe('3.0 MB')
    expect(formatEta(0)).toBe('–')
    expect(formatEta(90)).toBe('1 min 30 s')
  })
})
