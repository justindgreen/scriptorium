import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Field, FormError, PageTitle, PrimaryButton, TextInput } from '../components/forms.js'
import { signInWithUsername } from '../lib/auth-client.js'
import { resetSessionCache } from '../lib/session.js'

export function LoginPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setPending(true)
    setError(null)
    const result = await signInWithUsername(username, password)
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await resetSessionCache()
    await navigate({ to: '/' })
  }

  return (
    <div className="mx-auto max-w-sm">
      <PageTitle subtitle="Sign in with the username your Dungeon Master gave you.">
        Sign in
      </PageTitle>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <Field id="username" label="Username">
          <TextInput
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoComplete="username"
          />
        </Field>
        <Field id="password" label="Password">
          <TextInput
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="current-password"
          />
        </Field>
        <FormError message={error} />
        <PrimaryButton disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</PrimaryButton>
      </form>
      <p className="mt-6 text-sm opacity-80">
        Have an invite?{' '}
        <a href="/register" className="underline">
          Create your account
        </a>
        .
      </p>
    </div>
  )
}
