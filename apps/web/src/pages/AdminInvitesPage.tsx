import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import {
  Field,
  FormError,
  PageTitle,
  PrimaryButton,
  SecondaryButton,
  TextInput,
} from '../components/forms.js'
import { errorMessage, trpc } from '../lib/trpc.js'

type Created = { id: string; code: string; url: string }

export function AdminInvitesPage() {
  const queryClient = useQueryClient()
  const invites = useQuery(trpc.admin.invites.list.queryOptions())
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [expiresInHours, setExpiresInHours] = useState(168)
  const [maxUses, setMaxUses] = useState(1)
  const [note, setNote] = useState('')
  const [created, setCreated] = useState<Created | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.invites.list.queryKey() })
  const create = useMutation(trpc.admin.invites.create.mutationOptions())
  const revoke = useMutation(
    trpc.admin.invites.revoke.mutationOptions({
      onSuccess: invalidate,
      onError: (e) => setError(errorMessage(e)),
    }),
  )

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setCopied(false)
    try {
      const result = await create.mutateAsync({
        role,
        expiresInHours,
        maxUses,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setCreated(result)
      await invalidate()
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div>
      <PageTitle subtitle="Players register with an invite code. Codes are shown once; revoke any you no longer want.">
        Invites
      </PageTitle>

      <form
        onSubmit={(e) => void onSubmit(e)}
        className="mb-8 grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2"
        noValidate
      >
        <Field id="role" label="Role">
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
            className="rounded border border-stone-300 bg-white px-3 py-2 text-sm dark:border-stone-700 dark:bg-stone-900"
          >
            <option value="user">Player</option>
            <option value="admin">Administrator</option>
          </select>
        </Field>
        <Field id="expires" label="Expires in (hours)">
          <TextInput
            id="expires"
            type="number"
            min={1}
            max={720}
            value={expiresInHours}
            onChange={(e) => setExpiresInHours(Number(e.target.value))}
          />
        </Field>
        <Field id="maxUses" label="Maximum uses">
          <TextInput
            id="maxUses"
            type="number"
            min={1}
            max={100}
            value={maxUses}
            onChange={(e) => setMaxUses(Number(e.target.value))}
          />
        </Field>
        <Field id="note" label="Note (optional)">
          <TextInput
            id="note"
            value={note}
            maxLength={200}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Thursday group"
          />
        </Field>
        <div className="sm:col-span-2">
          <FormError message={error} />
          <PrimaryButton disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create invite'}
          </PrimaryButton>
        </div>
      </form>

      {created ? (
        <section
          aria-live="polite"
          className="mb-8 rounded border border-stone-300 bg-white p-4 text-sm dark:border-stone-700 dark:bg-stone-900"
          data-testid="created-invite"
        >
          <h2 className="mb-2 font-semibold">Invite created</h2>
          <p>
            Code:{' '}
            <code className="font-mono" data-testid="invite-code">
              {created.code}
            </code>
          </p>
          <p className="mt-1 break-all">
            Link:{' '}
            <code className="font-mono" data-testid="invite-url">
              {created.url}
            </code>
          </p>
          <div className="mt-3 flex gap-2">
            <SecondaryButton onClick={() => void copy(created.url)}>
              {copied ? 'Copied' : 'Copy link'}
            </SecondaryButton>
          </div>
        </section>
      ) : null}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-300 text-left dark:border-stone-700">
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Uses</th>
            <th className="py-2 pr-4">Expires</th>
            <th className="py-2 pr-4">Note</th>
            <th className="py-2 pr-4">Created by</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {invites.data?.map((i) => (
            <tr key={i.id} className="border-b border-stone-200 dark:border-stone-800">
              <td className="py-2 pr-4 capitalize">{i.status}</td>
              <td className="py-2 pr-4">{i.role === 'admin' ? 'Administrator' : 'Player'}</td>
              <td className="py-2 pr-4">
                {i.uses} / {i.maxUses}
              </td>
              <td className="py-2 pr-4">{new Date(i.expiresAt).toLocaleString()}</td>
              <td className="py-2 pr-4">{i.note}</td>
              <td className="py-2 pr-4">{i.createdByUsername}</td>
              <td className="py-2">
                {i.status === 'active' ? (
                  <SecondaryButton
                    onClick={() => {
                      setError(null)
                      revoke.mutate({ id: i.id })
                    }}
                    disabled={revoke.isPending}
                  >
                    Revoke
                  </SecondaryButton>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {invites.data?.length === 0 ? (
        <p className="mt-4 text-sm opacity-70">
          No invites yet. Create one above to bring in your first player.
        </p>
      ) : null}
    </div>
  )
}
