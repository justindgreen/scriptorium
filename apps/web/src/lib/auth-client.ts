import { createAuthClient } from 'better-auth/client'
import { adminClient, usernameClient } from 'better-auth/client/plugins'

/** Better Auth browser client. Cookies are same-origin; in dev Vite proxies /api/auth to the server. */
export const authClient = createAuthClient({
  baseURL: window.location.origin,
  basePath: '/api/auth',
  plugins: [usernameClient(), adminClient()],
})

/** Accounts without an email get a synthetic one; the server never sends mail to it. */
export function syntheticEmail(username: string): string {
  return `${username.toLowerCase()}@scriptorium.local`
}

export type AuthResult = { ok: true } | { ok: false; message: string }

export async function signInWithUsername(username: string, password: string): Promise<AuthResult> {
  const result = await authClient.signIn.username({ username, password })
  if (result.error) return { ok: false, message: result.error.message ?? 'Sign-in failed.' }
  return { ok: true }
}

export async function registerWithInvite(input: {
  username: string
  displayName: string
  password: string
  inviteCode: string
  email?: string
}): Promise<AuthResult> {
  const body = {
    email: input.email?.trim() || syntheticEmail(input.username),
    password: input.password,
    name: input.displayName,
    username: input.username,
    inviteCode: input.inviteCode.trim(),
  }
  // `inviteCode` is consumed by the server's registration hook; the client type does not know it.
  const result = await authClient.signUp.email(
    body as Parameters<typeof authClient.signUp.email>[0],
  )
  if (result.error) return { ok: false, message: result.error.message ?? 'Registration failed.' }
  return { ok: true }
}

export async function signOutEverywhere(): Promise<void> {
  await authClient.signOut()
}
