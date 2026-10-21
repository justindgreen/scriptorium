import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { errorMessage, trpc, trpcClient } from '@/lib/trpc'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function AdminBackupsPage() {
  const queryClient = useQueryClient()
  const backups = useQuery(trpc.admin.backups.list.queryOptions())
  const [verified, setVerified] = useState<Record<string, string>>({})
  const create = useMutation(
    trpc.admin.backups.create.mutationOptions({
      onSuccess: async (result) => {
        toast.success(`Backup ${result.name} created (${formatBytes(result.totalBytes)})`)
        await queryClient.invalidateQueries({ queryKey: trpc.admin.backups.list.queryKey() })
      },
      onError: (e) => toast.error(errorMessage(e)),
    }),
  )

  async function verify(name: string) {
    try {
      const result = await trpcClient.admin.backups.verify.query({ name })
      setVerified((v) => ({ ...v, [name]: result.ok ? 'Verified' : result.problems.join('; ') }))
    } catch (e) {
      toast.error(errorMessage(e))
    }
  }

  return (
    <div>
      <PageHeader
        title="Backups"
        description="Each backup holds a database dump and every uploaded file, with checksums. Backups live in the data directory under backups/."
        actions={
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            <ArchiveIcon aria-hidden="true" /> {create.isPending ? 'Backing up…' : 'Back up now'}
          </Button>
        }
      />
      <Alert className="mb-6">
        <AlertTitle>Restoring</AlertTitle>
        <AlertDescription>
          Restore runs from the command line so the server can be paused safely: see the deployment
          guide (restore command). While a restore runs, the application answers with a maintenance
          notice.
        </AlertDescription>
      </Alert>
      {backups.isPending ? <LoadingState rows={3} label="Loading backups" /> : null}
      {backups.isError ? (
        <ErrorState message={errorMessage(backups.error)} onRetry={() => void backups.refetch()} />
      ) : null}
      {backups.data && backups.data.length === 0 ? (
        <EmptyState
          icon={ArchiveIcon}
          title="No backups yet"
          description="Create one now, and set BACKUP_CRON to schedule them."
        />
      ) : null}
      {backups.data && backups.data.length > 0 ? (
        <div className="rounded-lg border bg-card">
          <Table aria-label="Backups table">
            <TableHeader>
              <TableRow>
                <TableHead>Created</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Size</TableHead>
                <TableHead>Files</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backups.data.map((b) => (
                <TableRow key={b.name} data-testid={`backup-${b.name}`}>
                  <TableCell className="tabular whitespace-nowrap">
                    {new Date(b.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{b.name}</TableCell>
                  <TableCell className="tabular">{formatBytes(b.totalBytes)}</TableCell>
                  <TableCell className="tabular">{b.fileCount}</TableCell>
                  <TableCell>{b.appVersion}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {verified[b.name] ?? ''}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="outline" size="sm" onClick={() => void verify(b.name)}>
                      Verify
                    </Button>
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
