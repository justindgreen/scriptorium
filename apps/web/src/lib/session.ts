import { isTrpcError, queryClient, trpc } from './trpc.js'

export type Me = {
  id: string
  username: string | null
  displayName: string
  email: string | null
  role: 'admin' | 'user'
}

export type InstanceStatus = { setupComplete: boolean; instanceName: string; version: string }

export function loadStatus(): Promise<InstanceStatus> {
  return queryClient.ensureQueryData(trpc.system.status.queryOptions())
}

/** The signed-in user, or null when there is no valid session. */
export async function loadSession(): Promise<Me | null> {
  try {
    return await queryClient.ensureQueryData(trpc.me.get.queryOptions())
  } catch (error) {
    if (isTrpcError(error, 'UNAUTHORIZED')) return null
    throw error
  }
}

/** Forget cached session and status after sign-in, sign-out, setup or registration. */
export async function resetSessionCache(): Promise<void> {
  // resetQueries (not removeQueries) so mounted observers such as the layout refetch at once.
  await queryClient.resetQueries({ queryKey: trpc.me.get.queryKey() })
  await queryClient.invalidateQueries({ queryKey: trpc.system.status.queryKey() })
}
