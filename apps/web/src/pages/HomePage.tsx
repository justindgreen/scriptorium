import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PageTitle } from '../components/forms.js'
import { trpc } from '../lib/trpc.js'

/** Signed-in landing page (M1.3). Characters and campaigns arrive with their milestones. */
export function HomePage() {
  const me = useQuery(trpc.me.get.queryOptions())
  const status = useQuery(trpc.system.status.queryOptions())

  if (!me.data) return null

  return (
    <div>
      <PageTitle subtitle={`Signed in as ${me.data.username ?? me.data.displayName}.`}>
        Welcome, {me.data.displayName}
      </PageTitle>
      <dl className="grid max-w-md grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
        <dt className="opacity-70">Instance</dt>
        <dd data-testid="instance-name">{status.data?.instanceName}</dd>
        <dt className="opacity-70">Role</dt>
        <dd data-testid="my-role">{me.data.role === 'admin' ? 'Administrator' : 'Player'}</dd>
        <dt className="opacity-70">Version</dt>
        <dd>{status.data?.version}</dd>
      </dl>
      {me.data.role === 'admin' ? (
        <p className="mt-8 text-sm">
          Next:{' '}
          <Link to="/admin/invites" className="underline">
            invite your players
          </Link>
          .
        </p>
      ) : (
        <p className="mt-8 text-sm opacity-80">
          Your characters will appear here once the character builder lands.
        </p>
      )}
    </div>
  )
}
