import { useMutation, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { ConfirmButton } from '@/components/ConfirmButton'
import { FormField } from '@/components/FormField'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { uidLabel, type CharacterView } from '@/lib/characters'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'
import { selectClass, type SendFn } from './shared'

export function LevelUp({
  view,
  send,
  onError,
}: {
  view: CharacterView
  send: SendFn
  onError: (message: string | null) => void
}) {
  const classes = useQuery(trpc.content.entries.list.queryOptions({ kind: 'class', limit: 100 }))
  const [classUid, setClassUid] = useState(view.sheet.classes[0]?.classUid ?? '')
  const [roll, setRoll] = useState('')
  const [subclassFor, setSubclassFor] = useState(
    view.sheet.classes.find((c) => !c.subclassUid)?.classUid ?? '',
  )
  const subclasses = useQuery({
    ...trpc.content.entries.list.queryOptions({
      kind: 'subclass',
      tags: subclassFor ? [subclassFor.split(':').pop()!] : [],
      limit: 50,
    }),
    enabled: Boolean(subclassFor),
  })
  const [subclassUid, setSubclassUid] = useState('')
  const rolled = view.aggregate.definition.hpMode === 'rolled'
  const hitDie = view.sheet.classes.find((c) => c.classUid === classUid)?.hitDie as
    'd4' | 'd6' | 'd8' | 'd10' | 'd12' | undefined
  const rollHitDie = useMutation({
    mutationFn: () =>
      trpcClient.characters.rollHitDie.mutate({ characterId: view.id, die: hitDie! }),
    onSuccess: (r) => setRoll(String(r.roll)),
    onError: (e) => onError(errorMessage(e)),
  })
  return (
    <Card data-testid="level-up">
      <CardHeader>
        <CardTitle>Level up</CardTitle>
        <CardDescription>
          Level {view.sheet.level}. Multiclass prerequisites are checked by the engine.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <FormField id="levelup-class" label="Class">
          <select
            id="levelup-class"
            className={selectClass}
            value={classUid}
            onChange={(e) => setClassUid(e.target.value)}
            data-testid="levelup-class"
          >
            <option value="">Choose a class</option>
            {classes.data?.items.map((c) => (
              <option key={c.uid} value={c.uid}>
                {c.name}
              </option>
            ))}
          </select>
        </FormField>
        {rolled ? (
          <FormField id="levelup-roll" label="Hit die roll" hint="Leave empty to take the average.">
            <Input
              id="levelup-roll"
              type="number"
              min={1}
              max={12}
              value={roll}
              onChange={(e) => setRoll(e.target.value)}
              aria-describedby="levelup-roll-hint"
            />
            <Button
              size="sm"
              variant="outline"
              className="mt-1"
              disabled={!hitDie || rollHitDie.isPending}
              onClick={() => rollHitDie.mutate()}
              data-testid="levelup-roll-die"
            >
              {hitDie ? `Roll a ${hitDie}` : 'Roll (existing classes only)'}
            </Button>
          </FormField>
        ) : null}
        <ConfirmButton
          testId="levelup-add"
          label="Add a level"
          title={`Add level ${view.sheet.level + 1} as ${classes.data?.items.find((c) => c.uid === classUid)?.name ?? uidLabel(classUid)}?`}
          description="A snapshot of the character as it is now is taken first. The level-up itself cannot be undone, but right afterwards History offers to restore that snapshot, which brings back the whole previous state."
          confirmLabel="Add the level"
          disabled={!classUid}
          onConfirm={() =>
            void send({
              type: 'addClassLevel',
              classUid,
              ...(rolled && roll ? { hitDieRoll: Number(roll) } : {}),
            })
          }
        />
        {view.sheet.classes.some((c) => !c.subclassUid) ? (
          <div className="grid gap-2 border-t pt-3">
            <FormField id="subclass-class" label="Subclass for">
              <select
                id="subclass-class"
                className={selectClass}
                value={subclassFor}
                onChange={(e) => setSubclassFor(e.target.value)}
              >
                {view.sheet.classes
                  .filter((c) => !c.subclassUid)
                  .map((c) => (
                    <option key={c.classUid} value={c.classUid}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </FormField>
            <FormField id="subclass" label="Subclass">
              <select
                id="subclass"
                className={selectClass}
                value={subclassUid}
                onChange={(e) => setSubclassUid(e.target.value)}
                data-testid="subclass-select"
              >
                <option value="">Choose</option>
                {subclasses.data?.items.map((s) => (
                  <option key={s.uid} value={s.uid}>
                    {s.name}
                  </option>
                ))}
              </select>
            </FormField>
            <Button
              variant="outline"
              disabled={!subclassUid}
              onClick={() => void send({ type: 'setSubclass', classUid: subclassFor, subclassUid })}
              data-testid="subclass-set"
            >
              Set subclass
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
