import { buildApiUrl } from '@/services/client/http'
import type { Attachment } from '@/types'

import type { NoteFormBlock, NoteFormImageBlock } from '@/features/notes/noteForm'

interface ExportNotebookInput {
  title: string
  blocks: NoteFormBlock[]
  attachmentsById: Record<string, Attachment>
}

export interface NotebookExportArtifact {
  file: File
  html: string
}

export type NotebookExportDeliveryResult =
  | {
      kind: 'shared'
    }
  | {
      kind: 'downloaded'
    }
  | {
      kind: 'cancelled'
    }

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const sanitizeExportFileName = (value: string): string => {
  const normalized = value.trim().replace(/\s+/g, ' ')
  const cleaned = normalized.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '').slice(0, 80)

  return cleaned || 'note-export'
}

const readBlobAsDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
        return
      }

      reject(new Error('Не удалось прочитать изображение для экспорта.'))
    }

    reader.onerror = () => {
      reject(
        reader.error ?? new Error('Не удалось прочитать изображение для экспорта.'),
      )
    }

    reader.readAsDataURL(blob)
  })

const fetchImageAsDataUrl = async (
  sourceUrl: string,
  fallbackMimeType = 'image/png',
): Promise<string> => {
  const response = await fetch(sourceUrl)

  if (!response.ok) {
    throw new Error(`Не удалось загрузить изображение для экспорта (${response.status}).`)
  }

  const blob = await response.blob()

  if (blob.type) {
    return readBlobAsDataUrl(blob)
  }

  return readBlobAsDataUrl(
    new Blob([await blob.arrayBuffer()], {
      type: fallbackMimeType,
    }),
  )
}

const resolveImageBlockDataUrl = async (
  block: NoteFormImageBlock,
  attachmentsById: Record<string, Attachment>,
): Promise<string | null> => {
  if (block.uploadFile) {
    return readBlobAsDataUrl(block.uploadFile)
  }

  if (block.localPreviewUrl) {
    return fetchImageAsDataUrl(block.localPreviewUrl)
  }

  if (!block.attachmentId) {
    return null
  }

  const attachment = attachmentsById[block.attachmentId]

  if (!attachment) {
    return null
  }

  return fetchImageAsDataUrl(
    buildApiUrl(attachment.storagePath),
    attachment.mimeType || 'image/png',
  )
}

const renderTextBlockHtml = (text: string): string => {
  const normalized = text.replace(/\r\n?/g, '\n').trim()

  if (!normalized) {
    return ''
  }

  return `<section class="note-export__text">${escapeHtml(normalized)}</section>`
}

const renderImageBlockHtml = async (
  block: NoteFormImageBlock,
  attachmentsById: Record<string, Attachment>,
): Promise<string> => {
  const dataUrl = await resolveImageBlockDataUrl(block, attachmentsById)

  if (!dataUrl) {
    return ''
  }

  const alt = escapeHtml(block.fileName || 'Изображение заметки')

  return [
    '<figure class="note-export__figure">',
    `  <img class="note-export__image" src="${dataUrl}" alt="${alt}" />`,
    '</figure>',
  ].join('\n')
}

const buildNotebookExportHtml = async (
  input: ExportNotebookInput,
): Promise<string> => {
  const contentParts: string[] = []

  for (const block of input.blocks) {
    if (block.type === 'text') {
      const rendered = renderTextBlockHtml(block.text)

      if (rendered) {
        contentParts.push(rendered)
      }

      continue
    }

    const rendered = await renderImageBlockHtml(block, input.attachmentsById)

    if (rendered) {
      contentParts.push(rendered)
    }
  }

  const title = input.title.trim() || 'Экспорт заметки'

  return [
    '<!DOCTYPE html>',
    '<html lang="ru">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `  <title>${escapeHtml(title)}</title>`,
    '  <style>',
    '    :root { color-scheme: light; }',
    '    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif; background: #fbf8f2; color: #2f241a; }',
    '    .note-export { max-width: 820px; margin: 0 auto; padding: 24px 18px 48px; }',
    '    .note-export__title { margin: 0 0 18px; font-size: 28px; line-height: 1.1; font-weight: 800; }',
    '    .note-export__content { display: flex; flex-direction: column; gap: 18px; }',
    '    .note-export__text { white-space: pre-wrap; line-height: 1.62; font-size: 17px; }',
    '    .note-export__figure { margin: 0; }',
    '    .note-export__image { display: block; width: 100%; height: auto; border-radius: 18px; box-shadow: 0 10px 28px rgba(47, 36, 26, 0.12); }',
    '  </style>',
    '</head>',
    '<body>',
    '  <main class="note-export">',
    `    <h1 class="note-export__title">${escapeHtml(title)}</h1>`,
    '    <section class="note-export__content">',
    contentParts.length > 0
      ? contentParts.map((part) => `      ${part}`).join('\n')
      : '      <section class="note-export__text">Заметка пока пуста.</section>',
    '    </section>',
    '  </main>',
    '</body>',
    '</html>',
  ].join('\n')
}

export const createNotebookExportArtifact = async (
  input: ExportNotebookInput,
): Promise<NotebookExportArtifact> => {
  const html = await buildNotebookExportHtml(input)
  const fileName = `${sanitizeExportFileName(input.title)}.html`
  const file = new File([html], fileName, {
    type: 'text/html',
    lastModified: Date.now(),
  })

  return {
    file,
    html,
  }
}

export const deliverNotebookExportArtifact = async (
  artifact: NotebookExportArtifact,
): Promise<NotebookExportDeliveryResult> => {
  const canShareFiles =
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({
      files: [artifact.file],
    })

  if (canShareFiles) {
    try {
      await navigator.share({
        title: artifact.file.name.replace(/\.html$/i, ''),
        text: 'Экспорт заметки для Apple Notes',
        files: [artifact.file],
      })

      return {
        kind: 'shared',
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return {
          kind: 'cancelled',
        }
      }
    }
  }

  const objectUrl = URL.createObjectURL(artifact.file)
  const link = document.createElement('a')

  link.href = objectUrl
  link.download = artifact.file.name
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()

  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl)
  }, 1000)

  return {
    kind: 'downloaded',
  }
}
