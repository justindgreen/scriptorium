import { useMutation } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { Field, FormError, PageTitle, PrimaryButton, TextInput } from '../components/forms.js'
import { resetSessionCache } from '../lib/session.js'
import { errorMessage, trpc } from '../lib/trpc.js'

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
    <div className="mx-auto max-w-md">
      <PageTitle subtitle="Create the administrator account for this instance. You can invite players afterwards.">
        Set up Scriptorium
      </PageTitle>
      <form onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-4" noValidate>
        <Field
          id="instanceName"
          label="Instance name"
          hint="Shown in the header, e.g. your campaign group's name."
        >
          <TextInput
            id="instanceName"
            value={instanceName}
            onChange={(e) => setInstanceName(e.target.value)}
            required
            maxLength={80}
          />
        </Field>
        <Field id="displayName" label="Your display name">
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
        <PrimaryButton disabled={createAdmin.isPending}>
          {createAdmin.isPending ? 'Creating…' : 'Create administrator'}
        </PrimaryButton>
      </form>
    </div>
  )
}
