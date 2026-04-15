<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import {
  CODE_BLOCK_LANGUAGE_OPTIONS,
  DEFAULT_CODE_BLOCK_LANGUAGE,
  normalizeEditorText,
  type CodeBlockLanguage,
} from '@/features/editor/codeBlocks'
import { openImageViewer } from '@/features/images/imageViewer'
import {
  createCodeBlock,
  createImageBlockFromFile,
  createTextBlock,
  revokeBlockPreviewUrl,
  type NoteFormBlock,
  type NoteFormImageBlock,
  type NoteFormTextBlock,
  type NoteFormValues,
} from '@/features/notes/noteForm'
import { buildApiUrl } from '@/services/client/http'
import { probeClipboardAvailability, readClipboardContent } from '@/shared/lib/clipboard'
import ConfirmSheet from '@/shared/ui/ConfirmSheet.vue'
import EditorContextMenu from '@/shared/ui/EditorContextMenu.vue'
import type { Attachment } from '@/types'

interface EditorSelectionSnapshot {
  blockId: string
  selectionStart: number
  selectionEnd: number
}

interface SearchFocusTarget {
  blockId: string
  selectionStart?: number | null
  selectionEnd?: number | null
  focus?: boolean
}

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  blockId: string | null
  clipboardHasText: boolean
  clipboardHasImage: boolean
}

const form = defineModel<NoteFormValues>({ required: true })

const props = withDefaults(
  defineProps<{
    submitLabel?: string
    isSubmitting?: boolean
    errorMessage?: string | null
    cancelLabel?: string
    showCancel?: boolean
    showSubmit?: boolean
    attachmentsById?: Record<string, Attachment>
    hideTitle?: boolean
    immersive?: boolean
    contentLabel?: string | null
    contentHint?: string | null
    statusLabel?: string | null
    statusTone?: 'saved' | 'unsaved' | 'saving' | 'error'
    showUndo?: boolean
    canUndo?: boolean
    undoLabel?: string
    showClear?: boolean
    clearLabel?: string
    matchedBlockIds?: string[]
    activeSearchBlockId?: string | null
  }>(),
  {
    isSubmitting: false,
    errorMessage: null,
    cancelLabel: 'Отмена',
    showCancel: false,
    showSubmit: true,
    attachmentsById: () => ({}),
    hideTitle: false,
    immersive: false,
    contentLabel: 'Содержимое заметки',
    contentHint:
      'Пиши текст в одном полотне, вставляй скриншоты через Ctrl+V или кнопкой снизу. Картинку можно убрать клавишей Backspace.',
    statusLabel: null,
    statusTone: 'saved',
    showUndo: false,
    canUndo: false,
    showClear: false,
    undoLabel: 'Отменить',
    clearLabel: 'Очистить всё',
    matchedBlockIds: () => [],
    activeSearchBlockId: null,
  },
)

const emit = defineEmits<{
  submit: []
  cancel: []
  undo: []
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const pickerError = ref<string | null>(null)
const textEditors = new Map<string, HTMLTextAreaElement>()
const segmentElements = new Map<string, HTMLElement>()
const lastSelection = ref<EditorSelectionSnapshot | null>(null)
const selectedImageBlockId = ref<string | null>(null)
const isCanvasSelectAllActive = ref(false)
const isClearConfirmOpen = ref(false)
const pendingFileInsertSelection = ref<EditorSelectionSnapshot | null>(null)
const contextMenu = ref<ContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  blockId: null,
  clipboardHasText: false,
  clipboardHasImage: false,
})

const hasBlocks = computed(() => form.value.blocks.length > 0)
const matchedBlockIdSet = computed(() => new Set(props.matchedBlockIds ?? []))
const codeLanguageOptions = CODE_BLOCK_LANGUAGE_OPTIONS
const showCanvasToolbar = computed(
  () => Boolean(props.statusLabel) || props.showUndo || props.showClear,
)
const showFooterActions = computed(() => props.showSubmit || props.showCancel)
const contextMenuActions = computed(() => [
  {
    id: 'paste',
    label: 'Вставить',
    disabled:
      !contextMenu.value.clipboardHasText && !contextMenu.value.clipboardHasImage,
  },
  {
    id: 'add-image',
    label: 'Добавить картинку',
    disabled: false,
  },
  {
    id: 'add-code',
    label: 'Написать код',
    disabled: false,
  },
])

const attachmentForBlock = (block: NoteFormImageBlock): Attachment | null =>
  block.attachmentId ? props.attachmentsById[block.attachmentId] ?? null : null

const imageBlockAnalysisStatus = (
  block: NoteFormImageBlock,
): {
  label: string
  tone: 'pending' | 'processing' | 'ready' | 'failed'
} => {
  if (block.uploadFile) {
    return {
      label: 'Не сохранён',
      tone: 'pending',
    }
  }

  const attachment = attachmentForBlock(block)

  if (!attachment) {
    return {
      label: 'Без AI-анализа',
      tone: 'pending',
    }
  }

  switch (attachment.processingStatus) {
    case 'ready':
      return {
        label: 'AI проанализировал',
        tone: 'ready',
      }
    case 'processing':
      return {
        label: 'AI анализирует',
        tone: 'processing',
      }
    case 'failed':
      return {
        label: 'Ошибка AI-анализа',
        tone: 'failed',
      }
    case 'pending':
    default:
      return {
        label: 'Ждёт AI-анализа',
        tone: 'pending',
      }
  }
}

const attachmentPreviewUrl = (block: NoteFormImageBlock): string | null => {
  if (block.localPreviewUrl) {
    return block.localPreviewUrl
  }

  const attachment = attachmentForBlock(block)
  return attachment ? buildApiUrl(attachment.storagePath) : null
}

const resetCanvasSelectAll = (): void => {
  isCanvasSelectAllActive.value = false
}

const createSelectionSnapshot = (
  blockId: string,
  editor: HTMLTextAreaElement,
): EditorSelectionSnapshot => ({
  blockId,
  selectionStart: editor.selectionStart ?? editor.value.length,
  selectionEnd: editor.selectionEnd ?? editor.selectionStart ?? editor.value.length,
})

const syncTextEditorHeight = (editor: HTMLTextAreaElement): void => {
  editor.style.height = '0px'
  editor.style.height = `${Math.max(editor.scrollHeight, 32)}px`
}

const createEditorBlocks = (blocks: NoteFormBlock[]): NoteFormBlock[] => {
  const merged: NoteFormBlock[] = []

  for (const block of blocks) {
    if (block.type === 'image') {
      if (block.attachmentId || block.uploadFile) {
        merged.push(block)
      }

      continue
    }

    if (block.type === 'code') {
      merged.push({
        ...block,
      })
      continue
    }

    const previousBlock = merged[merged.length - 1]

    if (previousBlock?.type === 'text') {
      merged[merged.length - 1] = {
        ...previousBlock,
        text: previousBlock.text + block.text,
      }
      continue
    }

    merged.push({
      ...block,
    })
  }

  if (merged.length === 0) {
    return [createTextBlock()]
  }

  const withInsertionPoints: NoteFormBlock[] = []

  if (merged[0]?.type !== 'text') {
    withInsertionPoints.push(createTextBlock())
  }

  merged.forEach((block, index) => {
    withInsertionPoints.push(block)

    if (block.type === 'text') {
      return
    }

    const nextBlock = merged[index + 1]

    if (!nextBlock || nextBlock.type !== 'text') {
      withInsertionPoints.push(createTextBlock())
    }
  })

  return withInsertionPoints
}

const createBlockStructureSignature = (blocks: NoteFormBlock[]): string =>
  blocks.map((block) => `${block.id}:${block.type}`).join('|')

const replaceBlocks = (blocks: NoteFormBlock[]): void => {
  form.value = {
    ...form.value,
    blocks: createEditorBlocks(blocks),
  }
}

const closeContextMenu = (): void => {
  contextMenu.value = {
    open: false,
    x: 0,
    y: 0,
    blockId: null,
    clipboardHasText: false,
    clipboardHasImage: false,
  }
}

const findBlockIndexById = (blockId: string): number =>
  form.value.blocks.findIndex((block) => block.id === blockId)

const registerSegmentElement = (blockId: string, element: Element | null): void => {
  if (element instanceof HTMLElement) {
    segmentElements.set(blockId, element)
    return
  }

  segmentElements.delete(blockId)
}

const registerTextEditor = (blockId: string, element: Element | null): void => {
  if (element instanceof HTMLTextAreaElement) {
    textEditors.set(blockId, element)
    syncTextEditorHeight(element)
    return
  }

  textEditors.delete(blockId)
}

const isInsertionPointTextBlock = (blockIndex: number): boolean => {
  const block = form.value.blocks[blockIndex]

  if (!block || block.type !== 'text') {
    return false
  }

  if (normalizeEditorText(block.text).trim().length > 0) {
    return false
  }

  const previousBlock = form.value.blocks[blockIndex - 1]
  const nextBlock = form.value.blocks[blockIndex + 1]

  return previousBlock?.type !== 'text' || nextBlock?.type !== 'text'
}

const scrollBlockIntoView = (blockId: string): void => {
  const segment = segmentElements.get(blockId)

  if (!segment) {
    return
  }

  segment.scrollIntoView({
    behavior: 'smooth',
    block: 'center',
  })
}

const focusTextBlock = async (
  blockId: string,
  caretPosition = 0,
): Promise<void> => {
  await nextTick()

  const editor = textEditors.get(blockId)

  if (!editor) {
    return
  }

  syncTextEditorHeight(editor)
  editor.focus()
  resetCanvasSelectAll()

  const nextCaret = Math.max(0, Math.min(caretPosition, editor.value.length))
  editor.setSelectionRange(nextCaret, nextCaret)
  lastSelection.value = {
    blockId,
    selectionStart: nextCaret,
    selectionEnd: nextCaret,
  }
  selectedImageBlockId.value = null
  scrollBlockIntoView(blockId)
}

const rememberSelection = (blockId: string, event: Event): void => {
  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  syncTextEditorHeight(target)
  resetCanvasSelectAll()
  lastSelection.value = createSelectionSnapshot(blockId, target)
  selectedImageBlockId.value = null
}

const focusInsertionPoint = async (
  blockId: string,
  event: MouseEvent | PointerEvent,
): Promise<void> => {
  const target = event.target

  if (target instanceof HTMLTextAreaElement) {
    return
  }

  await focusTextBlock(blockId, 0)
}

const handleTextInput = (blockId: string, event: Event): void => {
  rememberSelection(blockId, event)
}

const handleCodeInput = (blockId: string, event: Event): void => {
  rememberSelection(blockId, event)
}

const selectImageBlock = (blockId: string): void => {
  resetCanvasSelectAll()
  selectedImageBlockId.value = blockId
}

const canInsertAfterBlock = (blockIndex: number): boolean => {
  const block = form.value.blocks[blockIndex]
  const nextBlock = form.value.blocks[blockIndex + 1]

  if (!block || block.type === 'text') {
    return false
  }

  return Boolean(nextBlock && nextBlock.type !== 'text')
}

const insertTextBlockAfter = async (blockIndex: number): Promise<void> => {
  const block = form.value.blocks[blockIndex]

  if (!block) {
    return
  }

  const nextBlocks = [...form.value.blocks]
  const nextTextBlock = createTextBlock()

  nextBlocks.splice(blockIndex + 1, 0, nextTextBlock)
  replaceBlocks(nextBlocks)
  await focusTextBlock(nextTextBlock.id, 0)
}

const clearCanvasContent = async (): Promise<void> => {
  for (const block of form.value.blocks) {
    revokeBlockPreviewUrl(block)
  }

  const emptyBlock = createTextBlock()
  replaceBlocks([emptyBlock])
  selectedImageBlockId.value = null
  lastSelection.value = null
  resetCanvasSelectAll()
  await focusTextBlock(emptyBlock.id, 0)
}

const requestClearCanvas = (): void => {
  if (props.isSubmitting) {
    return
  }

  isClearConfirmOpen.value = true
}

const closeClearCanvasConfirm = (): void => {
  isClearConfirmOpen.value = false
}

const confirmClearCanvas = async (): Promise<void> => {
  isClearConfirmOpen.value = false
  await clearCanvasContent()
}

const handleCanvasKeydown = async (event: KeyboardEvent): Promise<void> => {
  if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    isCanvasSelectAllActive.value = true
    selectedImageBlockId.value = null
    lastSelection.value = null
    return
  }

  if (!isCanvasSelectAllActive.value) {
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    await clearCanvasContent()
    return
  }

  if (event.key === 'Escape') {
    event.preventDefault()
    resetCanvasSelectAll()
  }
}

const openImageBlockViewer = (block: NoteFormImageBlock): void => {
  selectImageBlock(block.id)

  const previewUrl = attachmentPreviewUrl(block)

  if (!previewUrl) {
    return
  }

  const attachment = attachmentForBlock(block)
  const imageLabel =
    block.fileName || attachment?.originalFileName || 'Скриншот заметки'

  openImageViewer({
    src: previewUrl,
    alt: imageLabel,
    title: imageLabel,
  })
}

const handleImageClick = (block: NoteFormImageBlock): void => {
  if (selectedImageBlockId.value === block.id) {
    openImageBlockViewer(block)
    return
  }

  selectImageBlock(block.id)
}

const insertImagesAtSelection = (
  selection: EditorSelectionSnapshot,
  files: File[],
): { blockId: string; caretPosition: number } | null => {
  const blockIndex = findBlockIndexById(selection.blockId)
  const block = form.value.blocks[blockIndex]

  if (!block || block.type !== 'text') {
    return null
  }

  const safeStart = Math.max(
    0,
    Math.min(selection.selectionStart, block.text.length),
  )
  const safeEnd = Math.max(
    safeStart,
    Math.min(selection.selectionEnd, block.text.length),
  )
  const beforeText = block.text.slice(0, safeStart)
  const afterText = block.text.slice(safeEnd)
  const nextSibling = form.value.blocks[blockIndex + 1]
  const replacementBlocks: NoteFormBlock[] = []

  if (beforeText.length > 0) {
    replacementBlocks.push({
      ...block,
      text: beforeText,
    })
  }

  replacementBlocks.push(...files.map((file) => createImageBlockFromFile(file)))

  let focusTarget: { blockId: string; caretPosition: number } | null = null

  if (afterText.length > 0) {
    const trailingTextBlock = createTextBlock(afterText)
    replacementBlocks.push(trailingTextBlock)
    focusTarget = {
      blockId: trailingTextBlock.id,
      caretPosition: 0,
    }
  } else if (nextSibling?.type === 'text') {
    focusTarget = {
      blockId: nextSibling.id,
      caretPosition: 0,
    }
  } else {
    const trailingTextBlock = createTextBlock()
    replacementBlocks.push(trailingTextBlock)
    focusTarget = {
      blockId: trailingTextBlock.id,
      caretPosition: 0,
    }
  }

  const nextBlocks = [...form.value.blocks]
  nextBlocks.splice(blockIndex, 1, ...replacementBlocks)
  replaceBlocks(nextBlocks)

  return focusTarget
}

const appendImagesToEnd = (
  files: File[],
): { blockId: string; caretPosition: number } => {
  const nextBlocks = [...form.value.blocks]
  const imageBlocks = files.map((file) => createImageBlockFromFile(file))
  const lastBlock = nextBlocks[nextBlocks.length - 1]

  if (lastBlock?.type === 'text' && lastBlock.text.length === 0) {
    nextBlocks.splice(nextBlocks.length - 1, 0, ...imageBlocks)
    replaceBlocks(nextBlocks)

    return {
      blockId: lastBlock.id,
      caretPosition: 0,
    }
  }

  const trailingTextBlock = createTextBlock()
  nextBlocks.push(...imageBlocks, trailingTextBlock)
  replaceBlocks(nextBlocks)

  return {
    blockId: trailingTextBlock.id,
    caretPosition: 0,
  }
}

const insertTextIntoBlock = (
  selection: EditorSelectionSnapshot,
  text: string,
): { blockId: string; caretPosition: number } | null => {
  const blockIndex = findBlockIndexById(selection.blockId)
  const block = form.value.blocks[blockIndex]

  if (!block || (block.type !== 'text' && block.type !== 'code')) {
    return null
  }

  const currentValue = block.type === 'text' ? block.text : block.code
  const safeStart = Math.max(0, Math.min(selection.selectionStart, currentValue.length))
  const safeEnd = Math.max(safeStart, Math.min(selection.selectionEnd, currentValue.length))
  const nextValue =
    currentValue.slice(0, safeStart) + text + currentValue.slice(safeEnd)
  const nextBlocks = [...form.value.blocks]

  nextBlocks[blockIndex] =
    block.type === 'text'
      ? {
          ...block,
          text: nextValue,
        }
      : {
          ...block,
          code: nextValue,
        }

  replaceBlocks(nextBlocks)

  return {
    blockId: block.id,
    caretPosition: safeStart + text.length,
  }
}

const insertCodeBlockAtSelection = (
  selection: EditorSelectionSnapshot,
  language: CodeBlockLanguage = DEFAULT_CODE_BLOCK_LANGUAGE,
): { blockId: string; caretPosition: number } | null => {
  const blockIndex = findBlockIndexById(selection.blockId)
  const block = form.value.blocks[blockIndex]

  if (!block) {
    return null
  }

  if (block.type === 'code') {
    const nextBlocks = [...form.value.blocks]
    const nextCodeBlock = createCodeBlock('', language)
    const trailingTextBlock = createTextBlock()

    nextBlocks.splice(blockIndex + 1, 0, nextCodeBlock, trailingTextBlock)
    replaceBlocks(nextBlocks)

    return {
      blockId: nextCodeBlock.id,
      caretPosition: 0,
    }
  }

  if (block.type !== 'text') {
    return null
  }

  const safeStart = Math.max(0, Math.min(selection.selectionStart, block.text.length))
  const safeEnd = Math.max(safeStart, Math.min(selection.selectionEnd, block.text.length))
  const beforeText = block.text.slice(0, safeStart)
  const afterText = block.text.slice(safeEnd)
  const replacementBlocks: NoteFormBlock[] = []

  if (beforeText.length > 0) {
    replacementBlocks.push({
      ...block,
      text: beforeText,
    })
  }

  const nextCodeBlock = createCodeBlock('', language)
  replacementBlocks.push(nextCodeBlock)

  if (afterText.length > 0) {
    replacementBlocks.push(createTextBlock(afterText))
  } else {
    replacementBlocks.push(createTextBlock())
  }

  const nextBlocks = [...form.value.blocks]
  nextBlocks.splice(blockIndex, 1, ...replacementBlocks)
  replaceBlocks(nextBlocks)

  return {
    blockId: nextCodeBlock.id,
    caretPosition: 0,
  }
}

const removeCodeBlock = async (blockId: string): Promise<void> => {
  const blockIndex = findBlockIndexById(blockId)
  const block = form.value.blocks[blockIndex]

  if (!block || block.type !== 'code') {
    return
  }

  const previousBlock = form.value.blocks[blockIndex - 1]
  const nextBlock = form.value.blocks[blockIndex + 1]
  const nextBlocks = [...form.value.blocks]

  if (previousBlock?.type === 'text' && nextBlock?.type === 'text') {
    nextBlocks.splice(blockIndex - 1, 3, {
      ...previousBlock,
      text: previousBlock.text + nextBlock.text,
    })
    replaceBlocks(nextBlocks)
    await focusTextBlock(previousBlock.id, previousBlock.text.length)
    return
  }

  nextBlocks.splice(blockIndex, 1)
  replaceBlocks(nextBlocks)

  const fallbackTextBlock = form.value.blocks.find(
    (candidate): candidate is NoteFormTextBlock => candidate.type === 'text',
  )

  if (fallbackTextBlock) {
    await focusTextBlock(fallbackTextBlock.id, fallbackTextBlock.text.length)
  }
}

const openFilePicker = (): void => {
  pickerError.value = null
  resetCanvasSelectAll()
  closeContextMenu()
  fileInput.value?.click()
}

const handleFileSelection = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const selectedFiles = Array.from(input.files ?? [])

  if (selectedFiles.length === 0) {
    input.value = ''
    return
  }

  const imageFiles = selectedFiles.filter((file) => file.type.startsWith('image/'))

  if (imageFiles.length !== selectedFiles.length) {
    pickerError.value = 'Можно добавить только изображения.'
    input.value = ''
    return
  }

  const selection = lastSelection.value
  const preferredSelection = pendingFileInsertSelection.value
  const focusTarget =
    preferredSelection && findBlockIndexById(preferredSelection.blockId) >= 0
      ? insertImagesAtSelection(preferredSelection, imageFiles) ?? appendImagesToEnd(imageFiles)
      : selection && findBlockIndexById(selection.blockId) >= 0
        ? insertImagesAtSelection(selection, imageFiles) ?? appendImagesToEnd(imageFiles)
      : appendImagesToEnd(imageFiles)

  pickerError.value = null
  resetCanvasSelectAll()
  pendingFileInsertSelection.value = null
  input.value = ''
  await focusTextBlock(focusTarget.blockId, focusTarget.caretPosition)
}

const extractPastedImageFiles = (event: ClipboardEvent): File[] => {
  const filesFromItems = Array.from(event.clipboardData?.items ?? [])
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)

  if (filesFromItems.length > 0) {
    return filesFromItems
  }

  return Array.from(event.clipboardData?.files ?? []).filter((file) =>
    file.type.startsWith('image/'),
  )
}

const handleEditorPaste = async (
  event: ClipboardEvent,
  blockId: string,
): Promise<void> => {
  const pastedImageFiles = extractPastedImageFiles(event)

  if (pastedImageFiles.length === 0) {
    return
  }

  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  event.preventDefault()
  pickerError.value = null
  resetCanvasSelectAll()

  const focusTarget = insertImagesAtSelection(
    createSelectionSnapshot(blockId, target),
    pastedImageFiles,
  )

  if (focusTarget) {
    await focusTextBlock(focusTarget.blockId, focusTarget.caretPosition)
  }
}

const openDesktopContextMenu = async (
  event: MouseEvent,
  blockId: string,
): Promise<void> => {
  if (typeof window === 'undefined') {
    return
  }

  event.preventDefault()
  const target = event.target

  if (target instanceof HTMLTextAreaElement) {
    lastSelection.value = createSelectionSnapshot(blockId, target)
  }

  contextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    blockId,
    clipboardHasText: false,
    clipboardHasImage: false,
  }

  const availability = await probeClipboardAvailability()

  if (!contextMenu.value.open || contextMenu.value.blockId !== blockId) {
    return
  }

  contextMenu.value = {
    ...contextMenu.value,
    clipboardHasText: availability.hasText,
    clipboardHasImage: availability.hasImage,
  }
}

const handleContextMenuAction = async (actionId: string): Promise<void> => {
  const targetBlockId = contextMenu.value.blockId
  closeContextMenu()

  if (!targetBlockId) {
    return
  }

  const selection =
    lastSelection.value?.blockId === targetBlockId
      ? lastSelection.value
      : {
          blockId: targetBlockId,
          selectionStart: 0,
          selectionEnd: 0,
        }

  if (actionId === 'add-image') {
    pendingFileInsertSelection.value = selection
    openFilePicker()
    return
  }

  if (actionId === 'add-code') {
    const focusTarget = insertCodeBlockAtSelection(selection)

    if (focusTarget) {
      await focusTextBlock(focusTarget.blockId, focusTarget.caretPosition)
    }

    return
  }

  if (actionId !== 'paste') {
    return
  }

  const clipboardContent = await readClipboardContent()

  if (clipboardContent.imageFiles.length > 0) {
    const focusTarget =
      insertImagesAtSelection(selection, clipboardContent.imageFiles) ??
      appendImagesToEnd(clipboardContent.imageFiles)
    await focusTextBlock(focusTarget.blockId, focusTarget.caretPosition)
    return
  }

  if (clipboardContent.text) {
    const focusTarget = insertTextIntoBlock(selection, clipboardContent.text)

    if (focusTarget) {
      await focusTextBlock(focusTarget.blockId, focusTarget.caretPosition)
    }
  }
}

const mergeAdjacentTextBlocksAround = async (
  previousBlock: NoteFormTextBlock,
  currentBlock: NoteFormTextBlock,
): Promise<void> => {
  const caretPosition = previousBlock.text.length
  const mergedBlock: NoteFormTextBlock = {
    ...previousBlock,
    text: previousBlock.text + currentBlock.text,
  }
  const previousBlockIndex = findBlockIndexById(previousBlock.id)
  const currentBlockIndex = findBlockIndexById(currentBlock.id)

  if (previousBlockIndex < 0 || currentBlockIndex < 0) {
    return
  }

  const nextBlocks = [...form.value.blocks]
  nextBlocks.splice(previousBlockIndex, currentBlockIndex - previousBlockIndex + 1, mergedBlock)
  replaceBlocks(nextBlocks)
  await focusTextBlock(mergedBlock.id, caretPosition)
}

const handleEditorBackspace = async (
  event: KeyboardEvent,
  blockIndex: number,
): Promise<void> => {
  if (event.key !== 'Backspace') {
    return
  }

  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  const selectionStart = target.selectionStart ?? 0
  const selectionEnd = target.selectionEnd ?? 0

  if (selectionStart !== selectionEnd || selectionStart > 0) {
    return
  }

  const block = form.value.blocks[blockIndex]
  const previousBlock = form.value.blocks[blockIndex - 1]

  if (!block || block.type !== 'text' || !previousBlock) {
    return
  }

  event.preventDefault()

  if (previousBlock.type === 'text') {
    await mergeAdjacentTextBlocksAround(previousBlock, block)
    return
  }

  const previousTextBlock = form.value.blocks[blockIndex - 2]

  if (previousTextBlock?.type === 'text') {
    await mergeAdjacentTextBlocksAround(previousTextBlock, block)
    return
  }

  const nextBlocks = [...form.value.blocks]
  nextBlocks.splice(blockIndex - 1, 1)
  replaceBlocks(nextBlocks)
  await focusTextBlock(block.id, 0)
}

const handleImageBackspace = async (
  event: KeyboardEvent,
  blockIndex: number,
): Promise<void> => {
  if (event.key !== 'Backspace' && event.key !== 'Delete') {
    return
  }

  const block = form.value.blocks[blockIndex]

  if (!block || block.type !== 'image') {
    return
  }

  event.preventDefault()

  const previousBlock = form.value.blocks[blockIndex - 1]
  const nextBlock = form.value.blocks[blockIndex + 1]

  if (previousBlock?.type === 'text' && nextBlock?.type === 'text') {
    await mergeAdjacentTextBlocksAround(previousBlock, nextBlock)
    return
  }

  const nextBlocks = [...form.value.blocks]
  nextBlocks.splice(blockIndex, 1)
  replaceBlocks(nextBlocks)
  selectedImageBlockId.value = null

  if (nextBlock?.type === 'text') {
    await focusTextBlock(nextBlock.id, 0)
    return
  }

  if (previousBlock?.type === 'text') {
    await focusTextBlock(previousBlock.id, previousBlock.text.length)
    return
  }

  const fallbackBlock = form.value.blocks.find(
    (candidateBlock): candidateBlock is NoteFormTextBlock =>
      candidateBlock.type === 'text',
  )

  if (fallbackBlock) {
    await focusTextBlock(fallbackBlock.id, 0)
  }
}

const handleImageKeydown = async (
  event: KeyboardEvent,
  blockIndex: number,
  block: NoteFormImageBlock,
): Promise<void> => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    openImageBlockViewer(block)
    return
  }

  await handleImageBackspace(event, blockIndex)
}

const focusSearchTarget = async (target: SearchFocusTarget): Promise<void> => {
  await nextTick()

  const blockIndex = findBlockIndexById(target.blockId)
  const block = form.value.blocks[blockIndex]

  if (!block) {
    return
  }

  if (block.type === 'text' || block.type === 'code') {
    const editor = textEditors.get(target.blockId)
    const shouldFocus = target.focus ?? true

    if (!editor) {
      return
    }

    syncTextEditorHeight(editor)
    resetCanvasSelectAll()
    selectedImageBlockId.value = null

    const safeStart = Math.max(
      0,
      Math.min(target.selectionStart ?? 0, editor.value.length),
    )
    const safeEnd = Math.max(
      safeStart,
      Math.min(target.selectionEnd ?? safeStart, editor.value.length),
    )

    if (shouldFocus) {
      editor.focus()
      editor.setSelectionRange(safeStart, safeEnd)
      editor.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      })
      lastSelection.value = {
        blockId: target.blockId,
        selectionStart: safeStart,
        selectionEnd: safeEnd,
      }
      return
    }

    scrollBlockIntoView(target.blockId)
    return
  }

  selectImageBlock(target.blockId)
  scrollBlockIntoView(target.blockId)
}

defineExpose({
  focusSearchTarget,
})

watch(
  () => createBlockStructureSignature(form.value.blocks),
  () => {
    const normalizedBlocks = createEditorBlocks(form.value.blocks)

    if (
      createBlockStructureSignature(normalizedBlocks) ===
      createBlockStructureSignature(form.value.blocks)
    ) {
      return
    }

    form.value = {
      ...form.value,
      blocks: normalizedBlocks,
    }
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  closeContextMenu()

  for (const block of form.value.blocks) {
    revokeBlockPreviewUrl(block)
  }

  textEditors.clear()
  segmentElements.clear()
})
</script>

<template>
  <form
    class="note-form"
    :class="{
      'note-form--immersive': immersive,
    }"
    @submit.prevent="emit('submit')"
  >
    <label v-if="!hideTitle" class="note-form__field">
      <span class="note-form__label">Заголовок</span>
      <input
        v-model.trim="form.title"
        class="note-form__input"
        type="text"
        name="title"
        placeholder="Например, Event loop и microtasks"
        maxlength="160"
        required
      />
    </label>

    <div class="note-form__field">
      <span v-if="contentLabel" class="note-form__label">{{ contentLabel }}</span>

      <p v-if="contentHint" class="note-form__hint">
        {{ contentHint }}
      </p>

      <input
        ref="fileInput"
        class="note-form__file-input"
        type="file"
        accept="image/*"
        multiple
        @change="void handleFileSelection($event)"
      />

      <p v-if="pickerError" class="note-form__error">
        {{ pickerError }}
      </p>

      <div
        v-if="hasBlocks"
        class="note-form__canvas"
        :class="{
          'note-form__canvas--immersive': immersive,
          'note-form__canvas--select-all': isCanvasSelectAllActive,
        }"
        @keydown.capture="void handleCanvasKeydown($event)"
        @pointerdown.capture="resetCanvasSelectAll()"
      >
        <div v-if="showCanvasToolbar" class="note-form__canvas-toolbar">
          <span
            v-if="statusLabel"
            class="note-form__status-pill"
            :class="`note-form__status-pill--${statusTone}`"
          >
            {{ statusLabel }}
          </span>

          <button
            v-if="showUndo"
            class="app-button app-button--secondary note-form__undo-button"
            type="button"
            :disabled="isSubmitting || !canUndo"
            @click="emit('undo')"
          >
            {{ undoLabel }}
          </button>

          <button
            v-if="showClear"
            class="app-button app-button--secondary note-form__clear-button"
            type="button"
            :disabled="isSubmitting"
            @click="requestClearCanvas()"
          >
            {{ clearLabel }}
          </button>
        </div>

        <article
          v-for="(block, index) in form.blocks"
          :key="block.id"
          :ref="
            (element) => registerSegmentElement(block.id, element as Element | null)
          "
          class="note-form__segment"
          :class="{
            'note-form__segment--image': block.type === 'image',
            'note-form__segment--insertion-point':
              block.type === 'text' && isInsertionPointTextBlock(index),
            'note-form__segment--selected-all': isCanvasSelectAllActive,
            'note-form__segment--matched': matchedBlockIdSet.has(block.id),
            'note-form__segment--search-active': activeSearchBlockId === block.id,
          }"
          @pointerdown="
            block.type === 'text' && isInsertionPointTextBlock(index)
              ? void focusInsertionPoint(block.id, $event)
              : undefined
          "
        >
          <textarea
            v-if="block.type === 'text'"
            v-model="block.text"
            :ref="
              (element) => registerTextEditor(block.id, element as Element | null)
            "
            class="note-form__editor"
            :class="{
              'note-form__editor--insertion-point': isInsertionPointTextBlock(index),
              'note-form__editor--selected-all': isCanvasSelectAllActive,
              'note-form__editor--matched': matchedBlockIdSet.has(block.id),
              'note-form__editor--search-active': activeSearchBlockId === block.id,
            }"
            rows="1"
            @focus="rememberSelection(block.id, $event)"
            @click="rememberSelection(block.id, $event)"
            @keyup="rememberSelection(block.id, $event)"
            @select="rememberSelection(block.id, $event)"
            @input="handleTextInput(block.id, $event)"
            @keydown="void handleEditorBackspace($event, index)"
            @paste="void handleEditorPaste($event, block.id)"
            @contextmenu="void openDesktopContextMenu($event, block.id)"
          />

          <div
            v-else-if="block.type === 'code'"
            class="note-form__code-card"
          >
            <div class="note-form__code-toolbar">
              <select
                v-model="block.language"
                class="note-form__code-language"
                :disabled="isSubmitting"
              >
                <option
                  v-for="option in codeLanguageOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>

              <button
                class="app-button app-button--secondary note-form__code-remove"
                type="button"
                :disabled="isSubmitting"
                @click="void removeCodeBlock(block.id)"
              >
                Удалить код
              </button>
            </div>

            <textarea
              v-model="block.code"
              :ref="
                (element) => registerTextEditor(block.id, element as Element | null)
              "
              class="note-form__editor note-form__editor--code"
              :class="{
                'note-form__editor--selected-all': isCanvasSelectAllActive,
                'note-form__editor--matched': matchedBlockIdSet.has(block.id),
                'note-form__editor--search-active': activeSearchBlockId === block.id,
              }"
              rows="6"
              :disabled="isSubmitting"
              spellcheck="false"
              placeholder="Напиши код здесь"
              @focus="rememberSelection(block.id, $event)"
              @click="rememberSelection(block.id, $event)"
              @keyup="rememberSelection(block.id, $event)"
              @select="rememberSelection(block.id, $event)"
              @input="handleCodeInput(block.id, $event)"
              @contextmenu="void openDesktopContextMenu($event, block.id)"
            />
          </div>

          <button
            v-else-if="block.type === 'image'"
            class="note-form__image-card"
            :class="{
              'note-form__image-card--selected': selectedImageBlockId === block.id,
              'note-form__image-card--selected-all': isCanvasSelectAllActive,
              'note-form__image-card--matched': matchedBlockIdSet.has(block.id),
              'note-form__image-card--search-active': activeSearchBlockId === block.id,
            }"
            :data-analysis-status="imageBlockAnalysisStatus(block).label"
            :data-analysis-tone="imageBlockAnalysisStatus(block).tone"
            type="button"
            :disabled="isSubmitting"
            @focus="selectImageBlock(block.id)"
            @click="handleImageClick(block)"
            @dblclick="openImageBlockViewer(block)"
            @keydown="void handleImageKeydown($event, index, block)"
          >
            <div
              v-if="attachmentPreviewUrl(block)"
              class="note-form__image-wrap"
            >
              <img
                class="note-form__image"
                :src="attachmentPreviewUrl(block) ?? ''"
                :alt="block.fileName || 'Скриншот заметки'"
              />
            </div>

            <div v-else class="note-form__image-fallback">
              {{
                block.fileName ||
                attachmentForBlock(block)?.originalFileName ||
                'Скриншот'
              }}
            </div>
          </button>

          <button
            v-if="canInsertAfterBlock(index)"
            class="note-form__insert-between"
            type="button"
            :disabled="isSubmitting"
            @click="void insertTextBlockAfter(index)"
          >
            Нажми, чтобы вставить текст или картинку между блоками
          </button>
        </article>
      </div>

      <button
        class="app-button app-button--ghost note-form__add-button"
        type="button"
        :disabled="isSubmitting"
        @click="openFilePicker()"
      >
        Добавить картинку
      </button>
    </div>

    <p v-if="errorMessage" class="note-form__error">
      {{ errorMessage }}
    </p>

    <div v-if="showFooterActions" class="note-form__actions">
      <button
        v-if="showSubmit"
        class="app-button app-button--primary"
        type="submit"
        :disabled="isSubmitting"
      >
        {{ isSubmitting ? 'Сохраняем...' : submitLabel }}
      </button>

      <button
        v-if="showCancel"
        class="app-button app-button--secondary"
        type="button"
        :disabled="isSubmitting"
        @click="emit('cancel')"
      >
        {{ cancelLabel }}
      </button>
    </div>

    <ConfirmSheet
      :open="isClearConfirmOpen"
      title="Очистить заметку?"
      description="Вы уверены, что хотите очистить текст и скриншоты в полотне заметки?"
      confirm-label="Да"
      cancel-label="Нет"
      tone="danger"
      @cancel="closeClearCanvasConfirm"
      @confirm="void confirmClearCanvas()"
    />
    <EditorContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextMenuActions"
      @close="closeContextMenu()"
      @select="void handleContextMenuAction($event)"
    />
  </form>
</template>

<style scoped>
.note-form {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.note-form__field {
  display: flex;
  flex-direction: column;
  gap: 0.48rem;
}

.note-form__label {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.note-form__hint {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.84rem;
  line-height: 1.5;
}

.note-form__input {
  width: 100%;
  border: 1px solid rgba(180, 154, 123, 0.35);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text);
  padding: 0.82rem 0.94rem;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.note-form__input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.12);
  background: var(--surface-strong);
}

.note-form__file-input {
  display: none;
}

.note-form__canvas {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 1rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.8), rgba(255, 250, 243, 0.7));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.5),
    0 18px 30px rgba(71, 50, 24, 0.06);
}

.note-form__canvas-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.72rem;
  padding-bottom: 0.2rem;
}

.note-form__status-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  inline-size: 12rem;
  max-inline-size: 100%;
  padding: 0.42rem 0.72rem;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  line-height: 1.1;
  box-sizing: border-box;
  background: rgba(35, 28, 21, 0.06);
  color: var(--text-muted);
  text-align: center;
  white-space: nowrap;
}

.note-form__status-pill--saved {
  background: rgba(31, 109, 90, 0.12);
  color: var(--accent-strong);
}

.note-form__status-pill--saving {
  background: rgba(207, 116, 64, 0.12);
  color: var(--highlight);
}

.note-form__status-pill--unsaved,
.note-form__status-pill--error {
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
}

.note-form__canvas--immersive {
  min-height: 26rem;
}

.note-form__canvas--select-all {
  border-color: rgba(31, 109, 90, 0.28);
  box-shadow:
    inset 0 0 0 1px rgba(31, 109, 90, 0.12),
    0 18px 30px rgba(71, 50, 24, 0.06);
}

.note-form__segment {
  display: block;
  border-radius: 18px;
}

.note-form__segment--insertion-point {
  display: flex;
  flex-direction: column;
  cursor: text;
  padding: 0;
}

.note-form__code-card {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding: 0.9rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 20px;
  background: rgba(36, 34, 40, 0.96);
}

.note-form__code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.7rem;
}

.note-form__code-language {
  min-height: 2.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 251, 246, 0.96);
  padding: 0.45rem 0.72rem;
  font: inherit;
}

.note-form__code-language option {
  background: #fffaf5;
  color: #231c15;
}

.note-form__code-remove {
  min-height: 2.45rem;
  padding-inline: 0.78rem;
}

.note-form__segment--selected-all {
  background: rgba(31, 109, 90, 0.06);
}

.note-form__segment--matched {
  background: rgba(207, 116, 64, 0.08);
}

.note-form__segment--search-active {
  background: rgba(31, 109, 90, 0.1);
}

.note-form__editor {
  width: 100%;
  min-height: 2rem;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 0.06rem 0;
  overflow: hidden;
  font: inherit;
  font-size: 1rem;
  line-height: 1.7;
  resize: none;
}

.note-form__editor--insertion-point {
  min-height: 3.4rem;
}

.note-form__editor--code {
  min-height: 12rem;
  border-radius: 16px;
  background: rgba(18, 19, 24, 0.92);
  color: #f4f1eb;
  padding: 0.9rem 1rem;
  font-family:
    Consolas,
    'SFMono-Regular',
    'Cascadia Mono',
    'Liberation Mono',
    monospace;
  font-size: 0.94rem;
  line-height: 1.55;
}

.note-form__editor:focus {
  outline: none;
}

.note-form__editor--selected-all {
  border-radius: 14px;
  background: rgba(31, 109, 90, 0.08);
}

.note-form__editor--matched {
  border-radius: 14px;
  background: rgba(207, 116, 64, 0.08);
}

.note-form__editor--search-active {
  border-radius: 14px;
  background: rgba(31, 109, 90, 0.12);
}

.note-form__image-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0;
  width: 100%;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 22px;
  background: transparent;
  cursor: zoom-in;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.note-form__image-card::before {
  content: attr(data-analysis-status);
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  min-height: 1.9rem;
  max-width: 100%;
  padding: 0.32rem 0.7rem;
  border-radius: 999px;
  background: rgba(96, 80, 61, 0.84);
  color: rgba(255, 251, 246, 0.96);
  font-size: 0.74rem;
  font-weight: 700;
  line-height: 1.1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  backdrop-filter: blur(10px);
  pointer-events: none;
}

.note-form__image-card[data-analysis-tone='ready']::before {
  background: rgba(31, 109, 90, 0.9);
}

.note-form__image-card[data-analysis-tone='processing']::before {
  background: rgba(207, 116, 64, 0.92);
}

.note-form__image-card[data-analysis-tone='failed']::before {
  background: rgba(181, 65, 59, 0.92);
}

.note-form__image-card:focus-visible,
.note-form__image-card--selected {
  outline: none;
  border-color: rgba(31, 109, 90, 0.26);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.1);
  background: rgba(255, 255, 255, 0.38);
}

.note-form__image-card--selected-all {
  border-color: rgba(31, 109, 90, 0.24);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.08);
  background: rgba(255, 255, 255, 0.44);
}

.note-form__image-card--matched {
  border-color: rgba(207, 116, 64, 0.32);
  box-shadow: 0 0 0 3px rgba(207, 116, 64, 0.1);
  background: rgba(255, 247, 241, 0.72);
}

.note-form__image-card--search-active {
  border-color: rgba(31, 109, 90, 0.38);
  box-shadow: 0 0 0 4px rgba(31, 109, 90, 0.12);
  background: rgba(245, 252, 249, 0.88);
}

.note-form__insert-between {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  align-self: center;
  min-height: 2.5rem;
  margin-top: 0.38rem;
  padding: 0.45rem 0.9rem;
  border: 1px dashed rgba(180, 154, 123, 0.56);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.62);
  color: var(--text-muted);
  font: inherit;
  font-size: 0.82rem;
  font-weight: 600;
  text-align: center;
}

.note-form__image-wrap,
.note-form__image-fallback {
  overflow: hidden;
  border-radius: 20px;
  background: rgba(240, 229, 215, 0.62);
}

.note-form__image {
  display: block;
  width: 100%;
  max-height: 36rem;
  object-fit: contain;
}

.note-form__image-fallback {
  padding: 1rem;
  color: var(--text-muted);
  text-align: left;
}

.note-form__add-button {
  display: none;
}

.note-form__undo-button {
  min-height: 2.5rem;
  padding-inline: 0.78rem;
}

.note-form__clear-button {
  min-height: 2.5rem;
  padding-inline: 0.78rem;
}

.note-form__error {
  margin: 0;
  padding: 0.74rem 0.86rem;
  border-radius: 16px;
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
  font-size: 0.85rem;
}

.note-form__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.note-form--immersive .note-form__hint {
  margin-bottom: 0.1rem;
}

@media (min-width: 640px) {
  .note-form__canvas--immersive {
    min-height: 34rem;
    padding: 1.3rem 1.4rem;
  }
}
</style>
