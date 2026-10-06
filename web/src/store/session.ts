import { create } from 'zustand'

interface SessionState {
  /** Signed-in username, or null before sign-in and after sign-out. */
  user: string | null
  /** True when a request answered 401 after sign-in; the sign-in screen shows over the kept workspace. */
  expired: boolean
  signIn: (user: string) => void
  expire: () => void
  signOut: () => void
}

/** Client-side view of the web UI session; the cookie itself is HttpOnly and never visible here. */
export const useSession = create<SessionState>((set) => ({
  user: null,
  expired: false,
  signIn: (user) => set({ user, expired: false }),
  expire: () => set({ expired: true }),
  signOut: () => set({ user: null, expired: false }),
}))
