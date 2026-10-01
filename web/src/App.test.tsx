import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import { initialTabs, useWorkspace } from './store/workspace'

describe('App', () => {
  beforeEach(() => useWorkspace.setState({ tabs: initialTabs, activeId: initialTabs[0].id, paletteOpen: false, profileDialogOpen: false }))

  it('renders the shell regions', () => {
    render(<App />)
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'Schema' })).toBeInTheDocument()
    expect(screen.getByRole('tablist', { name: 'Open tabs' })).toBeInTheDocument()
    expect(screen.getByRole('contentinfo')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Results' })).toBeInTheDocument()
  })
  it('switches tabs and closes them', async () => {
    render(<App />)
    await userEvent.click(screen.getByRole('tab', { name: 'query-1.cql' }))
    expect(screen.getByRole('region', { name: 'Query output' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Close query-1.cql' }))
    expect(screen.queryByRole('tab', { name: 'query-1.cql' })).not.toBeInTheDocument()
  })
  it('opens the command palette with Ctrl-K', async () => {
    render(<App />)
    await userEvent.keyboard('{Control>}k{/Control}')
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
  })
  it('has no native select elements', () => {
    const { container } = render(<App />)
    expect(container.querySelector('select, dialog')).toBeNull()
  })
})
