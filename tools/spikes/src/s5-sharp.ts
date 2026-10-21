/**
 * Spike S5: sharp installs and runs on this Windows workstation (Debian image is checked in CI).
 * Generates an image in memory, re-encodes it (the upload pipeline's operation), and reports versions.
 */
import sharp from 'sharp'

console.log('sharp versions:', JSON.stringify(sharp.versions))

const source = await sharp({
  create: { width: 640, height: 480, channels: 4, background: { r: 120, g: 30, b: 40, alpha: 1 } },
})
  .png()
  .toBuffer()

const reencoded = await sharp(source)
  .rotate() // honours EXIF orientation, then strips metadata by default
  .resize({ width: 256, height: 256, fit: 'cover' })
  .webp({ quality: 82 })
  .toBuffer()

const meta = await sharp(reencoded).metadata()
console.log(
  'output:',
  meta.format,
  meta.width,
  'x',
  meta.height,
  '|',
  reencoded.byteLength,
  'bytes',
)

// Type sniffing: sharp rejects non-image bytes.
let rejected = false
try {
  await sharp(Buffer.from('<html>not an image</html>')).metadata()
} catch {
  rejected = true
}
console.log('non-image rejected:', rejected)
if (meta.format !== 'webp' || meta.width !== 256 || !rejected)
  throw new Error('S5 assertions failed')
console.log('S5 OK')
