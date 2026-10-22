import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { MapIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

/** M2.8: the campaigns a user runs or plays in, and a way to start one. */
export function CampaignsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const campaigns = useQuery(trpc.campaigns.list.queryOptions())
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: (campaignName: string) =>
      trpcClient.campaigns.create.mutate({ name: campaignName }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: trpc.campaigns.list.queryKey() })
      await navigate({ to: '/campaigns/$campaignId', params: { campaignId: created.id } })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (name.trim()) create.mutate(name.trim())
  }
  return (
    <div className="grid gap-6">
      <PageHeader
        title="Campaigns"
        description="A DM runs a campaign; players join with an invite code and submit characters for approval."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="grid min-w-0 gap-6">
          {campaigns.isPending ? <LoadingState rows={3} /> : null}
          {campaigns.isError ? (
            <ErrorState title="Could not load campaigns" message={errorMessage(campaigns.error)} />
          ) : null}
          {campaigns.data && campaigns.data.length === 0 ? (
            <EmptyState
              icon={MapIcon}
              title="No campaigns yet"
              description="Create one to run, or join one with the invite link your DM sent."
            />
          ) : null}
          {campaigns.data && campaigns.data.length > 0 ? (
            <ul className="grid gap-3 sm:grid-cols-2" data-testid="campaign-list">
              {campaigns.data.map((c) => (
                <li key={c.id}>
                  <Link
                    to="/campaigns/$campaignId"
                    params={{ campaignId: c.id }}
                    className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Card className="h-full transition-colors hover:bg-accent/40">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                          {c.name}
                          <Badge variant={c.role === 'dm' ? 'default' : 'secondary'}>
                            {c.role === 'dm' ? 'DM' : 'player'}
                          </Badge>
                        </CardTitle>
                        <CardDescription>{c.descriptionMd || 'No description.'}</CardDescription>
                      </CardHeader>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Run a campaign</CardTitle>
            <CardDescription>
              You become its DM; invite players from the campaign page.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-2" onSubmit={onSubmit}>
              <FormField id="campaign-name" label="Name">
                <Input
                  id="campaign-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  data-testid="campaign-name"
                />
              </FormField>
              <FormError message={error} />
              <div>
                <Button
                  type="submit"
                  disabled={!name.trim() || create.isPending}
                  data-testid="campaign-create"
                >
                  Create campaign
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
