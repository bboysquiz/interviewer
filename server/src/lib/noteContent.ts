import { createId } from './text.js'

export interface NoteTextContentBlock {
  id: string
  type: 'text'
  text: string
}

export interface NoteCodeContentBlock {
  id: string
  type: 'code'
  language: 'html' | 'css' | 'js' | 'vue' | 'ts'
  code: string
}

export interface NoteImageContentBlock {
  id: string
  type: 'image'
  attachmentId: string
}

export type NoteContentBlock =
  | NoteTextContentBlock
  | NoteCodeContentBlock
  | NoteImageContentBlock

const normalizeText = (value: string): string => value.replace(/\r\n?/g, '\n')

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const toTextBlock = (text: string): NoteTextContentBlock => ({
  id: createId(),
  type: 'text',
  text: normalizeText(text),
})

const toImageBlock = (attachmentId: string): NoteImageContentBlock => ({
  id: createId(),
  type: 'image',
  attachmentId,
})

export const buildLegacyNoteContentBlocks = (
  rawText: string,
  attachmentIds: string[] = [],
): NoteContentBlock[] => {
  const normalizedText = normalizeText(rawText).trim()
  const blocks: NoteContentBlock[] = []

  if (normalizedText) {
    blocks.push(toTextBlock(normalizedText))
  }

  for (const attachmentId of attachmentIds.filter(Boolean)) {
    blocks.push(toImageBlock(attachmentId))
  }

  if (blocks.length === 0) {
    blocks.push(toTextBlock(''))
  }

  return blocks
}

const sanitizeContentBlock = (value: unknown): NoteContentBlock | null => {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return null
  }

  if (value.type === 'text' && typeof value.text === 'string') {
    const text = normalizeText(value.text)

    if (!text.trim()) {
      return null
    }

    return {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : createId(),
      type: 'text',
      text,
    }
  }

  if (
    value.type === 'code' &&
    typeof value.code === 'string' &&
    typeof value.language === 'string' &&
    ['html', 'css', 'js', 'vue', 'ts'].includes(value.language)
  ) {
    return {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : createId(),
      type: 'code',
      language: value.language as NoteCodeContentBlock['language'],
      code: normalizeText(value.code),
    }
  }

  if (
    value.type === 'image' &&
    typeof value.attachmentId === 'string' &&
    value.attachmentId.trim()
  ) {
    return {
      id: typeof value.id === 'string' && value.id.trim() ? value.id : createId(),
      type: 'image',
      attachmentId: value.attachmentId,
    }
  }

  return null
}

export const parseNoteContentBlocks = (
  rawValue: unknown,
  fallbackText = '',
  attachmentIds: string[] = [],
): NoteContentBlock[] => {
  const value =
    typeof rawValue === 'string' && rawValue.trim()
      ? (() => {
          try {
            return JSON.parse(rawValue) as unknown
          } catch {
            return null
          }
        })()
      : rawValue

  if (!Array.isArray(value)) {
    return buildLegacyNoteContentBlocks(fallbackText, attachmentIds)
  }

  const blocks = value
    .map((block) => sanitizeContentBlock(block))
    .filter((block): block is NoteContentBlock => block !== null)

  // Respect the stored block list as the source of truth. Notes may keep
  // attachment records for undo/history, but removed screenshots must not be
  // resurrected into the visible canvas on the next load.
  return blocks
}

export const serializeNoteContentBlocks = (
  blocks: NoteContentBlock[],
): string => JSON.stringify(blocks)

export const extractAttachmentIdsFromContentBlocks = (
  blocks: NoteContentBlock[],
): string[] =>
  blocks
    .filter((block): block is NoteImageContentBlock => block.type === 'image')
    .map((block) => block.attachmentId)

export const deriveRawTextFromContentBlocks = (
  blocks: NoteContentBlock[],
): string =>
  blocks
    .map((block) => {
      if (block.type === 'text') {
        return block.text.trim()
      }

      if (block.type === 'code') {
        const normalizedCode = block.code.trim()

        if (!normalizedCode) {
          return ''
        }

        return `\`\`\`${block.language}\n${normalizedCode}\n\`\`\``
      }

      return ''
    })
    .filter(Boolean)
    .join('\n\n')
