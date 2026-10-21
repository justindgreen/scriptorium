import { Link } from '@tanstack/react-router'
import { PageTitle } from '../components/forms.js'

export function NotFoundPage() {
  return (
    <div>
      <PageTitle subtitle="That page does not exist.">Not found</PageTitle>
      <Link to="/" className="text-sm underline">
        Back to home
      </Link>
    </div>
  )
}
