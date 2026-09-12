import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import UPNG from 'upng-js'

const projectRoot = process.cwd()
const sourcePng = await readFile(path.join(projectRoot, 'public', 'logo.png'))
const sourceSvg = await readFile(path.join(projectRoot, 'public', 'logo-word-clean.svg'), 'utf8')
const decoded = UPNG.decode(sourcePng.buffer.slice(sourcePng.byteOffset, sourcePng.byteOffset + sourcePng.byteLength))
const source = new Uint8Array(UPNG.toRGBA8(decoded)[0])
const sourceWidth = decoded.width
const sourceHeight = decoded.height
const outputDirectory = path.join(projectRoot, 'public', 'pwa-icons')

await mkdir(outputDirectory, { recursive: true })

const faviconSvg = sourceSvg.replace('viewBox="138 292 448 265"', 'viewBox="138 200.5 448 448"')
await writeFile(path.join(outputDirectory, 'favicon.svg'), faviconSvg)

function sample(x, y, channel) {
  const x0 = Math.max(0, Math.min(sourceWidth - 1, Math.floor(x)))
  const y0 = Math.max(0, Math.min(sourceHeight - 1, Math.floor(y)))
  const x1 = Math.min(sourceWidth - 1, x0 + 1)
  const y1 = Math.min(sourceHeight - 1, y0 + 1)
  const tx = x - x0
  const ty = y - y0
  const a = source[(y0 * sourceWidth + x0) * 4 + channel]
  const b = source[(y0 * sourceWidth + x1) * 4 + channel]
  const c = source[(y1 * sourceWidth + x0) * 4 + channel]
  const d = source[(y1 * sourceWidth + x1) * 4 + channel]
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}

async function createIcon(filename, size, logoScale) {
  const output = new Uint8Array(size * size * 4)
  const targetWidth = Math.round(size * logoScale)
  const targetHeight = Math.round(targetWidth * sourceHeight / sourceWidth)
  const offsetX = Math.round((size - targetWidth) / 2)
  const offsetY = Math.round((size - targetHeight) / 2)

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const destination = (y * size + x) * 4
      let red = 1
      let green = 25
      let blue = 53

      if (x >= offsetX && x < offsetX + targetWidth && y >= offsetY && y < offsetY + targetHeight) {
        const sourceX = ((x - offsetX) + 0.5) * sourceWidth / targetWidth - 0.5
        const sourceY = ((y - offsetY) + 0.5) * sourceHeight / targetHeight - 0.5
        const alpha = sample(sourceX, sourceY, 3) / 255
        red = Math.round(sample(sourceX, sourceY, 0) * alpha + red * (1 - alpha))
        green = Math.round(sample(sourceX, sourceY, 1) * alpha + green * (1 - alpha))
        blue = Math.round(sample(sourceX, sourceY, 2) * alpha + blue * (1 - alpha))
      }

      output[destination] = red
      output[destination + 1] = green
      output[destination + 2] = blue
      output[destination + 3] = 255
    }
  }

  const encoded = UPNG.encode([output.buffer], size, size, 0)
  await writeFile(path.join(outputDirectory, filename), Buffer.from(encoded))
}

await Promise.all([
  createIcon('icon-192-v3.png', 192, 0.78),
  createIcon('icon-512-v3.png', 512, 0.78),
  createIcon('icon-maskable-512-v3.png', 512, 0.64),
])

console.log('Generated branded PWA PNG icons from the TCG logo artwork')
