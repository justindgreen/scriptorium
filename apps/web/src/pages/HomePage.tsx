import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { KeyRoundIcon, ScrollIcon } from 'lucide-react'
import { EmptyState, PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { trpc } from '@/lib/trpc'

/** Signed-in landing page. Characters and campaigns take over this page with their milestones. */
export function HomePage() {
  const me = useQuery(trpc.me.get.queryOptions())
  const status = useQuery(trpc.system.status.queryOptions())
  if (!me.data) return null
  const isAdmin = me.data.role === 'admin'

  return (
    <div>
      <PageHeader
        title={`Welcome, ${me.data.displayName}`}
        description={`Signed in as @${me.data.username ?? me.data.displayName}.`}
      />
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <EmptyState
          icon={ScrollIcon}
          title="No characters yet"
          description={
            isAdmin
              ? 'The character builder arrives with the rules engine. Until then, bring your players in with an invite.'
              : 'The character builder arrives with the rules engine. Your Dungeon Master will let you know when it is ready.'
          }
          action={
            isAdmin ? (
              <Button asChild>
                <Link to="/admin/invites">
                  <KeyRoundIcon aria-hidden="true" /> Invite players
                </Link>
              </Button>
            ) : undefined
          }
        />
        <Card>
          <CardHeader>
            <CardTitle>This instance</CardTitle>
            <CardDescription>Details about the server you are signed in to.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Name</dt>
              <dd data-testid="instance-name">{status.data?.instanceName}</dd>
              <dt className="text-muted-foreground">Your role</dt>
              <dd data-testid="my-role">{isAdmin ? 'Administrator' : 'Player'}</dd>
              <dt className="text-muted-foreground">Version</dt>
              <dd className="tabular">{status.data?.version}</dd>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
