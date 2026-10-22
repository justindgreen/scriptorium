import { useState } from 'react'
import type { ActionRef, ActionTemplate } from '@scriptorium/rules-engine'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ABILITY_NAMES,
  modifier,
  uidLabel,
  type AbilityKey,
  type CharacterView,
} from '@/lib/characters'
import { ActionCard } from './ActionCard'
import { ABILITIES, selectClass, skillIds, type SendFn } from './shared'

function templateSummary(t: ActionTemplate): string {
  const parts: string[] = []
  if (t.attack) parts.push(modifier(t.attack.bonus))
  if (t.damage.length) parts.push(t.damage.map((d) => d.text).join(' or '))
  if (t.save) parts.push(`${t.save.ability.toUpperCase()} save DC ${t.save.dc}`)
  if (t.healing) parts.push(`heals ${t.healing}`)
  if (t.actionType !== 'action') parts.push(t.actionType)
  return parts.join(' · ')
}

function refFor(t: ActionTemplate): ActionRef {
  if (t.kind === 'weapon' && t.itemId) return { kind: 'weapon', itemId: t.itemId }
  if (t.kind === 'unarmed') return { kind: 'unarmed' }
  return { kind: 'action', templateId: t.id }
}

export function ActionsPanel({
  view,
  send,
  onError,
}: {
  view: CharacterView
  send: SendFn
  onError: (message: string | null) => void
}) {
  const { sheet } = view
  const [skill, setSkill] = useState('')
  const [save, setSave] = useState<AbilityKey | ''>('')
  const skills = skillIds(sheet)
  return (
    <Card data-testid="actions">
      <CardHeader>
        <CardTitle>Actions</CardTitle>
        <CardDescription>
          Open an action to see its plan, roll on the server, then apply the result.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2">
        {sheet.actionTemplates.length === 0 ? (
          <p className="text-sm text-muted-foreground">Equip a weapon to get attack actions.</p>
        ) : null}
        <ul className="grid gap-2" data-testid="action-templates">
          {sheet.actionTemplates.map((t) => (
            <li key={t.id}>
              <ActionCard
                characterId={view.id}
                revision={view.revision}
                actionRef={refFor(t)}
                title={t.name}
                summary={templateSummary(t)}
                send={send}
                onError={onError}
                testId={`action-${t.id}`}
              />
            </li>
          ))}
        </ul>
        <div className="grid gap-2 border-t pt-3 sm:grid-cols-2">
          <label className="grid gap-1 text-sm">
            Ability check
            <select
              className={selectClass}
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              data-testid="check-select"
            >
              <option value="">Choose a skill or ability</option>
              {ABILITIES.map((a) => (
                <option key={a} value={`ability:${a}`}>
                  {ABILITY_NAMES[a]} check
                </option>
              ))}
              {skills.map((s) => (
                <option key={s} value={`skill:${s}`}>
                  {uidLabel(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Saving throw
            <select
              className={selectClass}
              value={save}
              onChange={(e) => setSave(e.target.value as AbilityKey | '')}
              data-testid="save-select"
            >
              <option value="">Choose an ability</option>
              {ABILITIES.map((a) => (
                <option key={a} value={a}>
                  {ABILITY_NAMES[a]} save
                </option>
              ))}
            </select>
          </label>
        </div>
        {skill ? (
          <ActionCard
            key={skill}
            characterId={view.id}
            revision={view.revision}
            actionRef={
              skill.startsWith('skill:')
                ? { kind: 'check', skill: skill.slice(6) as never }
                : { kind: 'check', ability: skill.slice(8) as AbilityKey }
            }
            title={
              skill.startsWith('skill:')
                ? `${uidLabel(skill.slice(6))} check`
                : `${ABILITY_NAMES[skill.slice(8) as AbilityKey]} check`
            }
            send={send}
            onError={onError}
            testId="action-check"
          />
        ) : null}
        {save ? (
          <ActionCard
            key={save}
            characterId={view.id}
            revision={view.revision}
            actionRef={{ kind: 'save', ability: save }}
            title={`${ABILITY_NAMES[save]} saving throw`}
            send={send}
            onError={onError}
            testId="action-save"
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
