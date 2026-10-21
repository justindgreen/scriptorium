import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { resetSessionCache } from '@/lib/session'
import { errorMessage, trpc } from '@/lib/trpc'

export function SetupPage() {
  const navigate = useNavigate()
  const [instanceName, setInstanceName] = useState('Our Table')
  const [displayName, setDisplayName] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createAdmin = useMutation(trpc.setup.createAdmin.mutationOptions())

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (password !== confirm) {
      setError('The passwords do not match.')
      return
    }
    try {
      await createAdmin.mutateAsync({ instanceName, displayName, username, password })
      await resetSessionCache()
      await navigate({ to: '/' })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  return (
    <Card>
      <CardHeader>
        <h1 className="font-display text-2xl font-semibold">Set up Scriptorium</h1>
        <CardDescription>
          Create the administrator account for this instance. You can invite players afterwards.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
          <FormField
            id="instanceName"
            label="Instance name"
            hint="Shown in the header, e.g. your group's name."
          >
            <Input
              id="instanceName"
              value={instanceName}
              onChange={(e) => setInstanceName(e.target.value)}
              required
              maxLength={80}
              aria-describedby="instanceName-hint"
            />
          </FormField>
          <FormField id="displayName" label="Your display name">
            <Input
              id="displayName"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
              maxLength={80}
              autoComplete="name"
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
          <Button type="submit" disabled={createAdmin.isPending} className="w-full">
            {createAdmin.isPending ? 'Creating…' : 'Create administrator'}
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
