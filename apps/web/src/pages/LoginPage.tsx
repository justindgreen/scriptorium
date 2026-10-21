import { Link, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { signInWithUsername } from '@/lib/auth-client'
import { resetSessionCache } from '@/lib/session'

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
    <Card>
      <CardHeader>
        <h1 className="font-display text-2xl font-semibold">Sign in</h1>
        <CardDescription>Use the username your Dungeon Master gave you.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
          <FormField id="username" label="Username">
            <Input
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              autoComplete="username"
            />
          </FormField>
          <FormField id="password" label="Password">
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete="current-password"
            />
          </FormField>
          <FormError message={error} />
          <Button type="submit" disabled={pending} className="w-full">
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardContent>
      <CardFooter className="text-sm text-muted-foreground">
        <span>
          Have an invite?{' '}
          <Link
            to="/register"
            search={{ invite: '' }}
            className="text-foreground underline underline-offset-4"
          >
            Create your account
          </Link>
        </span>
      </CardFooter>
    </Card>
  )
}
