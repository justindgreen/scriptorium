import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Field, FormError, PageTitle, PrimaryButton, TextInput } from '../components/forms.js'
import { registerWithInvite } from '../lib/auth-client.js'
import { resetSessionCache } from '../lib/session.js'

export function RegisterPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/register' })
  const [inviteCode, setInviteCode] = useState(search.invite)
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    setPending(true)
    const result = await registerWithInvite({ inviteCode, displayName, username, password, email })
    setPending(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    await resetSessionCache()
    await navigate({ to: '/' })
  }

  return (
    <div className="mx-auto max-w-md">
      <PageTitle subtitle="Registration needs an invite code from an administrator.">
        Create your account
      </PageTitle>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <Field id="inviteCode" label="Invite code">
          <TextInput
            id="inviteCode"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="displayName"
          label="Display name"
          hint="How other players and the DM will see you."
        >
          <TextInput
            id="displayName"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            required
            maxLength={80}
            autoComplete="name"
          />
        </Field>
        <Field
          id="username"
          label="Username"
          hint="3 to 32 characters: letters, digits, dot, underscore or dash."
        >
          <TextInput
            id="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            minLength={3}
            maxLength={32}
            autoComplete="username"
          />
        </Field>
        <Field
          id="email"
          label="Email (optional)"
          hint="Only stored for your own reference; this instance never sends mail."
        >
          <TextInput
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
        </Field>
        <Field id="password" label="Password" hint="At least 10 characters.">
          <TextInput
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={10}
            autoComplete="new-password"
          />
        </Field>
        <Field id="confirm" label="Confirm password">
          <TextInput
            id="confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            minLength={10}
            autoComplete="new-password"
          />
        </Field>
        <FormError message={error} />
        <PrimaryButton disabled={pending}>
          {pending ? 'Creating account…' : 'Create account'}
        </PrimaryButton>
      </form>
      <p className="mt-6 text-sm opacity-80">
        Already have an account?{' '}
        <a href="/login" className="underline">
          Sign in
        </a>
        .
      </p>
    </div>
  )
}
