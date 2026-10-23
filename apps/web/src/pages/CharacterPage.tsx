import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { FormError } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { uidLabel, useCharacter, useCharacterLive, useCommand } from '@/lib/characters'
import { errorMessage } from '@/lib/trpc'
import { ActionsPanel } from './character/ActionsPanel'
import { BackgroundPanel } from './character/BackgroundPanel'
import { PendingChoices } from './character/Choices'
import { ConditionsPanel } from './character/ConditionsPanel'
import { CurrencyPanel } from './character/CurrencyPanel'
import { DangerZone } from './character/DangerZone'
import { Diagnostics } from './character/Diagnostics'
import { History } from './character/History'
import { Inventory } from './character/Inventory'
import { LevelUp } from './character/LevelUp'
import { OverridesPanel } from './character/OverridesPanel'
import { Proficiencies } from './character/Proficiencies'
import { ResourcesPanel } from './character/ResourcesPanel'
import { SheetSection } from './character/SheetSection'
import { Spells } from './character/Spells'
import { Vitals } from './character/Vitals'
import type { SendFn } from './character/shared'

/**
 * The interactive sheet (M2.6). Every control issues a command through `useCommand`; the page
 * never computes a rule. Live updates arrive over the character subscription, with polling as the
 * fallback; a print stylesheet hides the controls.
 *
 * Layout (issue #4): what needs the player's attention first, then play controls beside the
 * character's details, equipment across the page, and management (level-ups, history, overrides,
 * diagnostics, deletion) last. One column on a phone, in that order.
 */
export function CharacterPage() {
  const { characterId } = useParams({ strict: false }) as { characterId: string }
  const { live } = useCharacterLive(characterId)
  const view = useCharacter(characterId, { live })
  const command = useCommand(characterId)
  const [error, setError] = useState<string | null>(null)

  if (view.isPending) return <LoadingState rows={6} />
  if (view.isError || !view.data)
    return (
      <ErrorState
        title="Character unavailable"
        message={view.error ? errorMessage(view.error) : 'Not found.'}
      />
    )
  const data = view.data
  const { sheet, aggregate } = data

  const send: SendFn = async (cmd) => {
    setError(null)
    try {
      await command.mutateAsync({ command: cmd, expectedRevision: data.revision })
    } catch (e) {
      setError(errorMessage(e))
    }
  }

  const classes = sheet.classes
    .map((c) => `${c.name}${c.subclassName ? ` (${c.subclassName})` : ''} ${c.level}`)
    .join(' / ')
  const background = aggregate.definition.backgroundUid
  const needsClass = sheet.level === 0
  const attention = !background || needsClass || sheet.pendingChoices.length > 0
  return (
    <div className="grid grid-cols-1 gap-8">
      <PageHeader
        title={aggregate.name}
        description={`${sheet.level > 0 ? `Level ${sheet.level} · ${classes}` : 'No class yet'}${aggregate.definition.speciesUid ? ` · ${uidLabel(aggregate.definition.speciesUid)}` : ''} · ${background ? uidLabel(background) : 'Background: Not selected'} · revision ${data.revision}`}
        actions={
          <>
            <Badge variant={live ? 'secondary' : 'outline'} data-testid="live-status">
              {live ? 'Live' : 'Polling'}
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.print()}
              className="print:hidden"
            >
              Print
            </Button>
          </>
        }
      />
      <FormError message={error} />
      {attention ? (
        <SheetSection
          id="attention"
          title="Needs your attention"
          hint="Finish these to complete the character."
          className="print:hidden"
        >
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {!background ? <BackgroundPanel view={data} send={send} /> : null}
            {needsClass ? <LevelUp view={data} send={send} onError={setError} /> : null}
            <div className="min-w-0 lg:col-span-2">
              <PendingChoices view={data} send={send} />
            </div>
          </div>
        </SheetSection>
      ) : null}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] print:block">
        <SheetSection id="play" title="Play" hint="Rolls, actions, resources and rests.">
          <Vitals view={data} send={send} />
          <ActionsPanel view={data} send={send} onError={setError} />
          <ResourcesPanel view={data} send={send} onError={setError} />
          {sheet.spellcasting ? <Spells view={data} send={send} onError={setError} /> : null}
        </SheetSection>
        <SheetSection id="character" title="Character" hint="Who they are and what applies now.">
          <ConditionsPanel view={data} send={send} />
          {background ? <BackgroundPanel view={data} send={send} /> : null}
          <Proficiencies sheet={sheet} />
          <CurrencyPanel view={data} send={send} />
        </SheetSection>
      </div>
      <SheetSection id="equipment" title="Equipment" hint="Carried, equipped and attuned items.">
        <Inventory view={data} send={send} />
      </SheetSection>
      <SheetSection
        id="management"
        title="Management"
        hint="Occasional changes, history, overrides, diagnostics."
        className="print:hidden"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {!needsClass ? <LevelUp view={data} send={send} onError={setError} /> : null}
          <History characterId={characterId} revision={data.revision} onError={setError} />
          <OverridesPanel view={data} send={send} />
          <Diagnostics sheet={sheet} />
          <DangerZone characterId={characterId} name={aggregate.name} />
        </div>
      </SheetSection>
    </div>
  )
}
