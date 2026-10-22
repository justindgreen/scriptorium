import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { HammerIcon, PlusIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

/** M2.7: the author's sources and magic items. Drafts stay private until published. */
export function HomebrewPage() {
  const queryClient = useQueryClient()
  const sources = useQuery(trpc.homebrew.sources.list.queryOptions())
  const items = useQuery(trpc.homebrew.items.list.queryOptions())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createSource = useMutation({
    mutationFn: (sourceName: string) =>
      trpcClient.homebrew.sources.create.mutate({ name: sourceName }),
    onSuccess: async () => {
      setName('')
      setError(null)
      await queryClient.invalidateQueries({ queryKey: trpc.homebrew.sources.list.queryKey() })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const onCreateSource = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) createSource.mutate(name.trim())
  }

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Homebrew"
        description="Magic items with real mechanics: the same schema as the SRD, validated before anything is stored."
        actions={
          sources.data && sources.data.length > 0 ? (
            <Button asChild>
              <Link
                to="/homebrew/items/$entryId"
                params={{ entryId: 'new' }}
                data-testid="new-item"
              >
                <PlusIcon aria-hidden="true" /> New item
              </Link>
            </Button>
          ) : null
        }
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-6">
          {items.isPending ? <LoadingState rows={3} /> : null}
          {items.isError ? (
            <ErrorState title="Could not load items" message={errorMessage(items.error)} />
          ) : null}
          {items.data && items.data.length === 0 ? (
            <EmptyState
              icon={HammerIcon}
              title="No items yet"
              description={
                sources.data && sources.data.length > 0
                  ? 'Create a magic item: pick a base weapon, add bonuses, charges, granted spells and extra damage.'
                  : 'Create a source first; your items live in it.'
              }
              action={
                sources.data && sources.data.length > 0 ? (
                  <Button asChild>
                    <Link to="/homebrew/items/$entryId" params={{ entryId: 'new' }}>
                      <PlusIcon aria-hidden="true" /> New item
                    </Link>
                  </Button>
                ) : null
              }
            />
          ) : null}
          {items.data && items.data.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="homebrew-items">
              {items.data.map((i) => (
                <li key={i.id}>
                  <Link
                    to="/homebrew/items/$entryId"
                    params={{ entryId: i.id }}
                    className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-colors hover:bg-accent/40">
                      <CardHeader>
                        <CardTitle className="flex flex-wrap items-center gap-2">
                          {i.name}
                          <Badge variant={i.status === 'published' ? 'default' : 'secondary'}>
                            {i.status === 'published' ? `published v${i.headVersionNo}` : 'draft'}
                          </Badge>
                          {i.status === 'published' && i.draftVersionId ? (
                            <Badge variant="outline">draft changes</Badge>
                          ) : null}
                        </CardTitle>
                        <CardDescription>
                          {i.sourceName} · <code className="text-xs">{i.uid}</code>
                        </CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Card className="self-start" data-testid="sources">
          <CardHeader>
            <CardTitle>Sources</CardTitle>
            <CardDescription>
              A source is your collection: its name appears as the attribution on every item in it.
              Sources are private until campaigns share them.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {sources.data && sources.data.length > 0 ? (
              <ul className="grid gap-1 text-sm">
                {sources.data.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2">
                    <span>
                      {s.name} <span className="text-muted-foreground">· {s.slug}</span>
                    </span>
                    <span className="text-muted-foreground">{s.entryCount} entries</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No source yet.</p>
            )}
            <form className="grid gap-2" onSubmit={onCreateSource}>
              <FormField id="source-name" label="New source">
                <Input
                  id="source-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Thursday Table homebrew"
                  data-testid="source-name"
                />
              </FormField>
              <FormError message={error} />
              <div>
                <Button
                  type="submit"
                  variant="outline"
                  disabled={!name.trim() || createSource.isPending}
                  data-testid="source-create"
                >
                  Create source
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
