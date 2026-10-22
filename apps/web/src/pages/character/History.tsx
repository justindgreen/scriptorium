import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

export function History({
  characterId,
  revision,
  onError,
}: {
  characterId: string
  revision: number
  onError: (m: string | null) => void
}) {
  const queryClient = useQueryClient()
  const events = useQuery(trpc.characters.events.queryOptions({ characterId, limit: 20 }))
  const undoable = useQuery(trpc.characters.undoAvailability.queryOptions({ characterId }))
  const snapshots = useQuery(trpc.characters.snapshots.list.queryOptions({ characterId }))
  const refresh = () => queryClient.invalidateQueries({ queryKey: trpc.characters.pathKey() })
  const undo = useMutation({
    mutationFn: () =>
      trpcClient.characters.undo.mutate({ characterId, expectedRevision: revision }),
    onSuccess: refresh,
    onError: (e) => onError(errorMessage(e)),
  })
  const restore = useMutation({
    mutationFn: (snapshotId: string) =>
      trpcClient.characters.snapshots.restore.mutate({
        characterId,
        snapshotId,
        expectedRevision: revision,
      }),
    onSuccess: refresh,
    onError: (e) => onError(errorMessage(e)),
  })
  const take = useMutation({
    mutationFn: () => trpcClient.characters.snapshots.take.mutate({ characterId }),
    onSuccess: refresh,
    onError: (e) => onError(errorMessage(e)),
  })
  return (
    <Card data-testid="history">
      <CardHeader>
        <CardTitle>History</CardTitle>
        <CardDescription>
          Undo reverts only the latest change, only while it is reversible and nothing irreversible
          followed, and only within the last 20 events. Rests, level-ups and definition edits are
          covered by snapshots instead.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <Button
          variant="outline"
          disabled={!undoable.data?.ok || undo.isPending}
          onClick={() => undo.mutate()}
          data-testid="undo"
        >
          {undoable.data?.ok ? `Undo ${undoable.data.eventType}` : 'Undo'}
        </Button>
        {undoable.data && !undoable.data.ok ? (
          <p className="text-xs text-muted-foreground" data-testid="undo-reason">
            Undo unavailable: {undoable.data.reason}
          </p>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          disabled={take.isPending}
          onClick={() => take.mutate()}
          data-testid="take-snapshot"
        >
          Take a snapshot now
        </Button>
        <ol className="grid gap-1 text-sm" data-testid="event-log">
          {events.data?.map((e) => (
            <li key={e.id} className="flex justify-between gap-2">
              <span>{e.summary || e.type}</span>
              <span className="tabular text-muted-foreground">r{e.revisionAfter}</span>
            </li>
          ))}
        </ol>
        {snapshots.data && snapshots.data.length > 0 ? (
          <ul className="grid gap-1 border-t pt-3 text-sm">
            {snapshots.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>
                  {s.reason.replace('_', ' ')} · r{s.revision}
                </span>
                <Button size="sm" variant="ghost" onClick={() => restore.mutate(s.id)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
