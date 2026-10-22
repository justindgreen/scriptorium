import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useMemo, useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ABILITY_NAMES, POINT_BUY_COST, STANDARD_ARRAY, type AbilityKey } from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

type Method = 'standard' | 'point_buy' | 'manual' | 'rolled'
const ABILITIES = Object.keys(ABILITY_NAMES) as AbilityKey[]
const DEFAULTS: Record<AbilityKey, number> = { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }

/**
 * Character builder: name, species, background, class and ability scores. The character is
 * created with a revision of 0; skills, fighting styles, spells and equipment are chosen on the
 * character page from the pending choices the engine reports.
 */
export function CharacterBuilderPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const species = useQuery(trpc.content.entries.list.queryOptions({ kind: 'species', limit: 200 }))
  const backgrounds = useQuery(
    trpc.content.entries.list.queryOptions({ kind: 'background', limit: 200 }),
  )
  const classes = useQuery(trpc.content.entries.list.queryOptions({ kind: 'class', limit: 200 }))

  const [name, setName] = useState('')
  const [speciesUid, setSpeciesUid] = useState('')
  const [backgroundUid, setBackgroundUid] = useState('')
  const [classUid, setClassUid] = useState('')
  const [method, setMethod] = useState<Method>('standard')
  const [abilities, setAbilities] = useState<Record<AbilityKey, number>>(DEFAULTS)
  const [hpMode, setHpMode] = useState<'fixed' | 'rolled' | 'manual'>('fixed')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      trpcClient.characters.create.mutate({
        name,
        abilityMethod: method,
        baseAbilities: abilities,
        hpMode,
        ...(speciesUid ? { speciesUid } : {}),
        ...(backgroundUid ? { backgroundUid } : {}),
        ...(classUid ? { classUid } : {}),
      }),
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() })
      await navigate({ to: '/characters/$characterId', params: { characterId: created.id } })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const pointsSpent = useMemo(
    () => ABILITIES.reduce((n, a) => n + (POINT_BUY_COST[abilities[a]] ?? 99), 0),
    [abilities],
  )
  const standardOk = useMemo(
    () =>
      JSON.stringify([...ABILITIES.map((a) => abilities[a])].sort((x, y) => y - x)) ===
      JSON.stringify([...STANDARD_ARRAY].sort((x, y) => y - x)),
    [abilities],
  )

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (name.trim().length === 0) return setError('Give the character a name.')
    if (method === 'standard' && !standardOk)
      return setError('Use each value of the standard array (15, 14, 13, 12, 10, 8) exactly once.')
    if (method === 'point_buy' && pointsSpent > 27)
      return setError(`Point buy spends ${pointsSpent} of 27 points.`)
    create.mutate()
  }

  const selectClass =
    'h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50'

  return (
    <div>
      <PageHeader
        title="New character"
        description="Pick the basics; the engine tells you what still needs choosing afterwards."
      />
      <form onSubmit={onSubmit} className="grid gap-6 lg:grid-cols-[2fr_1fr]" noValidate>
        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Basics</CardTitle>
              <CardDescription>Name, species, background and first class.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <FormField id="name" label="Name">
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  maxLength={80}
                  data-testid="builder-name"
                />
              </FormField>
              <FormField id="class" label="Class">
                <select
                  id="class"
                  className={selectClass}
                  value={classUid}
                  onChange={(e) => setClassUid(e.target.value)}
                  data-testid="builder-class"
                >
                  <option value="">Choose later</option>
                  {classes.data?.items.map((c) => (
                    <option key={c.uid} value={c.uid}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="species" label="Species">
                <select
                  id="species"
                  className={selectClass}
                  value={speciesUid}
                  onChange={(e) => setSpeciesUid(e.target.value)}
                  data-testid="builder-species"
                >
                  <option value="">Choose later</option>
                  {species.data?.items.map((s) => (
                    <option key={s.uid} value={s.uid}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField id="background" label="Background">
                <select
                  id="background"
                  className={selectClass}
                  value={backgroundUid}
                  onChange={(e) => setBackgroundUid(e.target.value)}
                  data-testid="builder-background"
                >
                  <option value="">Choose later</option>
                  {backgrounds.data?.items.map((b) => (
                    <option key={b.uid} value={b.uid}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </FormField>
              <FormField
                id="hpMode"
                label="Hit points"
                hint="Fixed takes the average at each level; rolled asks for a roll when you level up."
              >
                <select
                  id="hpMode"
                  className={selectClass}
                  value={hpMode}
                  onChange={(e) => setHpMode(e.target.value as typeof hpMode)}
                  aria-describedby="hpMode-hint"
                >
                  <option value="fixed">Fixed (average)</option>
                  <option value="rolled">Rolled</option>
                  <option value="manual">Manual</option>
                </select>
              </FormField>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Ability scores</CardTitle>
              <CardDescription>
                {method === 'standard'
                  ? 'Assign 15, 14, 13, 12, 10 and 8 once each.'
                  : method === 'point_buy'
                    ? `Point buy: ${pointsSpent} of 27 points, scores 8 to 15.`
                    : 'Enter the scores before species bonuses.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField id="method" label="Method">
                <select
                  id="method"
                  className={selectClass}
                  value={method}
                  onChange={(e) => setMethod(e.target.value as Method)}
                  data-testid="builder-method"
                >
                  <option value="standard">Standard array</option>
                  <option value="point_buy">Point buy</option>
                  <option value="manual">Manual</option>
                  <option value="rolled">Rolled</option>
                </select>
              </FormField>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {ABILITIES.map((a) => (
                  <FormField key={a} id={`ability-${a}`} label={ABILITY_NAMES[a]}>
                    <Input
                      id={`ability-${a}`}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={30}
                      value={abilities[a]}
                      onChange={(e) => setAbilities({ ...abilities, [a]: Number(e.target.value) })}
                      data-testid={`ability-${a}`}
                    />
                  </FormField>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
        <Card className="self-start">
          <CardHeader>
            <CardTitle>Create</CardTitle>
            <CardDescription>
              You can change everything later; every change is logged.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <FormError message={error} />
            <Button type="submit" disabled={create.isPending} data-testid="builder-create">
              {create.isPending ? 'Creating…' : 'Create character'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
