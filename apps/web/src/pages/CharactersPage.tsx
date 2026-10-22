import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PlusIcon, ScrollIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { uidLabel } from '@/lib/characters'
import { errorMessage, trpc } from '@/lib/trpc'

type Summary = {
  level?: number
  classes?: Array<{ name: string; level: number; subclassName?: string }>
  hp?: { current: number; max: number }
}

export function CharactersPage() {
  const characters = useQuery(trpc.characters.list.queryOptions())

  return (
    <div>
      <PageHeader
        title="Characters"
        description="Your characters on this table. Every change is a logged command you can undo or restore."
        actions={
          <Button asChild>
            <Link to="/characters/new" data-testid="new-character">
              <PlusIcon aria-hidden="true" /> New character
            </Link>
          </Button>
        }
      />
      {characters.isPending ? <LoadingState rows={3} /> : null}
      {characters.isError ? (
        <ErrorState title="Could not load characters" message={errorMessage(characters.error)} />
      ) : null}
      {characters.data && characters.data.length === 0 ? (
        <EmptyState
          icon={ScrollIcon}
          title="No characters yet"
          description="Build your first character: species, background, class and ability scores take a minute."
          action={
            <Button asChild>
              <Link to="/characters/new">
                <PlusIcon aria-hidden="true" /> New character
              </Link>
            </Button>
          }
        />
      ) : null}
      {characters.data && characters.data.length > 0 ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="character-list">
          {characters.data.map((c) => {
            const summary = (c.summary ?? {}) as Summary
            const classes = summary.classes
              ?.map((k) => `${k.name}${k.subclassName ? ` (${k.subclassName})` : ''} ${k.level}`)
              .join(' / ')
            return (
              <li key={c.id}>
                <Link
                  to="/characters/$characterId"
                  params={{ characterId: c.id }}
                  className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Card className="h-full transition-colors hover:bg-accent/40">
                    <CardHeader>
                      <CardTitle>{c.name}</CardTitle>
                      <CardDescription>
                        {summary.level ? `Level ${summary.level}` : 'Draft'}
                        {classes ? ` · ${classes}` : ''}
                        {c.speciesUid ? ` · ${uidLabel(c.speciesUid)}` : ''}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-sm text-muted-foreground">
                      {summary.hp ? `HP ${summary.hp.current} / ${summary.hp.max}` : 'Not finished'}
                      {c.status === 'draft' ? ' · draft' : ''}
                    </CardContent>
                  </Card>
                </Link>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}
