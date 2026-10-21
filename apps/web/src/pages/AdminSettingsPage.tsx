import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import { FormField } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc } from '@/lib/trpc'

export function AdminSettingsPage() {
  const queryClient = useQueryClient()
  const settings = useQuery(trpc.admin.settings.get.queryOptions())
  // Draft stays null until the user edits, so the loaded value shows without syncing state in an effect.
  const [draft, setDraft] = useState<string | null>(null)
  const instanceName = draft ?? settings.data?.instanceName ?? ''

  const save = useMutation(
    trpc.admin.settings.set.mutationOptions({
      onSuccess: async () => {
        toast.success('Settings saved')
        setDraft(null)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.admin.settings.get.queryKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.system.status.queryKey() }),
        ])
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    save.mutate({ instanceName })
  }

  return (
    <div>
      <PageHeader title="Settings" description="Instance-wide options." />
      {settings.isPending ? <LoadingState rows={2} label="Loading settings" /> : null}
      {settings.isError ? (
        <ErrorState
          message={errorMessage(settings.error)}
          onRetry={() => void settings.refetch()}
        />
      ) : null}
      {settings.data ? (
        <Card className="max-w-xl">
          <CardHeader>
            <CardTitle>Instance</CardTitle>
            <CardDescription>The name shown in the header and on sign-in.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <FormField id="instanceName" label="Instance name">
                <Input
                  id="instanceName"
                  value={instanceName}
                  maxLength={80}
                  required
                  onChange={(e) => setDraft(e.target.value)}
                />
              </FormField>
              <div>
                <Button type="submit" disabled={save.isPending || instanceName.trim().length === 0}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
