import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useDeferredValue, useState } from 'react'
import { DAMAGE_TYPES, WEAPON_PROPERTIES, type Effect } from '@scriptorium/content-schema'
import { FormError, FormField } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { selectClass } from '../character/shared'
import { EffectBuilder } from './EffectBuilder'
import { ItemPreview } from './ItemPreview'
import {
  EMPTY_FORM,
  RECHARGE_TIMES,
  draftToForm,
  formToDraft,
  type ItemData,
  type ItemForm,
} from './effects'

type LoadedItem = Awaited<ReturnType<typeof trpcClient.homebrew.items.get.query>>
type SourceRow = Awaited<ReturnType<typeof trpcClient.homebrew.sources.list.query>>[number]

const CATEGORIES: ItemData['category'][] = [
  'weapon',
  'armor',
  'shield',
  'wondrous',
  'ring',
  'rod',
  'staff',
  'wand',
  'potion',
  'scroll',
  'other',
]
const RARITIES = ['common', 'uncommon', 'rare', 'very-rare', 'legendary', 'artifact'] as const

/**
 * The magic item editor (M2.7). The form is turned into a content entry, validated on the server
 * as the author types, saved as a draft, previewed on a character and published as an immutable
 * version. Characters pin the version they were given.
 */
export function ItemEditorPage() {
  const { entryId } = useParams({ strict: false }) as { entryId: string }
  const isNew = entryId === 'new'
  const sources = useQuery(trpc.homebrew.sources.list.queryOptions())
  const item = useQuery({ ...trpc.homebrew.items.get.queryOptions({ entryId }), enabled: !isNew })

  if (sources.isPending || (!isNew && item.isPending)) return <LoadingState rows={6} />
  if (!isNew && (item.isError || !item.data))
    return (
      <ErrorState
        title="Item unavailable"
        message={item.error ? errorMessage(item.error) : 'Not found.'}
      />
    )
  const version = item.data ? (item.data.draft ?? item.data.head) : null
  const initialForm =
    item.data && version
      ? draftToForm(item.data.name, version.data as ItemData, version.effects as Effect[])
      : EMPTY_FORM
  // The key resets the form when the route moves from "new" to the created item.
  return (
    <ItemEditor
      key={entryId}
      entryId={entryId}
      item={item.data ?? null}
      sources={sources.data ?? []}
      initialForm={initialForm}
    />
  )
}

function ItemEditor({
  entryId,
  item,
  sources,
  initialForm,
}: {
  entryId: string
  item: LoadedItem | null
  sources: SourceRow[]
  initialForm: ItemForm
}) {
  const isNew = entryId === 'new'
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ItemForm>(initialForm)
  const [sourceId, setSourceId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const draft = formToDraft(form)
  const deferredDraft = useDeferredValue(draft)
  const validation = useQuery(trpc.homebrew.items.validate.queryOptions(deferredDraft))

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.homebrew.items.get.queryKey({ entryId }) }),
      queryClient.invalidateQueries({ queryKey: trpc.homebrew.items.list.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.homebrew.items.preview.queryKey() }),
      queryClient.invalidateQueries({ queryKey: trpc.content.pathKey() }),
    ])

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        const source = sourceId || sources[0]?.id
        if (!source) throw new Error('Create a source first.')
        return trpcClient.homebrew.items.create.mutate({ sourceId: source, draft })
      }
      await trpcClient.homebrew.items.save.mutate({ entryId, draft })
      return null
    },
    onSuccess: async (created) => {
      setError(null)
      if (created) {
        await queryClient.invalidateQueries({ queryKey: trpc.homebrew.items.list.queryKey() })
        await navigate({ to: '/homebrew/items/$entryId', params: { entryId: created.entryId } })
      } else await invalidate()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const publish = useMutation({
    mutationFn: () => trpcClient.homebrew.items.publish.mutate({ entryId }),
    onSuccess: async () => {
      setError(null)
      await invalidate()
    },
    onError: (e) => setError(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: () => trpcClient.homebrew.items.delete.mutate({ entryId }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: trpc.homebrew.items.list.queryKey() })
      await navigate({ to: '/homebrew' })
    },
    onError: (e) => setError(errorMessage(e)),
  })

  const set = (patch: Partial<ItemForm>) => setForm({ ...form, ...patch })
  const valid = validation.data?.ok === true
  const statusText = !item
    ? 'New item, not saved yet'
    : item.status === 'published'
      ? `Published v${item.head?.versionNo}${item.draft ? `, draft v${item.draft.versionNo} unpublished` : ''}`
      : `Draft v${item.draft?.versionNo ?? 1}, never published`

  return (
    <div className="grid gap-6">
      <PageHeader
        title={form.name || 'New magic item'}
        description={`${statusText}${item ? ` · ${item.uid}` : ''}`}
        actions={
          <>
            <Button variant="ghost" asChild>
              <Link to="/homebrew">All items</Link>
            </Button>
            <Button
              variant="outline"
              disabled={!valid || save.isPending}
              onClick={() => save.mutate()}
              data-testid="item-save"
            >
              {isNew ? 'Save draft' : 'Save changes'}
            </Button>
            {!isNew ? (
              <Button
                disabled={!item?.draft || publish.isPending || !valid}
                onClick={() => publish.mutate()}
                data-testid="item-publish"
              >
                Publish
              </Button>
            ) : null}
          </>
        }
      />
      <FormError message={error} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="grid min-w-0 gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Item</CardTitle>
              <CardDescription>
                Name, rarity and the physical form. Weapons get a base damage line that the engine
                turns into an attack action.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {isNew && sources.length > 1 ? (
                <FormField id="item-source" label="Source">
                  <select
                    id="item-source"
                    className={selectClass}
                    value={sourceId || sources[0]!.id}
                    onChange={(e) => setSourceId(e.target.value)}
                  >
                    {sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : null}
              {isNew && sources.length === 0 ? (
                <p className="text-sm text-destructive">
                  You have no source yet. <Link to="/homebrew">Create one</Link> before saving.
                </p>
              ) : null}
              <FormField id="item-name" label="Name">
                <Input
                  id="item-name"
                  value={form.name}
                  onChange={(e) => set({ name: e.target.value })}
                  data-testid="item-name"
                />
              </FormField>
              <FormField id="item-description" label="Description">
                <Textarea
                  id="item-description"
                  value={form.description}
                  onChange={(e) => set({ description: e.target.value })}
                  rows={3}
                  data-testid="item-description"
                />
              </FormField>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField id="item-category" label="Category">
                  <select
                    id="item-category"
                    className={selectClass}
                    value={form.category}
                    onChange={(e) => set({ category: e.target.value as ItemData['category'] })}
                    data-testid="item-category"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </FormField>
                <FormField id="item-rarity" label="Rarity">
                  <select
                    id="item-rarity"
                    className={selectClass}
                    value={form.rarity}
                    onChange={(e) => set({ rarity: e.target.value as ItemForm['rarity'] })}
                  >
                    <option value="">unspecified</option>
                    {RARITIES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </FormField>
                <label className="flex items-center gap-2 self-end pb-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.requiresAttunement}
                    onChange={(e) => set({ requiresAttunement: e.target.checked })}
                    data-testid="item-attunement"
                  />
                  Requires attunement
                </label>
              </div>
              {form.category === 'weapon' ? <WeaponFields form={form} set={set} /> : null}
              {form.category === 'armor' || form.category === 'shield' ? (
                <ArmorFields form={form} set={set} />
              ) : null}
              <div className="grid gap-2 border-t pt-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.charges.enabled}
                    onChange={(e) =>
                      set({ charges: { ...form.charges, enabled: e.target.checked } })
                    }
                    data-testid="item-charges"
                  />
                  Has charges
                </label>
                {form.charges.enabled ? (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <FormField id="charges-max" label="Charges">
                      <Input
                        id="charges-max"
                        type="number"
                        min={1}
                        value={form.charges.max}
                        onChange={(e) => set({ charges: { ...form.charges, max: e.target.value } })}
                        data-testid="charges-max"
                      />
                    </FormField>
                    <FormField id="charges-time" label="Recharge">
                      <select
                        id="charges-time"
                        className={selectClass}
                        value={form.charges.time}
                        onChange={(e) =>
                          set({
                            charges: {
                              ...form.charges,
                              time: e.target.value as ItemForm['charges']['time'],
                            },
                          })
                        }
                      >
                        {RECHARGE_TIMES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </FormField>
                    <FormField
                      id="charges-formula"
                      label="Regains"
                      hint="Dice or a number; empty means all charges."
                    >
                      <Input
                        id="charges-formula"
                        value={form.charges.formula}
                        onChange={(e) =>
                          set({ charges: { ...form.charges, formula: e.target.value } })
                        }
                        placeholder="1d4 + 1"
                      />
                    </FormField>
                  </div>
                ) : null}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Effects</CardTitle>
              <CardDescription>
                Static bonuses apply while equipped (and attuned, if required). Extra damage is
                resolved per attack, so it can depend on the target.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EffectBuilder rows={form.rows} onChange={(rows) => set({ rows })} />
            </CardContent>
          </Card>
        </div>
        <div className="grid min-w-0 gap-6 self-start">
          <Card data-testid="validation">
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Validation
                {validation.data ? (
                  <Badge
                    variant={valid ? 'default' : 'destructive'}
                    data-testid="validation-status"
                  >
                    {valid ? 'valid' : `${validation.data.issues.length} issue(s)`}
                  </Badge>
                ) : null}
                {validation.data?.automation ? (
                  <Badge variant="outline" data-testid="automation-level">
                    automation: {validation.data.automation.level}
                  </Badge>
                ) : null}
              </CardTitle>
              <CardDescription>
                Checked against the content schema on every change; the automation level is inferred
                from the effects.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {validation.data && !valid ? (
                <ul className="grid gap-1 text-sm">
                  {validation.data.issues.map((i, n) => (
                    <li key={n}>
                      <code className="text-xs">{i.path || 'item'}</code>: {i.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {validation.data?.automation?.level === 'partial'
                    ? `Manual parts: ${validation.data.automation.manualParts?.join('; ')}`
                    : 'No issues.'}
                </p>
              )}
            </CardContent>
          </Card>
          {item ? (
            <ItemPreview
              entryId={entryId}
              uid={item.uid}
              published={item.status === 'published'}
              onError={setError}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                Save the draft to preview it on one of your characters.
              </CardContent>
            </Card>
          )}
          {item && !item.headVersionId ? (
            <Button
              variant="ghost"
              className="justify-self-start"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
              data-testid="item-delete"
            >
              Delete this draft
            </Button>
          ) : null}
          {item?.headVersionId && item.draft ? (
            <p className="text-xs text-muted-foreground">
              Characters keep the version they were given; publishing a new version never changes
              their sheets.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function ArmorFields({ form, set }: { form: ItemForm; set: (patch: Partial<ItemForm>) => void }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <FormField id="armor-category" label="Armor type">
        <select
          id="armor-category"
          className={selectClass}
          value={form.armor.category}
          onChange={(e) =>
            set({
              armor: { ...form.armor, category: e.target.value as ItemForm['armor']['category'] },
            })
          }
        >
          {['light', 'medium', 'heavy', 'shield'].map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </FormField>
      <FormField id="armor-ac" label="Base AC">
        <Input
          id="armor-ac"
          type="number"
          value={form.armor.baseAc}
          onChange={(e) => set({ armor: { ...form.armor, baseAc: e.target.value } })}
        />
      </FormField>
      <label className="flex items-center gap-2 self-end pb-2 text-sm">
        <input
          type="checkbox"
          checked={form.armor.addDex}
          onChange={(e) => set({ armor: { ...form.armor, addDex: e.target.checked } })}
        />
        Add Dexterity
      </label>
      <FormField id="armor-maxdex" label="Max Dex bonus">
        <Input
          id="armor-maxdex"
          type="number"
          value={form.armor.maxDex}
          onChange={(e) => set({ armor: { ...form.armor, maxDex: e.target.value } })}
          placeholder="none"
        />
      </FormField>
    </div>
  )
}

function WeaponFields({ form, set }: { form: ItemForm; set: (patch: Partial<ItemForm>) => void }) {
  const [baseQuery, setBaseQuery] = useState('')
  const bases = useQuery({
    ...trpc.content.entries.list.queryOptions({
      kind: 'item',
      q: baseQuery,
      sourceSlugs: ['srd-5.1'],
      tags: ['weapon'],
      limit: 10,
    }),
    enabled: baseQuery.length >= 2,
  })
  const copyBase = useMutation({
    mutationFn: (uid: string) => trpcClient.content.entries.get.query({ uid }),
    onSuccess: (entry) => {
      const data = entry.version.data as ItemData
      if (!data.weapon) return
      set({
        weapon: {
          category: data.weapon.category,
          range: data.weapon.range,
          dice: data.weapon.damage?.dice ?? form.weapon.dice,
          damageType: data.weapon.damage?.damageType ?? form.weapon.damageType,
          versatile: data.weapon.versatileDamage ?? '',
          properties: [...new Set([...(data.weapon.properties ?? []), 'magical'])],
        },
      })
      setBaseQuery('')
    },
  })
  const w = form.weapon
  const setW = (patch: Partial<ItemForm['weapon']>) => set({ weapon: { ...w, ...patch } })
  return (
    <div className="grid gap-3 border-t pt-3">
      <div className="grid gap-1">
        <label htmlFor="base-weapon" className="text-sm font-medium">
          Start from an SRD weapon
        </label>
        <Input
          id="base-weapon"
          value={baseQuery}
          onChange={(e) => setBaseQuery(e.target.value)}
          placeholder="Search, e.g. longsword"
          data-testid="base-weapon-search"
        />
        {bases.data && baseQuery.length >= 2 ? (
          <ul className="flex flex-wrap gap-1">
            {bases.data.items
              .filter((i) => !i.item?.magic)
              .map((i) => (
                <li key={i.uid}>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => copyBase.mutate(i.uid)}
                    data-testid={`base-${i.uid}`}
                  >
                    {i.name}
                  </Button>
                </li>
              ))}
          </ul>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <FormField id="weapon-category" label="Weapon class">
          <select
            id="weapon-category"
            className={selectClass}
            value={w.category}
            onChange={(e) => setW({ category: e.target.value as 'simple' | 'martial' })}
          >
            <option value="simple">simple</option>
            <option value="martial">martial</option>
          </select>
        </FormField>
        <FormField id="weapon-range" label="Range">
          <select
            id="weapon-range"
            className={selectClass}
            value={w.range}
            onChange={(e) => setW({ range: e.target.value as 'melee' | 'ranged' })}
          >
            <option value="melee">melee</option>
            <option value="ranged">ranged</option>
          </select>
        </FormField>
        <FormField id="weapon-dice" label="Damage dice">
          <Input
            id="weapon-dice"
            value={w.dice}
            onChange={(e) => setW({ dice: e.target.value })}
            data-testid="weapon-dice"
          />
        </FormField>
        <FormField id="weapon-type" label="Damage type">
          <select
            id="weapon-type"
            className={selectClass}
            value={w.damageType}
            onChange={(e) => setW({ damageType: e.target.value })}
          >
            {DAMAGE_TYPES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <div className="grid gap-3 sm:grid-cols-[8rem_minmax(0,1fr)]">
        <FormField id="weapon-versatile" label="Versatile dice">
          <Input
            id="weapon-versatile"
            value={w.versatile}
            onChange={(e) => setW({ versatile: e.target.value })}
            placeholder="1d10"
          />
        </FormField>
        <fieldset className="grid gap-1">
          <legend className="text-sm font-medium">Properties</legend>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {WEAPON_PROPERTIES.map((prop) => (
              <label key={prop} className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={w.properties.includes(prop)}
                  onChange={(e) =>
                    setW({
                      properties: e.target.checked
                        ? [...w.properties, prop]
                        : w.properties.filter((p) => p !== prop),
                    })
                  }
                />
                {prop}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
    </div>
  )
}
