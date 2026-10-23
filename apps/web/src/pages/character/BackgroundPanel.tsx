import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import type { ChoiceSelection } from '@scriptorium/rules-engine'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { uidLabel, type CharacterView } from '@/lib/characters'
import { trpc } from '@/lib/trpc'
import { selectClass, type SendFn } from './shared'

/** The picks a selection holds, as readable names, for the change warning. */
function selectionLabel(selection: ChoiceSelection): string {
  const list =
    'languages' in selection
      ? selection.languages
      : 'tools' in selection
        ? selection.tools
        : 'skills' in selection
          ? selection.skills
          : 'options' in selection
            ? selection.options
            : 'feats' in selection
              ? selection.feats
              : 'entries' in selection
                ? selection.entries
                : []
  return list.map((id) => uidLabel(id)).join(', ')
}

/**
 * Background completion on the sheet (issue #21): a character created without a background shows
 * "Not selected" and chooses one here through the ordinary `setBackground` command; changing or
 * removing a background warns about the selections stored under it, which the engine then drops.
 */
export function BackgroundPanel({ view, send }: { view: CharacterView; send: SendFn }) {
  const current = view.aggregate.definition.backgroundUid
  const backgrounds = useQuery(
    trpc.content.entries.list.queryOptions({ kind: 'background', limit: 200 }),
  )
  // null: untouched (the select shows the current background); '': "none".
  const [picked, setPicked] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const nameOf = (uid: string) =>
    backgrounds.data?.items.find((b) => b.uid === uid)?.name ?? uidLabel(uid)
  const feature = current
    ? view.sheet.features.find((f) => f.uid === `${current}#feature`)
    : undefined
  const stored = current
    ? Object.entries(view.aggregate.definition.choices)
        .filter(([key]) => key.startsWith(`background:${current}/`))
        .map(
          ([key, selection]) => `${uidLabel(key.split('/').pop())}: ${selectionLabel(selection)}`,
        )
    : []
  const target = picked ?? current ?? ''
  const changed = picked !== null && picked !== (current ?? '')
  const apply = () => {
    void send({ type: 'setBackground', uid: target || null })
    setPicked(null)
    setConfirming(false)
  }
  const submit = () => {
    if (current && stored.length > 0 && !confirming) {
      setConfirming(true)
      return
    }
    apply()
  }
  return (
    <Card data-testid="background">
      <CardHeader>
        <CardTitle>Background</CardTitle>
        <CardDescription data-testid="background-status">
          {current ? nameOf(current) : 'Not selected'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 text-sm">
        {feature ? (
          <p>
            <span className="text-muted-foreground">Feature:</span> {feature.name}
          </p>
        ) : null}
        {!current ? (
          <p className="text-muted-foreground">
            Choose a background to gain its skills, languages and feature; its choices then appear
            under "Choices to make".
          </p>
        ) : null}
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <label className="grid min-w-0 flex-1 gap-1">
            {current ? 'Change to' : 'Background'}
            <select
              className={selectClass}
              value={target}
              onChange={(e) => {
                setPicked(e.target.value)
                setConfirming(false)
              }}
              data-testid="background-select"
            >
              <option value="">{current ? 'None (remove the background)' : 'Choose'}</option>
              {backgrounds.data?.items.map((b) => (
                <option key={b.uid} value={b.uid}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant={current ? 'outline' : 'default'}
            disabled={!changed}
            onClick={submit}
            data-testid="background-set"
          >
            {confirming ? 'Confirm change' : current ? 'Change background' : 'Choose background'}
          </Button>
        </div>
        {confirming ? (
          <p className="text-xs text-destructive" data-testid="background-warning">
            Changing the background resets these choices: {stored.join('; ')}. Press Confirm change
            to continue.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
