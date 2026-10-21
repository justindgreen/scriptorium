import { Outlet } from '@tanstack/react-router'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

/** Root of the route tree: global providers that need the router, plus the toaster. */
export function RootDocument() {
  return (
    <TooltipProvider delayDuration={300}>
      <Outlet />
      <Toaster position="bottom-right" closeButton />
    </TooltipProvider>
  )
}
