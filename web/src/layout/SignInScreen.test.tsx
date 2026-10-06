import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { SignInScreen } from './SignInScreen'
import { renderWithClient as render, mockApi } from '../test/api'
import { useSession } from '../store/session'

describe('SignInScreen', () => {
  beforeEach(() => useSession.setState({ user: null, expired: false }))

  it('submits the credentials and records the session', async () => {
    const calls = mockApi({ 'POST /auth/login': { username: 'alice' } })
    render(<SignInScreen />)
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'correct horse battery')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(useSession.getState().user).toBe('alice'))
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/auth/login', body: { username: 'alice', password: 'correct horse battery' } })
  })
  it('shows the server failure message', async () => {
    mockApi({ 'POST /auth/login': { status: 401, body: { error: { code: 'invalid_credentials', message: 'Incorrect username or password.' } } } })
    render(<SignInScreen />)
    await userEvent.type(screen.getByLabelText('Username'), 'alice')
    await userEvent.type(screen.getByLabelText('Password'), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect username or password.')
    expect(useSession.getState().user).toBeNull()
  })
  it('says the session expired and that tabs are kept', () => {
    render(<SignInScreen expired />)
    expect(screen.getByText(/session expired/)).toHaveTextContent('open tabs are kept')
  })
})
