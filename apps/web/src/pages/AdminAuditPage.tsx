import { useQuery } from '@tanstack/react-query'
import { ScrollTextIcon } from 'lucide-react'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { errorMessage, trpc } from '@/lib/trpc'

export function AdminAuditPage() {
  const audit = useQuery(trpc.admin.audit.list.queryOptions({ limit: 200 }))

  return (
    <div>
      <PageHeader
        title="Audit log"
        description="Administrative and security-relevant actions, newest first."
      />
      {audit.isPending ? <LoadingState rows={6} label="Loading audit log" /> : null}
      {audit.isError ? (
        <ErrorState message={errorMessage(audit.error)} onRetry={() => void audit.refetch()} />
      ) : null}
      {audit.data && audit.data.length === 0 ? (
        <EmptyState
          icon={ScrollTextIcon}
          title="Nothing recorded yet"
          description="Sign-ins, invites, role changes and settings updates will appear here."
        />
      ) : null}
      {audit.data && audit.data.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <Table aria-label="Audit log table">
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Actor</TableHead>
                <TableHead>Target</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.data.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className="tabular whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{entry.action}</TableCell>
                  <TableCell>
                    {entry.actorUsername ?? <span className="text-muted-foreground">system</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {entry.targetType ? `${entry.targetType}` : ''}
                  </TableCell>
                  <TableCell
                    className="max-w-md truncate font-mono text-xs text-muted-foreground"
                    title={entry.metadata ? JSON.stringify(entry.metadata) : undefined}
                  >
                    {entry.metadata ? JSON.stringify(entry.metadata) : ''}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}
    </div>
  )
}
