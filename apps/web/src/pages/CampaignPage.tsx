import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { ConfirmButton } from '@/components/ConfirmButton'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { copyText } from '@/lib/uuid'
import { selectClass } from './character/shared'

type Summary = { level?: number; classes?: Array<{ name: string; level: number }> }

/** One campaign: members, invite codes, submitted characters, shared sources and encounters. */
export function CampaignPage() {
  const { campaignId } = useParams({ strict: false }) as { campaignId: string }
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const campaign = useQuery(trpc.campaigns.get.queryOptions({ campaignId }))
  const mine = useQuery(trpc.characters.list.queryOptions())
  const sources = useQuery(trpc.homebrew.sources.list.queryOptions())
  const [error, setError] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const inviteInputRef = useRef<HTMLInputElement>(null)
  const copyInvite = async () => {
    if (!inviteUrl) return
    const outcome = await copyText(inviteUrl, inviteInputRef.current)
    setCopyNote(
      outcome === 'copied'
        ? 'Link copied.'
        : outcome === 'selected'
          ? 'Clipboard unavailable on this address: the link is selected, press Ctrl+C.'
          : 'Could not copy. Select the link and copy it by hand.',
    )
  }
  const [characterId, setCharacterId] = useState('')
  const [sourceId, setSourceId] = useState('')
  const [encounterName, setEncounterName] = useState('')
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: trpc.campaigns.get.queryKey({ campaignId }) })
  const onError = (e: unknown) => setError(errorMessage(e))

  const invite = useMutation({
    mutationFn: () => trpcClient.campaigns.invites.create.mutate({ campaignId }),
    onSuccess: (created) => {
      setError(null)
      setInviteUrl(`${window.location.origin}/campaigns/join?code=${created.code}`)
    },
    onError,
  })
  const submit = useMutation({
    mutationFn: (id: string) =>
      trpcClient.campaigns.characters.submit.mutate({ campaignId, characterId: id }),
    onSuccess: () => {
      setError(null)
      setCharacterId('')
      void refresh()
    },
    onError,
  })
  const approve = useMutation({
    mutationFn: (id: string) =>
      trpcClient.campaigns.characters.approve.mutate({ campaignId, characterId: id }),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })
  const withdraw = useMutation({
    mutationFn: (id: string) =>
      trpcClient.campaigns.characters.withdraw.mutate({ campaignId, characterId: id }),
    onSuccess: () => {
      setError(null)
      void refresh()
    },
    onError,
  })
  const share = useMutation({
    mutationFn: (id: string) =>
      trpcClient.campaigns.sources.share.mutate({ campaignId, sourceId: id }),
    onSuccess: () => {
      setError(null)
      setSourceId('')
      void refresh()
    },
    onError,
  })
  const createEncounter = useMutation({
    mutationFn: (name: string) => trpcClient.encounters.create.mutate({ campaignId, name }),
    onSuccess: async (created) => {
      setError(null)
      await refresh()
      await navigate({ to: '/encounters/$encounterId', params: { encounterId: created.id } })
    },
    onError,
  })

  if (campaign.isPending) return <LoadingState rows={5} />
  if (campaign.isError || !campaign.data)
    return (
      <ErrorState
        title="Campaign unavailable"
        message={campaign.error ? errorMessage(campaign.error) : 'Not found.'}
      />
    )
  const c = campaign.data
  const dm = c.role === 'dm'
  const submitted = new Set(
    c.characters.filter((ch) => ch.status !== 'retired').map((ch) => ch.characterId),
  )
  const submittable = (mine.data ?? []).filter((ch) => !submitted.has(ch.id))
  const sharedIds = new Set(c.sources.map((s) => s.sourceId))

  return (
    <div className="grid gap-6">
      <PageHeader
        title={c.name}
        description={`${dm ? 'You run this campaign.' : 'You play in this campaign.'} ${c.members.length} member${c.members.length === 1 ? '' : 's'}.`}
        actions={
          <Badge variant={dm ? 'default' : 'secondary'} data-testid="campaign-role">
            {dm ? 'DM' : 'player'}
          </Badge>
        }
      />
      <FormError message={error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 gap-6">
          <Card data-testid="party">
            <CardHeader>
              <CardTitle>Characters</CardTitle>
              <CardDescription>
                Players submit a character; the DM approves it into the party and can then see its
                sheet and grant items.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {c.characters.length === 0 ? (
                <p className="text-muted-foreground">Nobody has submitted a character yet.</p>
              ) : null}
              <ul className="grid gap-2">
                {c.characters.map((ch) => {
                  const summary = (ch.summary ?? {}) as Summary
                  return (
                    <li
                      key={ch.characterId}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
                      data-testid={`party-${ch.characterId}`}
                    >
                      <span>
                        <span className="font-medium">{ch.name}</span>
                        <span className="text-muted-foreground">
                          {' '}
                          · {ch.ownerName}
                          {summary.level ? ` · level ${summary.level}` : ''}
                        </span>{' '}
                        <Badge variant={ch.status === 'approved' ? 'default' : 'secondary'}>
                          {ch.status}
                        </Badge>
                      </span>
                      <span className="flex gap-1">
                        {dm && ch.status === 'pending' ? (
                          <Button
                            size="sm"
                            disabled={approve.isPending}
                            onClick={() => approve.mutate(ch.characterId)}
                            data-testid={`approve-${ch.characterId}`}
                          >
                            Approve
                          </Button>
                        ) : null}
                        {dm || mine.data?.some((m) => m.id === ch.characterId) ? (
                          <Button size="sm" variant="outline" asChild>
                            <Link
                              to="/characters/$characterId"
                              params={{ characterId: ch.characterId }}
                            >
                              Sheet
                            </Link>
                          </Button>
                        ) : null}
                        {(dm || mine.data?.some((m) => m.id === ch.characterId)) &&
                        ch.status !== 'retired' ? (
                          <ConfirmButton
                            testId={`withdraw-${ch.characterId}`}
                            size="sm"
                            variant="ghost"
                            label={dm ? 'Remove from party' : 'Withdraw'}
                            title={`Take ${ch.name} off the roster?`}
                            description="The character leaves the party (the DM loses table access to it) and stays on the record as retired; it can be submitted again later. Not possible while it is in an unfinished encounter."
                            confirmLabel={dm ? 'Remove' : 'Withdraw'}
                            onConfirm={() => withdraw.mutate(ch.characterId)}
                          />
                        ) : null}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {submittable.length > 0 ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <label className="grid flex-1 gap-1">
                    Submit one of your characters
                    <select
                      className={selectClass}
                      value={characterId}
                      onChange={(e) => setCharacterId(e.target.value)}
                      data-testid="submit-character-select"
                    >
                      <option value="">Choose</option>
                      {submittable.map((ch) => (
                        <option key={ch.id} value={ch.id}>
                          {ch.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="outline"
                    disabled={!characterId || submit.isPending}
                    onClick={() => submit.mutate(characterId)}
                    data-testid="submit-character"
                  >
                    Submit
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
          <Card data-testid="encounters">
            <CardHeader>
              <CardTitle>Encounters</CardTitle>
              <CardDescription>
                Initiative, turns, attacks and hit points, tracked live.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              {c.encounters.length === 0 ? (
                <p className="text-muted-foreground">None yet.</p>
              ) : null}
              <ul className="grid gap-1">
                {c.encounters.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-2">
                    <Link
                      to="/encounters/$encounterId"
                      params={{ encounterId: e.id }}
                      className="underline underline-offset-4"
                      data-testid={`encounter-${e.id}`}
                    >
                      {e.name}
                    </Link>
                    <Badge variant="outline">
                      {e.status}
                      {e.status === 'active' ? ` · round ${e.round}` : ''}
                    </Badge>
                  </li>
                ))}
              </ul>
              {dm ? (
                <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                  <FormField id="encounter-name" label="New encounter">
                    <Input
                      id="encounter-name"
                      value={encounterName}
                      onChange={(e) => setEncounterName(e.target.value)}
                      data-testid="encounter-name"
                    />
                  </FormField>
                  <Button
                    disabled={!encounterName.trim() || createEncounter.isPending}
                    onClick={() => createEncounter.mutate(encounterName.trim())}
                    data-testid="encounter-create"
                  >
                    Create
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 gap-6 self-start">
          <Card data-testid="members">
            <CardHeader>
              <CardTitle>Members</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <ul className="grid gap-1">
                {c.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <span>{m.name}</span>
                    <Badge variant="outline">{m.role}</Badge>
                  </li>
                ))}
              </ul>
              {dm ? (
                <div className="grid gap-2 border-t pt-3">
                  <Button
                    variant="outline"
                    disabled={invite.isPending}
                    onClick={() => invite.mutate()}
                    data-testid="invite-create"
                  >
                    Create invite link
                  </Button>
                  {inviteUrl ? (
                    <div className="grid gap-1">
                      <p
                        className="break-all rounded bg-muted/40 p-2 font-mono text-xs"
                        data-testid="invite-url"
                      >
                        {inviteUrl}
                      </p>
                      <div className="flex items-center gap-2">
                        <input
                          ref={inviteInputRef}
                          readOnly
                          value={inviteUrl}
                          aria-label="Invite link"
                          className="min-w-0 flex-1 rounded-md border bg-transparent px-2 py-1 font-mono text-xs"
                          onFocus={(e) => e.currentTarget.select()}
                          data-testid="invite-url-input"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void copyInvite()}
                          data-testid="invite-copy"
                        >
                          Copy
                        </Button>
                      </div>
                      {copyNote ? (
                        <p className="text-xs text-muted-foreground" data-testid="invite-copy-note">
                          {copyNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
          {dm ? (
            <Card data-testid="shared-sources">
              <CardHeader>
                <CardTitle>Shared homebrew</CardTitle>
                <CardDescription>
                  Sources shared here are visible to every member, so their items can be given out.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3 text-sm">
                <ul className="grid gap-1">
                  {c.sources.length === 0 ? (
                    <li className="text-muted-foreground">Nothing shared.</li>
                  ) : null}
                  {c.sources.map((s) => (
                    <li key={s.sourceId} className="flex items-center justify-between gap-2">
                      <span>{s.name}</span>
                      <Badge variant="outline">{s.enabled ? 'shared' : 'disabled'}</Badge>
                    </li>
                  ))}
                </ul>
                {(sources.data ?? []).some((s) => !sharedIds.has(s.id)) ? (
                  <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                    <label className="grid min-w-0 flex-1 gap-1">
                      Share one of your sources
                      <select
                        className={selectClass}
                        value={sourceId}
                        onChange={(e) => setSourceId(e.target.value)}
                        data-testid="share-source-select"
                      >
                        <option value="">Choose</option>
                        {(sources.data ?? [])
                          .filter((s) => !sharedIds.has(s.id))
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Button
                      variant="outline"
                      disabled={!sourceId || share.isPending}
                      onClick={() => share.mutate(sourceId)}
                      data-testid="share-source"
                    >
                      Share
                    </Button>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
