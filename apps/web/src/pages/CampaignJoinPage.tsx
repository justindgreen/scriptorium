import { useMutation } from '@tanstack/react-query'
import { useNavigate, useSearch } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpcClient } from '@/lib/trpc'

/** Joins a campaign with the code from the DM's invite link. */
export function CampaignJoinPage() {
  const search = useSearch({ from: '/app/campaigns/join' })
  const navigate = useNavigate()
  const [code, setCode] = useState(search.code)
  const [error, setError] = useState<string | null>(null)
  const join = useMutation({
    mutationFn: (joinCode: string) => trpcClient.campaigns.join.mutate({ code: joinCode }),
    onSuccess: async (joined) => {
      await navigate({ to: '/campaigns/$campaignId', params: { campaignId: joined.campaignId } })
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (code.trim()) join.mutate(code.trim())
  }
  return (
    <div className="grid gap-6">
      <PageHeader title="Join a campaign" description="Paste the invite code your DM sent you." />
      <Card className="max-w-md">
        <CardHeader>
          <CardTitle>Invite code</CardTitle>
          <CardDescription>Codes expire and have a limited number of uses.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-3" onSubmit={onSubmit}>
            <FormField id="join-code" label="Code">
              <Input
                id="join-code"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                data-testid="join-code"
              />
            </FormField>
            <FormError message={error} />
            <div>
              <Button
                type="submit"
                disabled={!code.trim() || join.isPending}
                data-testid="join-campaign"
              >
                Join
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
