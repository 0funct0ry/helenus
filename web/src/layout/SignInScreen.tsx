import { useState } from 'react'
import type { FormEvent } from 'react'
import { Eye } from 'lucide-react'
import { Button } from '../ui/Button'
import { Field } from '../ui/Field'
import { useLogin } from '../api/useAuth'
import { describeError } from '../api/client'

export interface SignInScreenProps {
  /** True when a signed-in session ended; the copy then says the session expired and the open tabs are kept. */
  expired?: boolean
}

/**
 * Full-window sign-in card (username and password) shown when sign-in is on and there is no valid
 * session. Failures show one uniform message from the server. Users are created with
 * `helenus user add`; there is no sign-up.
 */
export function SignInScreen({ expired }: SignInScreenProps) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const login = useLogin()
  const submit = (e: FormEvent) => {
    e.preventDefault()
    login.mutate({ username, password }, { onSuccess: () => setPassword('') })
  }
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-editor">
      <form className="w-[340px]" onSubmit={submit} aria-label="Sign in">
        <div className="mb-5 flex items-center justify-center gap-[7px] text-[15px] font-semibold">
          <Eye size={18} className="text-accent" aria-hidden />
          helenus
        </div>
        <h1 className="mb-1 text-center text-lg font-semibold">Sign in</h1>
        <p className="mb-[22px] text-center text-muted">{expired ? 'Your session expired. Your open tabs are kept.' : 'Enter your Helenus username and password.'}</p>
        {login.isError && (
          <div role="alert" className="mb-3 rounded bg-[var(--err-bg)] px-2.5 py-[7px] text-[12.5px] text-danger">
            {describeError(login.error)}
          </div>
        )}
        <div className="flex flex-col gap-3">
          <Field label="Username" className="mb-0" autoFocus autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} />
          <Field label="Password" className="mb-0" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" variant="primary" className="mt-1 h-[30px] w-full justify-center" disabled={login.isPending || !username || !password}>
            {login.isPending ? 'Signing in…' : 'Sign in'}
          </Button>
        </div>
        <p className="mt-5 text-center text-xs text-faint">Accounts are created with <code className="font-mono">helenus user add</code>.</p>
      </form>
    </div>
  )
}
