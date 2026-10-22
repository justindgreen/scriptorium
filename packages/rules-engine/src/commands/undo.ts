import { UNDO_WINDOW, type CharacterCommand, type CommandEvent } from './types.js'

/** A logged event as the server stores it: newest first when listed. */
export type LoggedEvent = Pick<CommandEvent, 'type' | 'before' | 'reversible'> & {
  id: string
  revisionAfter: number
}

/**
 * Undo limits (docs/RULES_ENGINE.md §8): only the latest event, only when it is reversible, only
 * when no non-reversible event follows it, and only within the last UNDO_WINDOW events.
 */
export function canUndo(
  latestFirst: LoggedEvent[],
): { ok: true; event: LoggedEvent } | { ok: false; reason: string } {
  const latest = latestFirst[0]
  if (!latest) return { ok: false, reason: 'nothing to undo' }
  if (latest.type === 'undo') return { ok: false, reason: 'the last change was already an undo' }
  if (!latest.reversible)
    return { ok: false, reason: `${latest.type} cannot be undone; restore a snapshot instead` }
  if (
    latestFirst.length > UNDO_WINDOW &&
    latestFirst.slice(0, UNDO_WINDOW).every((e) => e.id !== latest.id)
  ) {
    return { ok: false, reason: 'that change is too far back' }
  }
  return { ok: true, event: latest }
}

/** The compensating command: write the event's recorded `before` sections back. */
export function compensatingCommand(event: LoggedEvent): CharacterCommand {
  return { type: 'undo', eventType: event.type, before: event.before }
}
