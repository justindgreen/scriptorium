import { z } from 'zod'
import { contentEntrySchema, type ContentEntry } from './entry.js'
import { rulesetIdSchema, sourceSlugSchema } from './ids.js'

export const CONTENT_PACKAGE_FORMAT = 'scriptorium-content-package' as const
export const CONTENT_PACKAGE_FORMAT_VERSION = 1 as const

export const contentSourceSchema = z.strictObject({
  slug: sourceSlugSchema,
  name: z.string().min(1).max(160),
  kind: z.enum(['srd', 'user_import', 'homebrew']),
  license: z.string().min(1).max(160),
  attributionText: z.string().min(1).max(4000),
  version: z.string().min(1).max(40),
  publisher: z.string().max(160).optional(),
  url: z.string().url().optional(),
  description: z.string().max(2000).optional(),
})

export type ContentSource = z.infer<typeof contentSourceSchema>

/** Portable content package (docs/CONTENT_FORMAT.md). */
export const contentPackageSchema = z
  .strictObject({
    format: z.literal(CONTENT_PACKAGE_FORMAT),
    formatVersion: z.literal(CONTENT_PACKAGE_FORMAT_VERSION),
    source: contentSourceSchema,
    rulesetId: rulesetIdSchema,
    entries: z.array(contentEntrySchema),
  })
  .superRefine((pkg, ctx) => {
    const seen = new Set<string>()
    pkg.entries.forEach((entry, index) => {
      if (seen.has(entry.uid)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'uid'],
          message: `duplicate uid "${entry.uid}"`,
        })
      }
      seen.add(entry.uid)
      if (!entry.uid.startsWith(`${pkg.source.slug}:`)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'uid'],
          message: `uid "${entry.uid}" does not belong to source "${pkg.source.slug}"`,
        })
      }
    })
  })

export type ContentPackage = z.infer<typeof contentPackageSchema>

export type PackageIssue = { path: string; message: string }

export type ParsePackageResult =
  { ok: true; package: ContentPackage } | { ok: false; issues: PackageIssue[] }

/** Validates a package, returning readable issues (path + message) instead of throwing. */
export function parseContentPackage(input: unknown): ParsePackageResult {
  const result = contentPackageSchema.safeParse(input)
  if (result.success) return { ok: true, package: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  }
}

export function parseContentEntry(
  input: unknown,
): { ok: true; entry: ContentEntry } | { ok: false; issues: PackageIssue[] } {
  const result = contentEntrySchema.safeParse(input)
  if (result.success) return { ok: true, entry: result.data }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      message: issue.message,
    })),
  }
}
