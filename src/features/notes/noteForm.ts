import type {
  CreateNoteInput,
  UpdateNoteInput,
} from '@/services/client/knowledgeBaseApi'
import type { Note, NoteContentBlock } from '@/types'
import {
  DEFAULT_CODE_BLOCK_LANGUAGE,
  hasMeaningfulEditorText,
  normalizeEditorText,
  serializeTextAndCodeBlocksToPlainText,
  type CodeBlockLanguage,
} from '@/features/editor/codeBlocks'

export interface NoteFormTextBlock {
  id: string
  type: 'text'
  text: string
}

export interface NoteFormCodeBlock {
  id: string
  type: 'code'
  language: CodeBlockLanguage
  code: string
}

export interface NoteFormImageBlock {
  id: string
  type: 'image'
  attachmentId: string | null
  fileName: string
  localPreviewUrl: string | null
  uploadFile: File | null
}

export type NoteFormBlock =
  | NoteFormTextBlock
  | NoteFormCodeBlock
  | NoteFormImageBlock

export interface NoteFormValues {
  title: string
  blocks: NoteFormBlock[]
}

export interface NoteFormSnapshot {
  title: string
  blocks: Array<
    | {
        id: string
        type: 'text'
        text: string
      }
    | {
        id: string
        type: 'code'
        language: CodeBlockLanguage
        code: string
      }
    | {
        id: string
        type: 'image'
        attachmentId: string | null
        fileName: string
        localPreviewUrl: string | null
        uploadFile: File | null
      }
  >
}

const createFallbackImageFileName = (file: File): string => {
  const extension = file.type.replace(/^image\//, '').split('+')[0] || 'png'
  return `pasted-screenshot-${Date.now()}.${extension}`
}

const ensureNamedImageFile = (file: File): File => {
  if (file.name.trim().length > 0) {
    return file
  }

  return new File([file], createFallbackImageFileName(file), {
    type: file.type || 'image/png',
    lastModified: Date.now(),
  })
}

const createBlockId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `block-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export const createTextBlock = (
  text = '',
  id = createBlockId(),
): NoteFormTextBlock => ({
  id,
  type: 'text',
  text,
})

export const createCodeBlock = (
  code = '',
  language: CodeBlockLanguage = DEFAULT_CODE_BLOCK_LANGUAGE,
  id = createBlockId(),
): NoteFormCodeBlock => ({
  id,
  type: 'code',
  language,
  code,
})

export const createImageBlockFromFile = (
  file: File,
  id = createBlockId(),
): NoteFormImageBlock => {
  const normalizedFile = ensureNamedImageFile(file)

  return {
    id,
    type: 'image',
    attachmentId: null,
    fileName: normalizedFile.name,
    localPreviewUrl: URL.createObjectURL(normalizedFile),
    uploadFile: normalizedFile,
  }
}

export const createImageBlockFromAttachment = (
  attachmentId: string,
  fileName = '',
  id = createBlockId(),
): NoteFormImageBlock => ({
  id,
  type: 'image',
  attachmentId,
  fileName,
  localPreviewUrl: null,
  uploadFile: null,
})

export const revokeBlockPreviewUrl = (block: NoteFormBlock): void => {
  if (block.type === 'image' && block.localPreviewUrl) {
    URL.revokeObjectURL(block.localPreviewUrl)
  }
}

export const revokeFormPreviewUrls = (value: NoteFormValues): void => {
  for (const block of value.blocks) {
    revokeBlockPreviewUrl(block)
  }
}

export const normalizeNoteFormBlocks = (
  blocks: NoteFormBlock[],
): NoteFormBlock[] => {
  const normalized = blocks.filter((block, index) => {
    if (block.type === 'image') {
      return Boolean(block.attachmentId || block.uploadFile)
    }

    if (block.type === 'code') {
      return block.code.trim().length > 0
    }

    const isMeaningful = hasMeaningfulEditorText(block.text)

    if (isMeaningful) {
      return true
    }

    const hasImageBefore = blocks
      .slice(0, index)
      .some((currentBlock) => currentBlock.type === 'image')
    const hasImageAfter = blocks
      .slice(index + 1)
      .some((currentBlock) => currentBlock.type === 'image')

    return hasImageBefore && hasImageAfter
  })

  if (normalized.length === 0) {
    return [createTextBlock()]
  }

  return normalized
}

export const hasNoteFormContent = (value: NoteFormValues): boolean =>
  normalizeNoteFormBlocks(value.blocks).some((block) =>
    block.type === 'image'
      ? true
      : block.type === 'code'
        ? block.code.trim().length > 0
        : hasMeaningfulEditorText(block.text),
  )

export const createEmptyNoteForm = (): NoteFormValues => ({
  title: '',
  blocks: [createTextBlock()],
})

export const cloneNoteFormValues = (
  value: NoteFormValues,
): NoteFormValues => ({
  title: value.title,
  blocks: value.blocks.map((block) =>
    block.type === 'text'
      ? {
          ...block,
        }
      : block.type === 'code'
        ? {
            ...block,
          }
      : {
          ...block,
          attachmentId: block.attachmentId,
          localPreviewUrl: block.localPreviewUrl,
          uploadFile: block.uploadFile,
        },
  ),
})

const createCanonicalFingerprintBlocks = (
  blocks: NoteFormBlock[],
): Array<
  | {
      type: 'text'
      text: string
    }
  | {
      type: 'code'
      language: CodeBlockLanguage
      code: string
    }
  | {
      type: 'image'
      attachmentId: string | null
      fileName: string
      uploadFile:
        | null
        | {
            name: string
            size: number
            type: string
            lastModified: number
          }
    }
> => {
  const canonicalBlocks: Array<
    | {
        type: 'text'
        text: string
      }
    | {
        type: 'code'
        language: CodeBlockLanguage
        code: string
      }
    | {
        type: 'image'
        attachmentId: string | null
        fileName: string
        uploadFile:
          | null
          | {
              name: string
              size: number
              type: string
              lastModified: number
            }
      }
  > = []

  for (const block of blocks) {
    if (block.type === 'text') {
      const text = normalizeEditorText(block.text)

      if (!hasMeaningfulEditorText(text)) {
        continue
      }

      const previousBlock = canonicalBlocks[canonicalBlocks.length - 1]

      if (previousBlock?.type === 'text') {
        previousBlock.text += text
        continue
      }

      canonicalBlocks.push({
        type: 'text',
        text,
      })
      continue
    }

    if (block.type === 'code') {
      const code = normalizeEditorText(block.code)

      if (code.trim().length === 0) {
        continue
      }

      canonicalBlocks.push({
        type: 'code',
        language: block.language,
        code,
      })
      continue
    }

    if (!block.attachmentId && !block.uploadFile) {
      continue
    }

    canonicalBlocks.push({
      type: 'image',
      attachmentId: block.attachmentId,
      fileName: block.fileName,
      uploadFile:
        block.uploadFile === null
          ? null
          : {
              name: block.uploadFile.name,
              size: block.uploadFile.size,
              type: block.uploadFile.type,
              lastModified: block.uploadFile.lastModified,
            },
    })
  }

  return canonicalBlocks
}

export const createNoteFormFingerprint = (value: NoteFormValues): string =>
  JSON.stringify({
    title: value.title,
    blocks: createCanonicalFingerprintBlocks(value.blocks),
  })

export const createNoteFormFromNote = (note: Note): NoteFormValues => ({
  title: note.title,
  blocks: (() => {
    const blocks =
      note.contentBlocks.length > 0
        ? note.contentBlocks.map((block) =>
            block.type === 'text'
              ? createTextBlock(block.text, block.id)
              : block.type === 'code'
                ? createCodeBlock(block.code, block.language, block.id)
              : createImageBlockFromAttachment(block.attachmentId, '', block.id),
          )
        : [createTextBlock(note.rawText)]

    if (blocks[blocks.length - 1]?.type !== 'text') {
      blocks.push(createTextBlock())
    }

    return blocks
  })(),
})

export const buildPlainTextFromBlocks = (blocks: NoteFormBlock[]): string =>
  serializeTextAndCodeBlocksToPlainText(
    normalizeNoteFormBlocks(blocks).filter(
      (block): block is NoteFormTextBlock | NoteFormCodeBlock =>
        block.type === 'text' || block.type === 'code',
    ),
  )

export const toPersistedContentBlocks = (
  blocks: NoteFormBlock[],
): NoteContentBlock[] =>
  normalizeNoteFormBlocks(blocks)
    .map((block): NoteContentBlock | null => {
      if (block.type === 'text') {
        const text = normalizeEditorText(block.text)

        if (!hasMeaningfulEditorText(text)) {
          return null
        }

        return {
          id: block.id,
          type: 'text',
          text,
        }
      }

      if (block.type === 'code') {
        return {
          id: block.id,
          type: 'code',
          language: block.language,
          code: normalizeEditorText(block.code),
        }
      }

      if (!block.attachmentId) {
        return null
      }

      return {
        id: block.id,
        type: 'image',
        attachmentId: block.attachmentId,
      }
    })
    .filter((block): block is NoteContentBlock => block !== null)

export const applyUploadedAttachmentsToBlocks = (
  blocks: NoteFormBlock[],
  uploadedAttachmentIdsByBlockId: Map<string, { attachmentId: string; fileName: string }>,
): NoteFormBlock[] =>
  blocks.map((block) => {
    if (block.type !== 'image') {
      return block
    }

    const uploaded = uploadedAttachmentIdsByBlockId.get(block.id)

    if (!uploaded) {
      return block
    }

    revokeBlockPreviewUrl(block)

    return {
      ...block,
      attachmentId: uploaded.attachmentId,
      fileName: uploaded.fileName,
      localPreviewUrl: null,
      uploadFile: null,
    }
  })

export const toCreateNoteInput = (
  categoryId: string,
  values: NoteFormValues,
): CreateNoteInput => ({
  categoryId,
  title: values.title.trim(),
  rawText: buildPlainTextFromBlocks(values.blocks),
  contentBlocks: toPersistedContentBlocks(values.blocks),
})

export const toUpdateNoteInput = (
  values: NoteFormValues,
): UpdateNoteInput => ({
  title: values.title.trim(),
  rawText: buildPlainTextFromBlocks(values.blocks),
  contentBlocks: toPersistedContentBlocks(values.blocks),
})
