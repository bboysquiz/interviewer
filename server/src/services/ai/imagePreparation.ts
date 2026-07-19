import fs from 'node:fs/promises'

import sharp from 'sharp'

const MAX_AI_IMAGE_DIMENSION = 1920
const MAX_AI_IMAGE_PIXELS = 3_000_000
const MAX_AI_IMAGE_BYTES = 2_500_000

const supportedSourceMimeTypes: Partial<Record<string, string>> = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

interface ImageEncodingAttempt {
  scale: number
  quality: number
}

export interface PreparedAiImage {
  dataUrl: string
  mimeType: string
  width: number | null
  height: number | null
  byteLength: number
  optimized: boolean
}

const encodingAttempts: ImageEncodingAttempt[] = [
  { scale: 1, quality: 86 },
  { scale: 1, quality: 76 },
  { scale: 0.85, quality: 76 },
  { scale: 0.7, quality: 68 },
  { scale: 0.55, quality: 60 },
]

const toDataUrl = (mimeType: string, buffer: Buffer): string =>
  `data:${mimeType};base64,${buffer.toString('base64')}`

const resolveResizeScale = (width: number, height: number): number =>
  Math.min(
    1,
    MAX_AI_IMAGE_DIMENSION / width,
    MAX_AI_IMAGE_DIMENSION / height,
    Math.sqrt(MAX_AI_IMAGE_PIXELS / (width * height)),
  )

export const prepareImageBufferForAi = async (
  sourceBuffer: Buffer,
): Promise<PreparedAiImage> => {
  const source = sharp(sourceBuffer, { failOn: 'none' })
  const metadata = await source.metadata()
  const width = metadata.width ?? null
  const height = metadata.height ?? null
  const sourceMimeType = metadata.format
    ? supportedSourceMimeTypes[metadata.format] ?? null
    : null
  const sourceFitsDimensions =
    width !== null &&
    height !== null &&
    width <= MAX_AI_IMAGE_DIMENSION &&
    height <= MAX_AI_IMAGE_DIMENSION &&
    width * height <= MAX_AI_IMAGE_PIXELS

  if (
    sourceMimeType &&
    sourceFitsDimensions &&
    sourceBuffer.length <= MAX_AI_IMAGE_BYTES
  ) {
    return {
      dataUrl: toDataUrl(sourceMimeType, sourceBuffer),
      mimeType: sourceMimeType,
      width,
      height,
      byteLength: sourceBuffer.length,
      optimized: false,
    }
  }

  const baseScale =
    width !== null && height !== null ? resolveResizeScale(width, height) : 1
  let lastResult: PreparedAiImage | null = null

  for (const attempt of encodingAttempts) {
    const targetWidth =
      width !== null
        ? Math.max(1, Math.floor(width * baseScale * attempt.scale))
        : Math.floor(MAX_AI_IMAGE_DIMENSION * attempt.scale)
    const targetHeight =
      height !== null
        ? Math.max(1, Math.floor(height * baseScale * attempt.scale))
        : Math.floor(MAX_AI_IMAGE_DIMENSION * attempt.scale)
    const result = await sharp(sourceBuffer, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: targetWidth,
        height: targetHeight,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({
        quality: attempt.quality,
        chromaSubsampling: '4:4:4',
        progressive: true,
      })
      .toBuffer({ resolveWithObject: true })
    const prepared: PreparedAiImage = {
      dataUrl: toDataUrl('image/jpeg', result.data),
      mimeType: 'image/jpeg',
      width: result.info.width,
      height: result.info.height,
      byteLength: result.data.length,
      optimized: true,
    }

    lastResult = prepared

    if (result.data.length <= MAX_AI_IMAGE_BYTES) {
      return prepared
    }
  }

  if (!lastResult) {
    throw new Error('No image encoding attempt was performed.')
  }

  return lastResult
}

export const prepareImageForAi = async (
  filePath: string,
): Promise<PreparedAiImage> =>
  prepareImageBufferForAi(await fs.readFile(filePath))
