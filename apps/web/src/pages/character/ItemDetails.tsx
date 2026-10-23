import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { InventoryItem, ItemView } from '@scriptorium/rules-engine'
import { uidLabel } from '@/lib/characters'
import { describeEffect } from '@/lib/effect-text'
import { errorMessage, trpc } from '@/lib/trpc'

type ItemData = {
  description?: string
  category?: string
  rarity?: string
  requiresAttunement?: boolean
  attunementPrerequisite?: string
  weight?: number
  weapon?: {
    category: string
    range: string
    damage?: { dice: string; damageType: string }
    versatileDamage?: string
    properties?: string[]
  }
  armor?: { category: string; baseAc: number; addDexModifier: boolean; maxDexBonus?: number }
  charges?: { max: unknown; recharge: { time: string } }
  basedOn?: { uid: string; name?: string; source?: string; versionNo?: number }
}

/**
 * Read-only item details on the sheet (issue #11): what the item is, what it does in plain
 * sentences, where it comes from. Content items are fetched when the disclosure opens (the
 * character pins a version, but the details shown are the entry's current head text, which is
 * enough to read; the mechanics on the sheet come from the pinned version).
 */
export function ItemDetails({ item, view }: { item: InventoryItem; view: ItemView | undefined }) {
  const [open, setOpen] = useState(false)
  const entry = useQuery({
    ...trpc.content.entries.get.queryOptions({ uid: item.itemUid ?? '' }),
    enabled: open && Boolean(item.itemUid),
  })
  const custom = item.customItem as
    | { name: string; data?: ItemData; effects?: Array<Record<string, unknown> & { type: string }> }
    | undefined
  const data = (entry.data?.version.data as ItemData | undefined) ?? custom?.data
  const effects =
    (entry.data?.version.effects as
      Array<Record<string, unknown> & { type: string }> | undefined) ??
    custom?.effects ??
    []
  return (
    <details
      className="w-full text-sm"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
      data-testid={`item-details-${item.id}`}
    >
      <summary className="cursor-pointer text-xs text-muted-foreground">Details</summary>
      <div className="mt-2 grid min-w-0 gap-2 rounded-md border p-3 break-words">
        {entry.isPending && open && item.itemUid ? (
          <p className="text-muted-foreground">Loading…</p>
        ) : null}
        {entry.isError ? <p className="text-destructive">{errorMessage(entry.error)}</p> : null}
        {data?.description ? <p className="whitespace-pre-line">{data.description}</p> : null}
        <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1">
          {data?.category ? (
            <>
              <dt className="text-muted-foreground">Type</dt>
              <dd>
                {uidLabel(data.category)}
                {data.rarity ? ` · ${uidLabel(data.rarity)}` : ''}
                {data.requiresAttunement
                  ? ` · requires attunement${data.attunementPrerequisite ? ` (${data.attunementPrerequisite})` : ''}`
                  : ''}
              </dd>
            </>
          ) : null}
          {data?.weapon ? (
            <>
              <dt className="text-muted-foreground">Weapon</dt>
              <dd>
                {data.weapon.category} {data.weapon.range}
                {data.weapon.damage
                  ? `, ${data.weapon.damage.dice} ${data.weapon.damage.damageType}`
                  : ''}
                {data.weapon.versatileDamage ? ` (${data.weapon.versatileDamage} versatile)` : ''}
                {data.weapon.properties?.length ? ` · ${data.weapon.properties.join(', ')}` : ''}
              </dd>
            </>
          ) : null}
          {data?.armor ? (
            <>
              <dt className="text-muted-foreground">Armor</dt>
              <dd>
                {data.armor.category}, AC {data.armor.baseAc}
                {data.armor.addDexModifier
                  ? ` + Dex${data.armor.maxDexBonus !== undefined ? ` (max ${data.armor.maxDexBonus})` : ''}`
                  : ''}
              </dd>
            </>
          ) : null}
          {view?.charges ? (
            <>
              <dt className="text-muted-foreground">Charges</dt>
              <dd>
                {view.charges.current}
                {view.charges.max !== null ? ` of ${view.charges.max}` : ''}
                {data?.charges ? `, recharges at ${uidLabel(data.charges.recharge.time)}` : ''}
              </dd>
            </>
          ) : null}
          {effects.length > 0 ? (
            <>
              <dt className="text-muted-foreground">Effects</dt>
              <dd>
                <ul className="grid gap-0.5" data-testid={`item-effects-${item.id}`}>
                  {effects.map((effect, i) => (
                    <li key={i}>{describeEffect(effect)}</li>
                  ))}
                </ul>
              </dd>
            </>
          ) : null}
          {view && !view.active && view.inactiveReason ? (
            <>
              <dt className="text-muted-foreground">Right now</dt>
              <dd>effects inactive · {view.inactiveReason}</dd>
            </>
          ) : null}
          {data?.basedOn ? (
            <>
              <dt className="text-muted-foreground">Based on</dt>
              <dd data-testid={`item-based-on-${item.id}`}>
                {data.basedOn.name ?? uidLabel(data.basedOn.uid)}
                {data.basedOn.source ? ` (${data.basedOn.source}` : ''}
                {data.basedOn.versionNo !== undefined
                  ? `${data.basedOn.source ? ', ' : ' ('}version ${data.basedOn.versionNo}`
                  : ''}
                {data.basedOn.source || data.basedOn.versionNo !== undefined ? ')' : ''}
                <span className="text-muted-foreground"> · copied once, not linked</span>
              </dd>
            </>
          ) : null}
          {entry.data ? (
            <>
              <dt className="text-muted-foreground">Source</dt>
              <dd>
                {entry.data.source.name}
                {entry.data.source.license ? ` · ${entry.data.source.license}` : ''} · version{' '}
                {entry.data.version.versionNo}
              </dd>
            </>
          ) : custom ? (
            <>
              <dt className="text-muted-foreground">Source</dt>
              <dd>Custom item on this sheet</dd>
            </>
          ) : null}
        </dl>
      </div>
    </details>
  )
}
