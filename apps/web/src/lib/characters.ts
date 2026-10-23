import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSubscription } from '@trpc/tanstack-react-query'
import { useCallback, useState } from 'react'
import { trpc, trpcClient } from '@/lib/trpc'
import { newUuid } from '@/lib/uuid'

/** The character view the API returns: aggregate plus computed sheet. */
export type CharacterView = Awaited<ReturnType<typeof trpcClient.characters.get.query>>
/** The command input as the API validates it (a subset of the engine's command union). */
export type CommandInput = Parameters<typeof trpcClient.characters.command.mutate>[0]['command']

/** How often the sheet is polled while the live subscription is not connected. */
export const POLL_INTERVAL_MS = 15_000

export function useCharacter(characterId: string, options: { live?: boolean } = {}) {
  return useQuery({
    ...trpc.characters.get.queryOptions({ characterId }),
    // Polling is the fallback when Server-Sent Events are unavailable (docs/ARCHITECTURE.md §7).
    refetchInterval: options.live ? false : POLL_INTERVAL_MS,
  })
}

/** Every query that shows part of a character, invalidated together after any change. */
export function useInvalidateCharacter(characterId: string) {
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: trpc.characters.get.queryKey({ characterId }) }),
        queryClient.invalidateQueries({
          queryKey: trpc.characters.events.queryKey({ characterId }),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.characters.undoAvailability.queryKey({ characterId }),
        }),
        queryClient.invalidateQueries({
          queryKey: trpc.characters.snapshots.list.queryKey({ characterId }),
        }),
        queryClient.invalidateQueries({ queryKey: trpc.characters.plan.queryKey() }),
        queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() }),
      ]),
    [queryClient, characterId],
  )
}

/**
 * Subscribes to the character's post-commit events. Every `character.changed` (and the `ready`
 * frame after a reconnect) is compared with the cached revision; a gap triggers a refetch.
 * Returns whether the stream is connected so the caller can fall back to polling.
 */
export function useCharacterLive(characterId: string): { live: boolean } {
  const queryClient = useQueryClient()
  const invalidate = useInvalidateCharacter(characterId)
  const [live, setLive] = useState(false)
  const subscription = useSubscription(
    trpc.characters.subscribe.subscriptionOptions(
      { characterId },
      {
        onData: (event) => {
          if (event.type !== 'ready' && event.type !== 'character.changed') {
            void invalidate()
            return
          }
          const cached = queryClient.getQueryData(trpc.characters.get.queryKey({ characterId }))
          if (!cached || cached.revision !== event.revision) void invalidate()
        },
        onConnectionStateChange: (state) => setLive(state.state === 'pending'),
      },
    ),
  )
  return { live: live && subscription.status === 'pending' }
}

/**
 * Sends one command with a fresh client command id and the revision the caller saw. A CONFLICT
 * means someone else changed the character: the view is refetched and the user tries again.
 */
export function useCommand(characterId: string) {
  const invalidate = useInvalidateCharacter(characterId)
  return useMutation({
    mutationFn: (input: { command: CommandInput; expectedRevision: number }) =>
      trpcClient.characters.command.mutate({
        characterId,
        commandId: newUuid(),
        expectedRevision: input.expectedRevision,
        command: input.command,
      }),
    onSettled: () => invalidate(),
  })
}

export function modifier(n: number): string {
  return n >= 0 ? `+${n}` : String(n)
}

/** `srd-5.1:class:fighter` -> `Fighter` when no name is available. */
export function uidLabel(uid: string | undefined): string {
  if (!uid) return ''
  const slug = uid.split(':').pop() ?? uid
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export const ABILITY_NAMES = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
} as const

export type AbilityKey = keyof typeof ABILITY_NAMES

/** 2014 point-buy costs for scores 8–15. */
export const POINT_BUY_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
}
export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8]
