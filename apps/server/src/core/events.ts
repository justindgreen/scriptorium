/** In-process event bus. SSE subscribers attach here (docs/ARCHITECTURE.md §7); emitted post-commit only. */
export type DomainEvent =
  | {
      type: 'character.changed'
      characterId: string
      revision: number
      eventId: string
      commandType: string
    }
  | { type: 'character.deleted'; characterId: string }
  | { type: 'encounter.changed'; encounterId: string; campaignId: string; version: number }

type Listener = (event: DomainEvent) => void

export function createEventBus() {
  const listeners = new Set<Listener>()
  return {
    emit(event: DomainEvent): void {
      for (const listener of listeners) {
        try {
          listener(event)
        } catch {
          // a failing subscriber never breaks the request that emitted the event
        }
      }
    },
    subscribe(listener: Listener): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get size() {
      return listeners.size
    },
  }
}

export type EventBus = ReturnType<typeof createEventBus>
