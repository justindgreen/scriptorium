import { useEffect, useState } from 'react'

type Health = { status: 'ok'; version: string; uptimeSeconds: number }
type HealthState =
  { kind: 'loading' } | { kind: 'ok'; health: Health } | { kind: 'error'; message: string }

/**
 * Foundation shell (M1.1). Shows that the SPA is served and can reach the API.
 * The application layout, navigation and design system replace this in M1.4.
 */
export function App() {
  const [state, setState] = useState<HealthState>({ kind: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    fetch('/healthz', { signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as Health
      })
      .then((health) => setState({ kind: 'ok', health }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unknown error',
        })
      })
    return () => controller.abort()
  }, [])

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-4">
      <h1 className="text-3xl font-semibold tracking-tight">Scriptorium</h1>
      <p className="text-base opacity-80">
        Self-hosted D&amp;D 5e character, content and campaign platform.
      </p>
      <p role="status" aria-live="polite" data-testid="server-health">
        {state.kind === 'loading' && 'Checking server…'}
        {state.kind === 'ok' && `Server ok · version ${state.health.version}`}
        {state.kind === 'error' && `Server unreachable: ${state.message}`}
      </p>
    </main>
  )
}
