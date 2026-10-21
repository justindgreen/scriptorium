/**
 * Spike S2: tRPC v11 on Fastify 5 with (a) query and mutation over HTTP, (b) a subscription
 * delivered as Server-Sent Events through the Fastify adapter, and (c) trpc-to-openapi exposing
 * selected procedures as REST with a generated OpenAPI document.
 */
import Fastify from 'fastify'
import { initTRPC } from '@trpc/server'
import { fastifyTRPCPlugin, type CreateFastifyContextOptions } from '@trpc/server/adapters/fastify'
import { z } from 'zod'
import {
  fastifyTRPCOpenApiPlugin,
  generateOpenApiDocument,
  type OpenApiMeta,
} from 'trpc-to-openapi'

const t = initTRPC.meta<OpenApiMeta>().context<{ requestId: string }>().create()

const router = t.router({
  health: t.procedure
    .meta({ openapi: { method: 'GET', path: '/health', tags: ['system'], summary: 'Liveness' } })
    .input(z.void())
    .output(z.object({ status: z.literal('ok'), requestId: z.string() }))
    .query(({ ctx }) => ({ status: 'ok' as const, requestId: ctx.requestId })),
  echo: t.procedure
    .input(z.object({ text: z.string().min(1) }))
    .mutation(({ input }) => ({ text: input.text.toUpperCase() })),
  ticks: t.procedure
    .input(z.object({ count: z.number().int().positive().max(10) }))
    .subscription(async function* ({ input, signal }) {
      for (let i = 1; i <= input.count; i += 1) {
        if (signal?.aborted) return
        yield { tick: i }
        await new Promise((resolve) => setTimeout(resolve, 25))
      }
    }),
})
type Router = typeof router

const app = Fastify({ logger: false })
await app.register(fastifyTRPCPlugin<Router>, {
  prefix: '/api/trpc',
  trpcOptions: {
    router,
    createContext: ({ req }: CreateFastifyContextOptions) => ({ requestId: String(req.id) }),
  },
})
await app.register(fastifyTRPCOpenApiPlugin, {
  basePath: '/api/v1',
  router,
  createContext: ({ req }: CreateFastifyContextOptions) => ({ requestId: String(req.id) }),
})

const doc = generateOpenApiDocument(router, {
  title: 'Scriptorium',
  version: '0.0.1',
  baseUrl: 'http://127.0.0.1:3999/api/v1',
})
console.log('openapi:', doc.openapi, '| paths:', JSON.stringify(Object.keys(doc.paths ?? {})))

const port = 3999
await app.listen({ port, host: '127.0.0.1' })
const base = `http://127.0.0.1:${port}`

const q = await fetch(`${base}/api/trpc/health`)
console.log('trpc query:', q.status, (await q.text()).slice(0, 120))

const m = await fetch(`${base}/api/trpc/echo`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hello' }),
})
console.log('trpc mutation:', m.status, (await m.text()).slice(0, 120))

const bad = await fetch(`${base}/api/trpc/echo`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ text: '' }),
})
console.log('trpc validation error status (expected 400):', bad.status)

const rest = await fetch(`${base}/api/v1/health`)
console.log('rest via openapi plugin:', rest.status, (await rest.text()).slice(0, 120))

// Subscription over SSE: tRPC's httpSubscriptionLink issues GET with Accept: text/event-stream.
const input = encodeURIComponent(JSON.stringify({ count: 3 }))
const sse = await fetch(`${base}/api/trpc/ticks?input=${input}`, {
  headers: { accept: 'text/event-stream' },
})
console.log('sse status:', sse.status, '| content-type:', sse.headers.get('content-type'))
if (!sse.body) throw new Error('no SSE body')
const reader = sse.body.getReader()
const decoder = new TextDecoder()
let buffer = ''
let dataEvents = 0
const deadline = Date.now() + 5000
while (Date.now() < deadline) {
  const { value, done } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  dataEvents = (buffer.match(/^data:/gm) ?? []).length
  if (dataEvents >= 3) break
}
await reader.cancel().catch(() => {})
console.log('sse data events received:', dataEvents)
console.log('sse sample:', JSON.stringify(buffer.slice(0, 200)))

await app.close()
if (dataEvents < 3) throw new Error('SSE subscription did not deliver 3 events')
console.log('S2 OK')
