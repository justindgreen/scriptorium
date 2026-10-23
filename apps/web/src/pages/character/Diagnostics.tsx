import type { ComputedSheet } from '@scriptorium/rules-engine'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

export function Diagnostics({ sheet }: { sheet: ComputedSheet }) {
  const shown = sheet.diagnostics.filter((d) => d.severity !== 'info')
  const notAutomated = sheet.features.filter(
    (f) => f.automation === 'manual' || f.automation === 'partial',
  )
  if (shown.length === 0 && notAutomated.length === 0) return null
  return (
    <Card data-testid="diagnostics">
      <CardHeader>
        <CardTitle>Diagnostics</CardTitle>
        <CardDescription>
          {shown.length} engine message{shown.length === 1 ? '' : 's'}; {notAutomated.length}{' '}
          feature
          {notAutomated.length === 1 ? '' : 's'} with parts you track by hand.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1 text-sm break-words">
          {shown.map((d, i) => (
            <li key={`${d.code}-${i}`} className="min-w-0">
              <Badge variant={d.severity === 'error' ? 'destructive' : 'secondary'}>{d.code}</Badge>{' '}
              {d.message}
            </li>
          ))}
        </ul>
        {notAutomated.length > 0 ? (
          <ul className="mt-3 grid gap-1 border-t pt-3 text-sm" data-testid="manual-features">
            {notAutomated.map((f) => (
              <li key={f.uid}>
                <Badge variant="outline">{f.automation}</Badge> {f.name}
                {f.manualParts && f.manualParts.length > 0 ? (
                  <span className="text-muted-foreground">
                    {' '}
                    — by hand: {f.manualParts.join('; ')}
                  </span>
                ) : null}
                {f.manualText.length > 0 ? (
                  <span className="block text-xs text-muted-foreground">
                    {f.manualText.join(' ')}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  )
}
