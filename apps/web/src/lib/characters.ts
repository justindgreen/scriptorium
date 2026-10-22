import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { trpc, trpcClient } from '@/lib/trpc'

/** The character view the API returns: aggregate plus computed sheet. */
export type CharacterView = Awaited<ReturnType<typeof trpcClient.characters.get.query>>
/** The command input as the API validates it (a subset of the engine's command union). */
export type CommandInput = Parameters<typeof trpcClient.characters.command.mutate>[0]['command']

export function useCharacter(characterId: string) {
  return useQuery(trpc.characters.get.queryOptions({ characterId }))
}

/**
 * Sends one command with a fresh client command id and the revision the caller saw. A CONFLICT
 * means someone else changed the character: the view is refetched and the user tries again.
 */
export function useCommand(characterId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: { command: CommandInput; expectedRevision: number }) =>
      trpcClient.characters.command.mutate({
        characterId,
        commandId: crypto.randomUUID(),
        expectedRevision: input.expectedRevision,
        command: input.command,
      }),
    onSettled: async () => {
      await Promise.all([
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
        queryClient.invalidateQueries({ queryKey: trpc.characters.list.queryKey() }),
      ])
    },
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
