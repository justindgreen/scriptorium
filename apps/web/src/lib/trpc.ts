import { QueryClient } from '@tanstack/react-query'
import {
  createTRPCClient,
  httpBatchLink,
  httpSubscriptionLink,
  splitLink,
  TRPCClientError,
} from '@trpc/client'
import { createTRPCOptionsProxy } from '@trpc/tanstack-react-query'
import type { AppRouter } from '@scriptorium/server'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 5_000, refetchOnWindowFocus: false },
  },
})

export const trpcClient = createTRPCClient<AppRouter>({
  links: [
    splitLink({
      // Subscriptions ride on Server-Sent Events (EventSource reconnects by itself); everything
      // else is batched over HTTP.
      condition: (op) => op.type === 'subscription',
      true: httpSubscriptionLink({ url: '/api/trpc' }),
      false: httpBatchLink({ url: '/api/trpc' }),
    }),
  ],
})

/** Query/mutation option builders: `useQuery(trpc.system.status.queryOptions())`. */
export const trpc = createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient })

export function isTrpcError(error: unknown, code?: string): error is TRPCClientError<AppRouter> {
  if (!(error instanceof TRPCClientError)) return false
  return code ? error.data?.code === code : true
}

export function errorMessage(error: unknown): string {
  if (error instanceof TRPCClientError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
