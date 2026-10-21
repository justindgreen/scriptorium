import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { EmptyState, ErrorState, LoadingState, PageHeader } from './states'

describe('state components', () => {
  it('renders an empty state with its call to action', () => {
    render(
      <EmptyState
        title="No invites yet"
        description="Create one."
        action={<button>Create</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'No invites yet' })).toBeInTheDocument()
    expect(screen.getByText('Create one.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('announces errors and lets the user retry', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Network down" onRetry={onRetry} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Network down')
    await userEvent.setup().click(screen.getByRole('button', { name: 'Try again' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('exposes loading as a polite status', () => {
    render(<LoadingState rows={2} label="Loading users" />)
    expect(screen.getByRole('status', { name: 'Loading users' })).toBeInTheDocument()
  })

  it('renders the page title as the level-one heading', () => {
    render(<PageHeader title="Users" description="Roles and access." />)
    expect(screen.getByRole('heading', { level: 1, name: 'Users' })).toBeInTheDocument()
  })
})
