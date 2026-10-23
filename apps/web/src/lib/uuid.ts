/**
 * Client command ids (CLAUDE.md rule 4) must be cryptographically strong UUIDs on every origin.
 * `crypto.randomUUID` exists only in secure contexts (HTTPS, localhost), so a plain-HTTP LAN
 * install has none; `crypto.getRandomValues` is available everywhere and is used to build a
 * version-4 UUID. Math.random is never acceptable here: ids drive idempotent retries.
 */
type CryptoLike = {
  randomUUID?: () => string
  getRandomValues?: (array: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'))

export class UuidUnavailableError extends Error {
  constructor() {
    super(
      'This browser offers no secure random numbers, so changes cannot be sent safely. Use a current browser.',
    )
    this.name = 'UuidUnavailableError'
  }
}

/** A version-4 UUID from the platform's secure random source, on any origin. */
export function newUuid(
  cryptoImpl: CryptoLike | undefined = globalThis.crypto as CryptoLike,
): string {
  if (cryptoImpl?.randomUUID) return cryptoImpl.randomUUID()
  if (!cryptoImpl?.getRandomValues) throw new UuidUnavailableError()
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // RFC 4122 variant
  const h = Array.from(bytes, (b) => HEX[b]!)
  return `${h[0]}${h[1]}${h[2]}${h[3]}-${h[4]}${h[5]}-${h[6]}${h[7]}-${h[8]}${h[9]}-${h[10]}${h[11]}${h[12]}${h[13]}${h[14]}${h[15]}`
}

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

/**
 * Copies text with the Clipboard API when the origin allows it; otherwise selects the text in
 * the given element so the user can copy it by hand. Returns what happened for the UI to say.
 */
export async function copyText(
  text: string,
  fallbackElement?: HTMLInputElement | HTMLTextAreaElement | null,
): Promise<'copied' | 'selected' | 'unavailable'> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // Permission denied or insecure context: fall through to selection.
  }
  if (fallbackElement) {
    fallbackElement.focus()
    fallbackElement.select()
    return 'selected'
  }
  return 'unavailable'
}
