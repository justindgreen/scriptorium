import { Link, useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { registerWithInvite } from '@/lib/auth-client'
import { resetSessionCache } from '@/lib/session'

export function RegisterPage() {
  const navigate = useNavigate()
  const search = useSearch({ from: '/auth/register' })
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
    <Card>
      <CardHeader>
        <h1 className="font-display text-2xl font-semibold">Create your account</h1>
        <CardDescription>Registration needs an invite code from an administrator.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
          <FormField id="inviteCode" label="Invite code">
            <Input
              id="inviteCode"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              required
              autoComplete="off"
              spellCheck={false}
              className="font-mono"
            />
          </FormField>
          <FormField
            id="displayName"
            label="Display name"
            hint="How other players and the DM will see you."
          >
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
              aria-describedby="displayName-hint"
            />
          </FormField>
          <FormField
            id="username"
            label="Username"
            hint="3 to 32 characters: letters, digits, dot, underscore or dash."
          >
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={3}
              maxLength={32}
              autoComplete="username"
              aria-describedby="username-hint"
            />
          </FormField>
          <FormField
            id="email"
            label="Email (optional)"
            hint="Kept for your own reference; this instance never sends mail."
          >
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              aria-describedby="email-hint"
            />
          </FormField>
          <FormField id="password" label="Password" hint="At least 10 characters.">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
              aria-describedby="password-hint"
            />
          </FormField>
          <FormField id="confirm" label="Confirm password">
            <Input
              id="confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              required
              minLength={10}
              autoComplete="new-password"
            />
          </FormField>
          <FormError message={error} />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <span>
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </span>
      </CardFooter>
    </Card>
  )
}
