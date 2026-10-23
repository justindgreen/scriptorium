import type { ComputedSheet } from '@scriptorium/rules-engine'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { uidLabel } from '@/lib/characters'

/** Armor, weapon and tool proficiencies and known languages, straight from the computed sheet. */
export function Proficiencies({ sheet }: { sheet: ComputedSheet }) {
  const groups: Array<
    [string, string, ComputedSheet['proficiencies'][keyof ComputedSheet['proficiencies']]]
  > = [
    ['armor', 'Armor', sheet.proficiencies.armor],
    ['weapons', 'Weapons', sheet.proficiencies.weapons],
    ['tools', 'Tools', sheet.proficiencies.tools],
    ['languages', 'Languages', sheet.proficiencies.languages],
  ]
  return (
    <Card data-testid="proficiencies">
      <CardHeader>
        <CardTitle>Proficiencies and languages</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid gap-2 text-sm">
          {groups.map(([id, label, entries]) => (
            <div key={id} className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
              <dt className="text-muted-foreground">{label}</dt>
              <dd data-testid={`proficiencies-${id}`}>
                {entries.length > 0 ? entries.map((e) => uidLabel(e.id)).join(', ') : '—'}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}
