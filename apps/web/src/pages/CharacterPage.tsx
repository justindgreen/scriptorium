import { useParams } from '@tanstack/react-router'
import { useState } from 'react'
import { FormError } from '@/components/FormField'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { uidLabel, useCharacter, useCharacterLive, useCommand } from '@/lib/characters'
import { errorMessage } from '@/lib/trpc'
import { ActionsPanel } from './character/ActionsPanel'
import { PendingChoices } from './character/Choices'
import { ConditionsPanel } from './character/ConditionsPanel'
import { CurrencyPanel } from './character/CurrencyPanel'
import { Diagnostics } from './character/Diagnostics'
import { History } from './character/History'
import { Inventory } from './character/Inventory'
import { LevelUp } from './character/LevelUp'
import { OverridesPanel } from './character/OverridesPanel'
import { ResourcesPanel } from './character/ResourcesPanel'
import { Spells } from './character/Spells'
import { Vitals } from './character/Vitals'
import type { SendFn } from './character/shared'

/**
 * The interactive sheet (M2.6). Every control issues a command through `useCommand`; the page
 * never computes a rule. Live updates arrive over the character subscription, with polling as the
 * fallback; a print stylesheet hides the controls.
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
  return (
    <div className="grid gap-6">
      <PageHeader
        title={aggregate.name}
        description={`${sheet.level > 0 ? `Level ${sheet.level} · ${classes}` : 'No class yet'}${aggregate.definition.speciesUid ? ` · ${uidLabel(aggregate.definition.speciesUid)}` : ''} · revision ${data.revision}`}
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
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] print:block">
        <div className="grid min-w-0 grid-cols-1 gap-6">
          <Vitals view={data} send={send} />
          <ActionsPanel view={data} send={send} onError={setError} />
          <PendingChoices view={data} send={send} />
          <ResourcesPanel view={data} send={send} onError={setError} />
          <Inventory view={data} send={send} />
          {sheet.spellcasting ? <Spells view={data} send={send} onError={setError} /> : null}
        </div>
        <div className="grid min-w-0 grid-cols-1 gap-6 self-start">
          <ConditionsPanel view={data} send={send} />
          <CurrencyPanel view={data} send={send} />
          <OverridesPanel view={data} send={send} />
          <LevelUp view={data} send={send} onError={setError} />
          <History characterId={characterId} revision={data.revision} onError={setError} />
          <Diagnostics sheet={sheet} />
        </div>
      </div>
    </div>
  )
}
