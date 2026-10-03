import { inputText, isScalar, isTextType, parseInput } from './cellInput'

const t = (name: string) => ({ name })
const value = (name: string, text: string) => {
  const r = parseInput(t(name), text)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const error = (name: string, text: string) => {
  const r = parseInput(t(name), text)
  if (r.ok) throw new Error(`${text} was accepted as ${name}`)
  return r.error
}

describe('parseInput', () => {
  it('keeps text as typed, including the empty string', () => {
    expect(value('text', ' hi ')).toBe(' hi ')
    expect(value('varchar', '')).toBe('')
    expect(error('ascii', 'café')).toMatch(/ASCII/)
  })
  it('checks integer ranges and encodes bigint as a string', () => {
    expect(value('tinyint', '-128')).toBe(-128)
    expect(error('tinyint', '128')).toMatch(/between -128 and 127/)
    expect(value('int', '2147483647')).toBe(2147483647)
    expect(error('int', '2147483648')).toMatch(/between/)
    expect(value('bigint', '9007199254740993')).toBe('9007199254740993')
    expect(error('bigint', '9223372036854775808')).toMatch(/between/)
    expect(value('counter', '+5')).toBe('5')
    expect(value('varint', '-1208925819614629174706176')).toBe('-1208925819614629174706176')
    expect(error('int', '1.5')).toMatch(/whole number/)
    expect(error('int', 'abc')).toMatch(/whole number/)
  })
  it('reads decimals, floats and doubles', () => {
    expect(value('decimal', '12.50')).toBe('12.50')
    expect(value('decimal', '+.5')).toBe('.5')
    expect(error('decimal', '1,5')).toMatch(/decimal/)
    expect(value('double', '1e3')).toBe(1000)
    expect(value('double', '-Infinity')).toBe('-Infinity')
    expect(value('float', 'NaN')).toBe('NaN')
    expect(error('float', '1e39')).toMatch(/limited/)
    expect(error('double', '0x10')).toMatch(/number/)
  })
  it('requires a value for everything but text', () => {
    expect(error('int', '  ')).toMatch(/required/)
    expect(error('uuid', '')).toMatch(/required/)
  })
  it('validates UUIDs and timeuuid versions', () => {
    expect(value('uuid', '7C9E6679-7425-40DE-944B-E07FC1F90AE7')).toBe('7c9e6679-7425-40de-944b-e07fc1f90ae7')
    expect(error('uuid', '7c9e6679')).toMatch(/UUID/)
    expect(value('timeuuid', '3f1a2b10-9d3c-11ef-8a6e-0242ac120002')).toBe('3f1a2b10-9d3c-11ef-8a6e-0242ac120002')
    expect(error('timeuuid', '7c9e6679-7425-40de-944b-e07fc1f90ae7')).toMatch(/version 1/)
  })
  it('validates dates, times and timestamps', () => {
    expect(value('date', '2026-09-30')).toBe('2026-09-30')
    expect(error('date', '2026-02-30')).toMatch(/YYYY-MM-DD/)
    expect(value('time', '01:02:03.123')).toBe('01:02:03.123')
    expect(error('time', '24:00:00')).toMatch(/HH:MM:SS/)
    expect(value('timestamp', '2026-09-30T10:00:00Z')).toBe('2026-09-30T10:00:00.000Z')
    expect(value('timestamp', '2026-09-30 10:00:00.5')).toBe('2026-09-30T10:00:00.500Z')
    expect(value('timestamp', '2026-09-30T10:00:00+02:00')).toBe('2026-09-30T08:00:00.000Z')
    expect(value('timestamp', '2026-09-30')).toBe('2026-09-30T00:00:00.000Z')
    expect(error('timestamp', 'yesterday')).toMatch(/ISO-8601/)
    expect(error('timestamp', '2026-09-30T25:00:00Z')).toMatch(/time of day/)
  })
  it('validates inet addresses', () => {
    expect(value('inet', '10.0.0.1')).toBe('10.0.0.1')
    expect(value('inet', '::1')).toBe('::1')
    expect(value('inet', '2001:db8::ff00:42:8329')).toBe('2001:db8::ff00:42:8329')
    expect(value('inet', '::ffff:10.0.0.1')).toBe('::ffff:10.0.0.1')
    expect(error('inet', '256.0.0.1')).toMatch(/IPv4/)
    expect(error('inet', '1:2:3')).toMatch(/IPv4/)
    expect(error('inet', 'host')).toMatch(/IPv4/)
  })
  it('validates booleans, blobs and durations', () => {
    expect(value('boolean', 'TRUE')).toBe(true)
    expect(value('boolean', 'false')).toBe(false)
    expect(error('boolean', 'yes')).toMatch(/true or false/)
    expect(value('blob', '0xCAFE')).toBe('0xcafe')
    expect(value('blob', '0x')).toBe('0x')
    expect(error('blob', '0xabc')).toMatch(/0x/)
    expect(value('duration', '1mo2d3h4m')).toBe('1mo2d3h4m')
    expect(error('duration', '3 weeks')).toMatch(/duration/)
  })
  it('refuses types it cannot edit inline', () => {
    expect(error('list', '[1]')).toMatch(/cannot be edited/)
  })
})

describe('type helpers', () => {
  it('tells scalars from composite types', () => {
    expect(isScalar(t('int'))).toBe(true)
    expect(isScalar(t('map'))).toBe(false)
    expect(isScalar({ name: 'address', udt: { keyspace: 'k', name: 'address' } })).toBe(false)
    expect(isTextType(t('text'))).toBe(true)
    expect(isTextType(t('inet'))).toBe(false)
  })
  it('renders existing values as editor text', () => {
    expect(inputText(null)).toBe('')
    expect(inputText(5)).toBe('5')
    expect(inputText('x')).toBe('x')
    expect(inputText(true)).toBe('true')
  })
})
