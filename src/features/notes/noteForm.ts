import type {
  CreateNoteInput,
  UpdateNoteInput,
} from '@/services/client/knowledgeBaseApi'
import type { Note, NoteContentBlock } from '@/types'

export interface NoteFormTextBlock {
  id: string
  type: 'text'
  text: string
}

export interface NoteFormImageBlock {
  id: string
  type: 'image'
  attachmentId: string | null
  fileName: string
  localPreviewUrl: string | null
  uploadFile: File | null
}

export type NoteFormBlock = NoteFormTextBlock | NoteFormImageBlock

export interface NoteFormValues {
  title: string
  blocks: NoteFormBlock[]
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

const normalizeTextBlockValue = (value: string): string =>
  value.replace(/\r\n?/g, '\n')

const hasMeaningfulText = (value: string): boolean =>
  normalizeTextBlockValue(value).trim().length > 0

export const createTextBlock = (
  text = '',
  id = createBlockId(),
): NoteFormTextBlock => ({
  id,
  type: 'text',
  text,
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

    const isMeaningful = hasMeaningfulText(block.text)

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
    block.type === 'image' ? true : hasMeaningfulText(block.text),
  )

export const createEmptyNoteForm = (): NoteFormValues => ({
  title: '',
  blocks: [createTextBlock()],
})

export const createNoteFormFromNote = (note: Note): NoteFormValues => ({
  title: note.title,
  blocks: (() => {
    const blocks =
      note.contentBlocks.length > 0
        ? note.contentBlocks.map((block) =>
            block.type === 'text'
              ? createTextBlock(block.text, block.id)
              : createImageBlockFromAttachment(block.attachmentId, '', block.id),
          )
        : [createTextBlock(note.rawText)]

    if (blocks[blocks.length - 1]?.type === 'image') {
      blocks.push(createTextBlock())
    }

    return blocks
  })(),
})

export const buildPlainTextFromBlocks = (blocks: NoteFormBlock[]): string =>
  normalizeNoteFormBlocks(blocks)
    .filter((block): block is NoteFormTextBlock => block.type === 'text')
    .map((block) => normalizeTextBlockValue(block.text).trim())
    .filter(Boolean)
    .join('\n\n')

export const toPersistedContentBlocks = (
  blocks: NoteFormBlock[],
): NoteContentBlock[] =>
  normalizeNoteFormBlocks(blocks)
    .map((block): NoteContentBlock | null => {
      if (block.type === 'text') {
        const text = normalizeTextBlockValue(block.text)

        if (!hasMeaningfulText(text)) {
          return null
        }

        return {
          id: block.id,
          type: 'text',
          text,
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
