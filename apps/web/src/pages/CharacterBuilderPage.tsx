import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { FormError, FormField } from '@/components/FormField'
import { PageHeader } from '@/components/states'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import {
  AbilityScores,
  assign,
  defaultScores,
  POINT_BUY_BUDGET,
  pointsSpent,
  type AbilityMethod,
  type AbilityRoll,
  type Scores,
} from './builder/AbilityScores'
import { selectClass } from './character/shared'

const METHOD_HELP: Record<AbilityMethod, string> = {
  standard: 'Assign 15, 14, 13, 12, 10 and 8 once each; picking a used value swaps the two.',
  point_buy: `Start at 8 everywhere and spend ${POINT_BUY_BUDGET} points; higher scores cost more per step.`,
  manual: 'Enter the scores before species bonuses (1 to 30).',
  rolled: 'Roll on the server, then assign the six results; picking a used value swaps the two.',
}

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
  const [method, setMethod] = useState<AbilityMethod>('standard')
  const [abilities, setAbilities] = useState<Scores>(() => defaultScores('standard'))
  const [roll, setRoll] = useState<AbilityRoll | null>(null)
  const [hpMode, setHpMode] = useState<'fixed' | 'rolled' | 'manual'>('fixed')
  const [error, setError] = useState<string | null>(null)

  const create = useMutation({
    mutationFn: () =>
      trpcClient.characters.create.mutate({
        name,
        abilityMethod: method,
        baseAbilities: abilities,
        hpMode,
        ...(method === 'rolled' && roll ? { abilityRollId: roll.rollId } : {}),
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

  function changeMethod(next: AbilityMethod) {
    setMethod(next)
    setAbilities(defaultScores(next))
    setRoll(null)
    setError(null)
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (name.trim().length === 0) return setError('Give the character a name.')
    if (method === 'rolled' && !roll) return setError('Roll the ability scores first.')
    if (method === 'point_buy' && pointsSpent(abilities) > POINT_BUY_BUDGET)
      return setError(`Point buy spends ${pointsSpent(abilities)} of ${POINT_BUY_BUDGET} points.`)
    create.mutate()
  }

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
              <CardDescription data-testid="method-help">{METHOD_HELP[method]}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <FormField id="method" label="Method">
                <select
                  id="method"
                  className={selectClass}
                  value={method}
                  onChange={(e) => changeMethod(e.target.value as AbilityMethod)}
                  data-testid="builder-method"
                >
                  <option value="standard">Standard array</option>
                  <option value="point_buy">Point buy</option>
                  <option value="rolled">Rolled (4d6, drop the lowest)</option>
                  <option value="manual">Manual</option>
                </select>
              </FormField>
              <AbilityScores
                method={method}
                scores={abilities}
                roll={roll}
                onChange={setAbilities}
                onRoll={(rolled) => {
                  setRoll(rolled)
                  setAbilities(assign([...rolled.scores].sort((a, b) => b - a)))
                }}
                onError={setError}
              />
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
            <Button
              type="submit"
              disabled={create.isPending || (method === 'rolled' && !roll)}
              data-testid="builder-create"
            >
              {create.isPending ? 'Creating…' : 'Create character'}
            </Button>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
