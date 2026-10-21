import { Link } from '@tanstack/react-router'
import { CompassIcon } from 'lucide-react'
import { EmptyState } from '@/components/states'
import { Button } from '@/components/ui/button'

export function NotFoundPage() {
  return (
    <main id="main" className="mx-auto max-w-xl px-4 py-10">
      <EmptyState
        icon={CompassIcon}
        headingLevel={1}
        title="Not found"
        description="That page does not exist, or it has moved."
        action={
          <Button asChild variant="outline">
            <Link to="/">Back to home</Link>
          </Button>
        }
      />
    </main>
  )
}
