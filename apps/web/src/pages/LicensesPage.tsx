import { useQuery } from '@tanstack/react-query'
import { ErrorState, LoadingState, PageHeader } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { errorMessage, trpc } from '@/lib/trpc'

/** Public page: licence and attribution for every installed content source, plus the software's own notices. */
export function LicensesPage() {
  const licenses = useQuery(trpc.content.licenses.queryOptions())

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Licences and attribution"
        description="Game content installed on this instance and the licences it is used under."
      />
      {licenses.isPending ? <LoadingState rows={3} label="Loading licences" /> : null}
      {licenses.isError ? (
        <ErrorState
          message={errorMessage(licenses.error)}
          onRetry={() => void licenses.refetch()}
        />
      ) : null}
      <div className="space-y-4">
        {licenses.data?.map((source) => (
          <Card key={source.slug} data-testid={`license-${source.slug}`}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                {source.name}
                <Badge variant="secondary">{source.license}</Badge>
                {!source.isEnabled ? <Badge variant="outline">disabled</Badge> : null}
              </CardTitle>
              <CardDescription>
                Version {source.version}
                {source.publisher ? ` · ${source.publisher}` : ''} · {source.entryCount} entries
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm whitespace-pre-wrap">{source.attributionText}</p>
              {source.url ? (
                <a
                  href={source.url}
                  className="mt-2 inline-block text-sm underline underline-offset-4"
                  rel="noreferrer"
                  target="_blank"
                >
                  {source.url}
                </a>
              ) : null}
            </CardContent>
          </Card>
        ))}
        <Card>
          <CardHeader>
            <CardTitle>Software</CardTitle>
            <CardDescription>
              Scriptorium bundles open-source fonts and icons so it works without internet access.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <p>
              Fraunces and Inter are used under the SIL Open Font License 1.1. Lucide icons are used
              under the ISC licence.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
