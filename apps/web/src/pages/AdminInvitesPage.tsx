import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, KeyRoundIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
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

type Created = { id: string; code: string; url: string }
const statusVariant = {
  active: 'default',
  exhausted: 'secondary',
  expired: 'outline',
  revoked: 'destructive',
} as const

export function AdminInvitesPage() {
  const queryClient = useQueryClient()
  const invites = useQuery(trpc.admin.invites.list.queryOptions())
  const [role, setRole] = useState<'user' | 'admin'>('user')
  const [expiresInHours, setExpiresInHours] = useState(168)
  const [maxUses, setMaxUses] = useState(1)
  const [note, setNote] = useState('')
  const [created, setCreated] = useState<Created | null>(null)

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: trpc.admin.invites.list.queryKey() })
  const create = useMutation(trpc.admin.invites.create.mutationOptions())
  const revoke = useMutation(
    trpc.admin.invites.revoke.mutationOptions({
      onSuccess: () => {
        toast.success('Invite revoked')
        void invalidate()
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  )

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await create.mutateAsync({
        role,
        expiresInHours,
        maxUses,
        ...(note.trim() ? { note: note.trim() } : {}),
      })
      setCreated(result)
      setNote('')
      toast.success('Invite created')
      await invalidate()
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy. Select the link and copy it manually.')
    }
  }

  return (
    <div>
      <PageHeader
        title="Invites"
        description="Players register with an invite code. Codes are shown once; revoke any you no longer want."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          {created ? (
            <Alert data-testid="created-invite">
              <KeyRoundIcon aria-hidden="true" />
              <AlertTitle>Invite created</AlertTitle>
              <AlertDescription>
                <p>
                  Code:{' '}
                  <code className="font-mono" data-testid="invite-code">
                    {created.code}
                  </code>
                </p>
                <p className="break-all">
                  Link:{' '}
                  <code className="font-mono" data-testid="invite-url">
                    {created.url}
                  </code>
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => void copy(created.url)}
                >
                  <CopyIcon aria-hidden="true" /> Copy link
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}

          {invites.isPending ? <LoadingState rows={3} label="Loading invites" /> : null}
          {invites.isError ? (
            <ErrorState
              message={errorMessage(invites.error)}
              onRetry={() => void invites.refetch()}
            />
          ) : null}
          {invites.data && invites.data.length === 0 ? (
            <EmptyState
              icon={KeyRoundIcon}
              title="No invites yet"
              description="Create one to bring in your first player. Each code can be limited to a number of uses and a time window."
            />
          ) : null}
          {invites.data && invites.data.length > 0 ? (
            <div className="rounded-lg border bg-card">
              <Table aria-label="Invites table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Status</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Uses</TableHead>
                    <TableHead>Expires</TableHead>
                    <TableHead>Note</TableHead>
                    <TableHead>Created by</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invites.data.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell>
                        <Badge variant={statusVariant[i.status]} className="capitalize">
                          {i.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{i.role === 'admin' ? 'Administrator' : 'Player'}</TableCell>
                      <TableCell className="tabular">
                        {i.uses} / {i.maxUses}
                      </TableCell>
                      <TableCell className="tabular whitespace-nowrap">
                        {new Date(i.expiresAt).toLocaleString()}
                      </TableCell>
                      <TableCell>{i.note}</TableCell>
                      <TableCell>{i.createdByUsername}</TableCell>
                      <TableCell className="text-right">
                        {i.status === 'active' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => revoke.mutate({ id: i.id })}
                            disabled={revoke.isPending}
                          >
                            Revoke
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>New invite</CardTitle>
            <CardDescription>Share the link or the code with your player.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={(e) => void onSubmit(e)} className="grid gap-4" noValidate>
              <FormField id="role" label="Role">
                <Select value={role} onValueChange={(v) => setRole(v as 'user' | 'admin')}>
                  <SelectTrigger id="role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">Player</SelectItem>
                    <SelectItem value="admin">Administrator</SelectItem>
                  </SelectContent>
                </Select>
              </FormField>
              <FormField id="expires" label="Expires in (hours)">
                <Input
                  id="expires"
                  type="number"
                  min={1}
                  max={720}
                  value={expiresInHours}
                  onChange={(e) => setExpiresInHours(Number(e.target.value))}
                />
              </FormField>
              <FormField id="maxUses" label="Maximum uses">
                <Input
                  id="maxUses"
                  type="number"
                  min={1}
                  max={100}
                  value={maxUses}
                  onChange={(e) => setMaxUses(Number(e.target.value))}
                />
              </FormField>
              <FormField id="note" label="Note (optional)">
                <Input
                  id="note"
                  value={note}
                  maxLength={200}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Thursday group"
                />
              </FormField>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending ? 'Creating…' : 'Create invite'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
