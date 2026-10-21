import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormError, PageTitle, SecondaryButton } from '../components/forms.js'
import { errorMessage, trpc } from '../lib/trpc.js'

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const users = useQuery(trpc.admin.users.list.queryOptions())
  const me = useQuery(trpc.me.get.queryOptions())
  const [error, setError] = useState<string | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
  const onError = (e: unknown) => setError(errorMessage(e))
  const setRole = useMutation(
    trpc.admin.users.setRole.mutationOptions({ onSuccess: invalidate, onError }),
  )
  const ban = useMutation(trpc.admin.users.ban.mutationOptions({ onSuccess: invalidate, onError }))
  const unban = useMutation(
    trpc.admin.users.unban.mutationOptions({ onSuccess: invalidate, onError }),
  )

  return (
    <div>
      <PageTitle subtitle="Roles and access for everyone on this instance.">Users</PageTitle>
      <FormError message={error} />
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-stone-300 text-left dark:border-stone-700">
            <th className="py-2 pr-4">Username</th>
            <th className="py-2 pr-4">Display name</th>
            <th className="py-2 pr-4">Role</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2 pr-4">Joined</th>
            <th className="py-2">Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.data?.map((u) => {
            const isSelf = u.id === me.data?.id
            return (
              <tr
                key={u.id}
                className="border-b border-stone-200 dark:border-stone-800"
                data-testid={`user-row-${u.username}`}
              >
                <td className="py-2 pr-4 font-medium">{u.username}</td>
                <td className="py-2 pr-4">{u.displayName}</td>
                <td className="py-2 pr-4">
                  <label className="sr-only" htmlFor={`role-${u.id}`}>
                    Role for {u.username}
                  </label>
                  <select
                    id={`role-${u.id}`}
                    value={u.role}
                    disabled={isSelf || setRole.isPending}
                    onChange={(e) => {
                      setError(null)
                      setRole.mutate({ userId: u.id, role: e.target.value as 'admin' | 'user' })
                    }}
                    className="rounded border border-stone-300 bg-white px-2 py-1 dark:border-stone-700 dark:bg-stone-900"
                  >
                    <option value="user">Player</option>
                    <option value="admin">Administrator</option>
                  </select>
                </td>
                <td className="py-2 pr-4">
                  {u.banned ? `Deactivated${u.banReason ? ` (${u.banReason})` : ''}` : 'Active'}
                </td>
                <td className="py-2 pr-4">{new Date(u.createdAt).toLocaleDateString()}</td>
                <td className="py-2">
                  {isSelf ? (
                    <span className="opacity-60">You</span>
                  ) : u.banned ? (
                    <SecondaryButton
                      onClick={() => {
                        setError(null)
                        unban.mutate({ userId: u.id })
                      }}
                      disabled={unban.isPending}
                    >
                      Reactivate
                    </SecondaryButton>
                  ) : (
                    <SecondaryButton
                      onClick={() => {
                        setError(null)
                        ban.mutate({ userId: u.id })
                      }}
                      disabled={ban.isPending}
                    >
                      Deactivate
                    </SecondaryButton>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {users.data?.length === 0 ? <p className="mt-4 text-sm opacity-70">No users yet.</p> : null}
    </div>
  )
}
