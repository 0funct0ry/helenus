import { render, screen } from '@testing-library/react'
import { KeyMarker } from './KeyMarker'

describe('KeyMarker', () => {
  it('shows partition key with position', () => {
    render(<KeyMarker kind="partition" position={2} />)
    const el = screen.getByLabelText('Partition key 2')
    expect(el).toHaveTextContent('2')
    expect(el.querySelector('svg')).toBeInTheDocument()
  })
  it('shows clustering order and position', () => {
    render(<KeyMarker kind="clustering" position={1} order="DESC" />)
    expect(screen.getByLabelText('Clustering key 1 DESC')).toHaveTextContent('1')
  })
  it('defaults clustering to ASC', () => {
    render(<KeyMarker kind="clustering" position={3} />)
    expect(screen.getByLabelText('Clustering key 3 ASC')).toBeInTheDocument()
  })
  it('shows an S pill for static columns', () => {
    render(<KeyMarker kind="static" />)
    expect(screen.getByLabelText('Static column')).toHaveTextContent('S')
  })
  it('renders nothing for regular columns', () => {
    const { container } = render(<KeyMarker kind="regular" />)
    expect(container).toBeEmptyDOMElement()
  })
})
