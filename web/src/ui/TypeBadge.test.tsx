import { render, screen } from '@testing-library/react'
import { TypeBadge } from './TypeBadge'
import { typeFamily } from '../lib/typeFamily'

describe('typeFamily', () => {
  it.each([
    ['uuid', 'uuid'],
    ['timeuuid', 'uuid'],
    ['int', 'num'],
    ['bigint', 'num'],
    ['decimal', 'num'],
    ['varint', 'num'],
    ['counter', 'counter'],
    ['blob', 'blob'],
    ['timestamp', 'time'],
    ['date', 'time'],
    ['time', 'time'],
    ['duration', 'time'],
    ['list<text>', 'coll'],
    ['set<int>', 'coll'],
    ['map<text, text>', 'coll'],
    ['tuple<double, double>', 'coll'],
    ['frozen<list<int>>', 'coll'],
    ['address', 'udt'],
    ['frozen<address>', 'udt'],
    ['vector<float, 3>', 'vec'],
    ['text', 'text'],
  ])('%s -> %s', (type, family) => {
    expect(typeFamily(type)).toBe(family)
  })
})

describe('TypeBadge', () => {
  it('shows the type text and family', () => {
    render(<TypeBadge type="timeuuid" />)
    const el = screen.getByText('timeuuid')
    expect(el).toHaveAttribute('data-family', 'uuid')
    expect(screen.queryByLabelText('frozen')).not.toBeInTheDocument()
  })
  it('shows a snowflake for frozen types and keeps the UDT name', () => {
    render(<TypeBadge type="frozen<address>" />)
    expect(screen.getByLabelText('frozen')).toBeInTheDocument()
    expect(screen.getByText('frozen<address>')).toHaveAttribute('data-family', 'udt')
  })
  it('colours collections yellow and vectors pink', () => {
    render(
      <>
        <TypeBadge type="set<text>" />
        <TypeBadge type="vector<float, 3>" />
      </>,
    )
    expect(screen.getByText('set<text>')).toHaveAttribute('data-tone', 'coll')
    expect(screen.getByText('vector<float, 3>')).toHaveAttribute('data-tone', 'vec')
  })
})
