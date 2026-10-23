import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

/**
 * Deleting a character (issue #22): owner or administrator, confirmed by typing the name. The
 * server refuses while the character is on a campaign roster or in an unfinished encounter and
 * says what to do; the error is shown here, next to the control. Deletion is a soft delete: the
 * record and its history stay on the server, but the app has no restore control.
 */
export function DangerZone({ characterId, name }: { characterId: string; name: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const matches = typed.trim().toLowerCase() === name.trim().toLowerCase()
  const remove = useMutation({
    mutationFn: () => trpcClient.characters.delete.mutate({ characterId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() })
      await navigate({ to: '/characters' })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  return (
    <Card data-testid="danger-zone" className="print:hidden">
      <CardHeader>
        <CardTitle>Manage</CardTitle>
        <CardDescription>
          Deleting hides {name} from every list and sheet. Its history, snapshots and finished
          encounters are kept on the server; the app has no restore button, so treat it as final.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {!open ? (
          <div>
            <Button
              variant="outline"
              onClick={() => {
                setOpen(true)
                setError(null)
              }}
              data-testid="delete-character"
            >
              Delete character…
            </Button>
          </div>
        ) : (
          <div
            className="grid gap-2 rounded-md border border-destructive/50 p-3"
            role="group"
            aria-label={`Delete ${name}`}
            data-testid="delete-prompt"
          >
            <p className="font-medium">Delete {name}?</p>
            <p className="text-muted-foreground">
              A character on a campaign roster or in an unfinished encounter cannot be deleted;
              withdraw it from the campaign (or ask the DM to end the encounter) first.
            </p>
            <label className="grid gap-1" htmlFor="delete-confirm-name">
              Type the character&apos;s name to confirm
              <Input
                id="delete-confirm-name"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                data-testid="delete-confirm-name"
              />
            </label>
            {error ? (
              <p className="text-destructive" role="alert" data-testid="delete-error">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                size="sm"
                disabled={!matches || remove.isPending}
                onClick={() => remove.mutate()}
                data-testid="delete-confirm"
              >
                {remove.isPending ? 'Deleting…' : `Delete ${name}`}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setOpen(false)
                  setTyped('')
                  setError(null)
                }}
                data-testid="delete-cancel"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
