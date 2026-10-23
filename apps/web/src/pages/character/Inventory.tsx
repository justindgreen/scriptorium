import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { uidLabel, type CharacterView } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { ItemDetails } from './ItemDetails'
import type { SendFn } from './shared'

export function Inventory({ view, send }: { view: CharacterView; send: SendFn }) {
  const [query, setQuery] = useState('')
  const items = useQuery({
    ...trpc.content.entries.list.queryOptions({ kind: 'item', q: query || undefined, limit: 20 }),
    enabled: query.length >= 2,
  })
  const views = new Map(view.sheet.items.map((item) => [item.itemId, item]))
  return (
    <Card data-testid="inventory">
      <CardHeader>
        <CardTitle>Inventory</CardTitle>
        <CardDescription>
          Equipped items feed the sheet; attunement is limited to three.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {view.aggregate.inventory.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing carried yet.</p>
        ) : null}
        <ul className="grid gap-2">
          {view.aggregate.inventory.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2 text-sm"
            >
              <span>
                {views.get(i.id)?.name ?? i.customItem?.name ?? uidLabel(i.itemUid)}
                {i.quantity > 1 ? ` ×${i.quantity}` : ''}{' '}
                {i.equipped ? <Badge variant="secondary">equipped</Badge> : null}{' '}
                {i.attuned ? <Badge>attuned</Badge> : null}
                {views.get(i.id)?.charges ? (
                  <span className="text-muted-foreground" data-testid={`charges-${i.id}`}>
                    {' '}
                    {views.get(i.id)!.charges!.current}
                    {views.get(i.id)!.charges!.max !== null
                      ? `/${views.get(i.id)!.charges!.max}`
                      : ''}{' '}
                    charges
                  </span>
                ) : null}
                {views.get(i.id)?.inactiveReason && i.equipped ? (
                  <Badge variant="outline" data-testid={`inactive-${i.id}`}>
                    effects inactive · {views.get(i.id)!.inactiveReason}
                  </Badge>
                ) : null}
              </span>
              <span className="flex gap-1 print:hidden">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    void send({ type: i.equipped ? 'unequip' : 'equip', itemId: i.id })
                  }
                  data-testid={`equip-${i.id}`}
                >
                  {i.equipped ? 'Unequip' : 'Equip'}
                </Button>
                {views.get(i.id)?.requiresAttunement || i.attuned ? (
                  <Button
                    size="sm"
                    variant={i.attuned || !i.equipped ? 'outline' : 'default'}
                    onClick={() =>
                      void send({ type: i.attuned ? 'unattune' : 'attune', itemId: i.id })
                    }
                    data-testid={`attune-${i.id}`}
                  >
                    {i.attuned ? 'Unattune' : 'Attune'}
                  </Button>
                ) : null}
                {i.chargesCurrent !== undefined ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={i.chargesCurrent <= 0}
                    onClick={() => void send({ type: 'spendCharges', itemId: i.id })}
                    data-testid={`spend-charge-${i.id}`}
                  >
                    Use charge
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void send({ type: 'removeItem', itemId: i.id })}
                >
                  Remove
                </Button>
              </span>
              <div className="basis-full">
                <ItemDetails item={i} view={views.get(i.id)} />
              </div>
            </li>
          ))}
        </ul>
        <Input
          placeholder="Add an item: search by name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search items"
          data-testid="item-search"
        />
        {items.data && query.length >= 2 ? (
          <ul className="grid max-h-48 gap-1 overflow-auto sm:grid-cols-2">
            {items.data.items.map((e) => (
              <li key={e.uid}>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-auto w-full justify-start py-1 text-left"
                  onClick={() =>
                    void send({
                      type: 'addItem',
                      itemUid: e.uid,
                      equipped: true,
                      itemId: `${e.uid.split(':').pop()}-${Date.now().toString(36)}`,
                    })
                  }
                  data-testid={`add-${e.uid}`}
                >
                  {e.name}
                  {e.item?.magic ? ' ✦' : ''}
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
