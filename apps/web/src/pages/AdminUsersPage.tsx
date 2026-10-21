import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { errorMessage, trpc } from '@/lib/trpc'

type Row = {
  id: string
  username: string | null
  displayName: string
  role: string
  banned: boolean
  banReason: string | null
  createdAt: Date | string
}

export function AdminUsersPage() {
  const queryClient = useQueryClient()
  const users = useQuery(trpc.admin.users.list.queryOptions())
  const me = useQuery(trpc.me.get.queryOptions())
  const [toDeactivate, setToDeactivate] = useState<Row | null>(null)
  const [reason, setReason] = useState('')

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.users.list.queryKey() })
  const onError = (e: unknown) => toast.error(errorMessage(e))
  const setRole = useMutation(
    trpc.admin.users.setRole.mutationOptions({
      onSuccess: () => {
        toast.success('Role updated')
        void invalidate()
      },
      onError,
    }),
  )
  const ban = useMutation(
    trpc.admin.users.ban.mutationOptions({
      onSuccess: () => {
        toast.success('Account deactivated')
        setToDeactivate(null)
        setReason('')
        void invalidate()
      },
      onError,
    }),
  )
  const unban = useMutation(
    trpc.admin.users.unban.mutationOptions({
      onSuccess: () => {
        toast.success('Account reactivated')
        void invalidate()
      },
      onError,
    }),
  )

  return (
    <div>
      <PageHeader title="Users" description="Roles and access for everyone on this instance." />
      {users.isPending ? <LoadingState rows={4} label="Loading users" /> : null}
      {users.isError ? (
        <ErrorState message={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : null}
      {users.data ? (
        <div className="rounded-lg border bg-card">
          <Table aria-label="Users table">
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Display name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Joined</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.data.map((u) => {
                const isSelf = u.id === me.data?.id
                return (
                  <TableRow key={u.id} data-testid={`user-row-${u.username}`}>
                    <TableCell className="font-medium">{u.username}</TableCell>
                    <TableCell>{u.displayName}</TableCell>
                    <TableCell>
                      <Label htmlFor={`role-${u.id}`} className="sr-only">
                        Role for {u.username}
                      </Label>
                      <Select
                        value={u.role}
                        disabled={isSelf || setRole.isPending}
                        onValueChange={(role) =>
                          setRole.mutate({ userId: u.id, role: role as 'admin' | 'user' })
                        }
                      >
                        <SelectTrigger id={`role-${u.id}`} size="sm" className="w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="user">Player</SelectItem>
                          <SelectItem value="admin">Administrator</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {u.banned ? (
                        <Badge variant="destructive" title={u.banReason ?? undefined}>
                          Deactivated
                        </Badge>
                      ) : (
                        <Badge variant="secondary">Active</Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular whitespace-nowrap">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {isSelf ? (
                        <span className="text-xs text-muted-foreground">You</span>
                      ) : u.banned ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => unban.mutate({ userId: u.id })}
                          disabled={unban.isPending}
                        >
                          Reactivate
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => setToDeactivate(u)}>
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      ) : null}

      <Dialog
        open={toDeactivate !== null}
        onOpenChange={(open) => {
          if (!open) setToDeactivate(null)
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Deactivate {toDeactivate?.displayName}?</DialogTitle>
            <DialogDescription>
              They will be signed out everywhere and cannot sign in until reactivated. Their data is
              kept.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="deactivate-reason">Reason (optional)</Label>
            <Input
              id="deactivate-reason"
              value={reason}
              maxLength={200}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDeactivate(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={ban.isPending}
              onClick={() =>
                toDeactivate &&
                ban.mutate({
                  userId: toDeactivate.id,
                  ...(reason.trim() ? { reason: reason.trim() } : {}),
                })
              }
            >
              Deactivate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
