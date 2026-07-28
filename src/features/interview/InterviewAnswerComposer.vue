<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  watch,
  type ComponentPublicInstance,
} from 'vue'

import {
  getCodeAutocompleteResult,
  type CodeAutocompleteResult,
} from '@/features/editor/codeAutocomplete'
import {
  CODE_BLOCK_LANGUAGE_OPTIONS,
  DEFAULT_CODE_BLOCK_LANGUAGE,
  normalizeEditorText,
  parsePlainTextToTextAndCodeBlocks,
  serializeTextAndCodeBlocksToPlainText,
  type CodeBlockLanguage,
  type CodeLikeBlock,
  type TextAndCodeBlock,
  type TextLikeBlock,
} from '@/features/editor/codeBlocks'
import { probeClipboardAvailability, readClipboardContent } from '@/shared/lib/clipboard'
import EditorContextMenu from '@/shared/ui/EditorContextMenu.vue'

interface AnswerSelectionSnapshot {
  blockId: string
  selectionStart: number
  selectionEnd: number
}

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  blockId: string | null
  clipboardHasText: boolean
}

interface TouchContextMenuState {
  blockId: string | null
  timerId: ReturnType<typeof setTimeout> | null
  triggered: boolean
  selectionStart: number
  selectionEnd: number
  instantEligible: boolean
}

interface EditorIndentResult {
  value: string
  selectionStart: number
  selectionEnd: number
}

const TAB_INDENT = '    '

const model = defineModel<string>({ required: true })

const props = withDefaults(
  defineProps<{
    disabled?: boolean
    placeholder?: string
  }>(),
  {
    disabled: false,
    placeholder: 'Напиши ответ так, как сказал бы его на интервью.',
  },
)

const textEditors = new Map<string, HTMLTextAreaElement>()
type TextEditorTemplateRef = Element | ComponentPublicInstance | null
type TextEditorRefCallback = (element: TextEditorTemplateRef) => void
const textEditorRefCallbacks = new Map<string, TextEditorRefCallback>()
const lastSelection = ref<AnswerSelectionSnapshot | null>(null)
const collapsedCodeBlockIds = ref<string[]>([])
const contextMenu = ref<ContextMenuState>({
  open: false,
  x: 0,
  y: 0,
  blockId: null,
  clipboardHasText: false,
})
const touchContextMenu = ref<TouchContextMenuState>({
  blockId: null,
  timerId: null,
  triggered: false,
  selectionStart: 0,
  selectionEnd: 0,
  instantEligible: false,
})

const createBlockId = (): string => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }

  return `answer-block-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const createTextBlock = (text = '', id = createBlockId()): TextLikeBlock => ({
  id,
  type: 'text',
  text,
})

const createCodeBlock = (
  code = '',
  language: CodeBlockLanguage = DEFAULT_CODE_BLOCK_LANGUAGE,
  id = createBlockId(),
): CodeLikeBlock => ({
  id,
  type: 'code',
  language,
  code,
})

const mergeTextBlocks = (blocks: TextAndCodeBlock[]): TextAndCodeBlock[] => {
  const merged: TextAndCodeBlock[] = []

  for (const block of blocks) {
    const previous = merged[merged.length - 1]

    if (block.type === 'text' && previous?.type === 'text') {
      previous.text += block.text
      continue
    }

    merged.push(
      block.type === 'text'
        ? { ...block }
        : {
            ...block,
          },
    )
  }

  return merged
}

const ensureInsertionPoints = (blocks: TextAndCodeBlock[]): TextAndCodeBlock[] => {
  const merged = mergeTextBlocks(blocks)

  if (merged.length === 0) {
    return [createTextBlock()]
  }

  const withInsertionPoints: TextAndCodeBlock[] = []

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

const normalizeBlocks = (blocks: TextAndCodeBlock[]): TextAndCodeBlock[] =>
  ensureInsertionPoints(
    blocks.filter((block, index) => {
      if (block.type === 'code') {
        return true
      }

      const hasText = normalizeEditorText(block.text).trim().length > 0

      if (hasText) {
        return true
      }

      const hasNonTextBefore = blocks
        .slice(0, index)
        .some((candidate) => candidate.type !== 'text')
      const hasNonTextAfter = blocks
        .slice(index + 1)
        .some((candidate) => candidate.type !== 'text')

      return hasNonTextBefore && hasNonTextAfter
    }),
  )

const parseModelValue = (value: string): TextAndCodeBlock[] =>
  normalizeBlocks(parsePlainTextToTextAndCodeBlocks(value, createTextBlock, createCodeBlock))

const blocks = ref<TextAndCodeBlock[]>(parseModelValue(model.value))

const codeLanguageOptions = CODE_BLOCK_LANGUAGE_OPTIONS
const contextMenuActions = computed(() => [
  {
    id: 'paste',
    label: 'Вставить',
    disabled: !contextMenu.value.clipboardHasText,
  },
  {
    id: 'add-code',
    label: 'Написать код',
    disabled: props.disabled,
  },
])

const currentSerializedValue = computed(() =>
  serializeTextAndCodeBlocksToPlainText(blocks.value),
)

const syncTextEditorHeight = (editor: HTMLTextAreaElement): void => {
  const scrollContainer = editor.closest<HTMLElement>('.app-shell__content')
  const outerScrollTop = scrollContainer?.scrollTop ?? 0
  const outerScrollLeft = scrollContainer?.scrollLeft ?? 0
  const editorScrollTop = editor.scrollTop
  const editorScrollLeft = editor.scrollLeft

  editor.style.height = '0px'
  const minimumHeight = editor.classList.contains('interview-answer-composer__editor--code')
    ? 192
    : 48
  editor.style.height = `${Math.max(editor.scrollHeight, minimumHeight)}px`

  if (scrollContainer) {
    scrollContainer.scrollTop = outerScrollTop
    scrollContainer.scrollLeft = outerScrollLeft
  }

  editor.scrollTop = editorScrollTop
  editor.scrollLeft = editorScrollLeft
}

const registerTextEditor = (
  blockId: string,
  element: TextEditorTemplateRef,
): void => {
  if (element instanceof HTMLTextAreaElement) {
    if (textEditors.get(blockId) === element) {
      return
    }

    textEditors.set(blockId, element)
    syncTextEditorHeight(element)
    return
  }

  textEditors.delete(blockId)
}

const getTextEditorRef = (blockId: string): TextEditorRefCallback => {
  const existingCallback = textEditorRefCallbacks.get(blockId)

  if (existingCallback) {
    return existingCallback
  }

  const callback: TextEditorRefCallback = (element) => {
    registerTextEditor(blockId, element)

    if (element === null) {
      textEditorRefCallbacks.delete(blockId)
    }
  }

  textEditorRefCallbacks.set(blockId, callback)
  return callback
}

const closeContextMenu = (): void => {
  contextMenu.value = {
    open: false,
    x: 0,
    y: 0,
    blockId: null,
    clipboardHasText: false,
  }
}

const cancelTouchContextMenu = (): void => {
  if (touchContextMenu.value.timerId) {
    clearTimeout(touchContextMenu.value.timerId)
  }

  touchContextMenu.value = {
    blockId: null,
    timerId: null,
    triggered: false,
    selectionStart: 0,
    selectionEnd: 0,
    instantEligible: false,
  }
}

const findBlockIndexById = (blockId: string): number =>
  blocks.value.findIndex((block) => block.id === blockId)

const replaceBlocks = (nextBlocks: TextAndCodeBlock[]): void => {
  blocks.value = normalizeBlocks(nextBlocks)
}

const isCodeBlockCollapsed = (blockId: string): boolean =>
  collapsedCodeBlockIds.value.includes(blockId)

const collapseCodeBlock = (blockId: string): void => {
  if (collapsedCodeBlockIds.value.includes(blockId)) {
    return
  }

  collapsedCodeBlockIds.value = [...collapsedCodeBlockIds.value, blockId]
}

const expandCodeBlock = async (blockId: string): Promise<void> => {
  if (!collapsedCodeBlockIds.value.includes(blockId)) {
    return
  }

  collapsedCodeBlockIds.value = collapsedCodeBlockIds.value.filter((id) => id !== blockId)
  await nextTick()

  const block = blocks.value[findBlockIndexById(blockId)]

  if (block?.type !== 'code') {
    return
  }

  await focusBlockSelection(blockId, block.code.length)
}

const createSelectionSnapshot = (
  blockId: string,
  editor: HTMLTextAreaElement,
): AnswerSelectionSnapshot => ({
  blockId,
  selectionStart: editor.selectionStart ?? editor.value.length,
  selectionEnd: editor.selectionEnd ?? editor.value.length,
})

const rememberSelection = (blockId: string, event: Event): void => {
  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  lastSelection.value = createSelectionSnapshot(blockId, target)
}

const handleEditorInput = (blockId: string, event: Event): void => {
  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  syncTextEditorHeight(target)
  lastSelection.value = createSelectionSnapshot(blockId, target)
}

const focusBlock = async (
  blockId: string,
  caretPosition = 0,
): Promise<void> => {
  await nextTick()

  const editor = textEditors.get(blockId)

  if (!editor) {
    return
  }

  syncTextEditorHeight(editor)
  editor.focus({ preventScroll: true })
  const nextCaret = Math.max(0, Math.min(caretPosition, editor.value.length))
  editor.setSelectionRange(nextCaret, nextCaret)
  lastSelection.value = {
    blockId,
    selectionStart: nextCaret,
    selectionEnd: nextCaret,
  }
}

const focusBlockSelection = async (
  blockId: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): Promise<void> => {
  await nextTick()

  const editor = textEditors.get(blockId)

  if (!editor) {
    return
  }

  syncTextEditorHeight(editor)
  editor.focus({ preventScroll: true })
  const nextStart = Math.max(0, Math.min(selectionStart, editor.value.length))
  const nextEnd = Math.max(nextStart, Math.min(selectionEnd, editor.value.length))
  editor.setSelectionRange(nextStart, nextEnd)
  lastSelection.value = {
    blockId,
    selectionStart: nextStart,
    selectionEnd: nextEnd,
  }
}

const insertTextIntoSelection = (
  selection: AnswerSelectionSnapshot,
  text: string,
): { blockId: string; caretPosition: number } | null => {
  const blockIndex = findBlockIndexById(selection.blockId)
  const block = blocks.value[blockIndex]

  if (!block) {
    return null
  }

  const currentValue = block.type === 'text' ? block.text : block.code
  const safeStart = Math.max(0, Math.min(selection.selectionStart, currentValue.length))
  const safeEnd = Math.max(safeStart, Math.min(selection.selectionEnd, currentValue.length))
  const nextValue =
    currentValue.slice(0, safeStart) + text + currentValue.slice(safeEnd)
  const nextBlocks = [...blocks.value]

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

const getTabIndentResult = (
  value: string,
  selectionStart: number,
  selectionEnd: number,
  shouldOutdent: boolean,
): EditorIndentResult => {
  const safeStart = Math.max(0, Math.min(selectionStart, value.length))
  const safeEnd = Math.max(safeStart, Math.min(selectionEnd, value.length))

  if (!shouldOutdent && safeStart === safeEnd) {
    return {
      value: `${value.slice(0, safeStart)}${TAB_INDENT}${value.slice(safeEnd)}`,
      selectionStart: safeStart + TAB_INDENT.length,
      selectionEnd: safeStart + TAB_INDENT.length,
    }
  }

  const rangeStart = value.lastIndexOf('\n', safeStart - 1) + 1
  const lineEndSearchFrom =
    safeEnd > safeStart && value[safeEnd - 1] === '\n'
      ? safeEnd - 1
      : safeEnd
  const nextLineBreak = value.indexOf('\n', lineEndSearchFrom)
  const rangeEnd = nextLineBreak === -1 ? value.length : nextLineBreak
  const rangeText = value.slice(rangeStart, rangeEnd)
  const lines = rangeText.split('\n')
  let lineStart = rangeStart
  let deltaBeforeSelectionStart = 0
  let totalDelta = 0

  const nextLines = lines.map((line) => {
    let nextLine = line
    let delta = 0

    if (shouldOutdent) {
      const removeCount = line.startsWith(TAB_INDENT)
        ? TAB_INDENT.length
        : line.startsWith('  ')
          ? 2
          : line.startsWith(' ')
            ? 1
            : 0

      if (removeCount > 0) {
        nextLine = line.slice(removeCount)
        delta = -removeCount
      }
    } else {
      nextLine = `${TAB_INDENT}${line}`
      delta = TAB_INDENT.length
    }

    if (lineStart < safeStart) {
      deltaBeforeSelectionStart += delta
    }

    totalDelta += delta
    lineStart += line.length + 1

    return nextLine
  })

  const nextValue = [
    value.slice(0, rangeStart),
    nextLines.join('\n'),
    value.slice(rangeEnd),
  ].join('')
  const nextSelectionStart = Math.max(
    rangeStart,
    safeStart + deltaBeforeSelectionStart,
  )
  const nextSelectionEnd =
    safeStart === safeEnd
      ? nextSelectionStart
      : Math.max(nextSelectionStart, safeEnd + totalDelta)

  return {
    value: nextValue,
    selectionStart: nextSelectionStart,
    selectionEnd: nextSelectionEnd,
  }
}

const applyEditorValue = async (
  blockId: string,
  value: string,
  selectionStart: number,
  selectionEnd = selectionStart,
): Promise<void> => {
  const blockIndex = findBlockIndexById(blockId)
  const block = blocks.value[blockIndex]

  if (!block) {
    return
  }

  const nextBlocks = [...blocks.value]
  nextBlocks[blockIndex] =
    block.type === 'text'
      ? {
          ...block,
          text: value,
        }
      : {
          ...block,
          code: value,
        }

  replaceBlocks(nextBlocks)
  await focusBlockSelection(blockId, selectionStart, selectionEnd)
}

const handleEditorKeydown = async (
  blockId: string,
  event: KeyboardEvent,
): Promise<boolean> => {
  if (
    event.key !== 'Tab' ||
    event.ctrlKey ||
    event.metaKey ||
    event.altKey
  ) {
    return false
  }

  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return false
  }

  event.preventDefault()

  const result = getTabIndentResult(
    target.value,
    target.selectionStart ?? 0,
    target.selectionEnd ?? target.selectionStart ?? 0,
    event.shiftKey,
  )

  await applyEditorValue(
    blockId,
    result.value,
    result.selectionStart,
    result.selectionEnd,
  )

  return true
}

const insertCodeBlockAtSelection = (
  selection: AnswerSelectionSnapshot,
): { blockId: string; caretPosition: number } | null => {
  const blockIndex = findBlockIndexById(selection.blockId)
  const block = blocks.value[blockIndex]

  if (!block) {
    return null
  }

  if (block.type === 'code') {
    const nextCodeBlock = createCodeBlock()
    const trailingTextBlock = createTextBlock()
    const nextBlocks = [...blocks.value]

    nextBlocks.splice(blockIndex + 1, 0, nextCodeBlock, trailingTextBlock)
    replaceBlocks(nextBlocks)

    return {
      blockId: nextCodeBlock.id,
      caretPosition: 0,
    }
  }

  const safeStart = Math.max(0, Math.min(selection.selectionStart, block.text.length))
  const safeEnd = Math.max(safeStart, Math.min(selection.selectionEnd, block.text.length))
  const beforeText = block.text.slice(0, safeStart)
  const afterText = block.text.slice(safeEnd)
  const replacementBlocks: TextAndCodeBlock[] = []

  if (beforeText.length > 0) {
    replacementBlocks.push({
      ...block,
      text: beforeText,
    })
  }

  const nextCodeBlock = createCodeBlock()
  replacementBlocks.push(nextCodeBlock)
  replacementBlocks.push(createTextBlock(afterText))

  const nextBlocks = [...blocks.value]
  nextBlocks.splice(blockIndex, 1, ...replacementBlocks)
  replaceBlocks(nextBlocks)

  return {
    blockId: nextCodeBlock.id,
    caretPosition: 0,
  }
}

const removeCodeBlock = async (blockId: string): Promise<void> => {
  const blockIndex = findBlockIndexById(blockId)
  const block = blocks.value[blockIndex]

  if (!block || block.type !== 'code') {
    return
  }

  collapsedCodeBlockIds.value = collapsedCodeBlockIds.value.filter((id) => id !== blockId)

  const previousBlock = blocks.value[blockIndex - 1]
  const nextBlock = blocks.value[blockIndex + 1]
  const nextBlocks = [...blocks.value]

  if (previousBlock?.type === 'text' && nextBlock?.type === 'text') {
    nextBlocks.splice(blockIndex - 1, 3, {
      ...previousBlock,
      text: previousBlock.text + nextBlock.text,
    })
    replaceBlocks(nextBlocks)
    await focusBlock(previousBlock.id, previousBlock.text.length)
    return
  }

  nextBlocks.splice(blockIndex, 1)
  replaceBlocks(nextBlocks)

  const fallbackTextBlock = blocks.value.find(
    (candidate): candidate is TextLikeBlock => candidate.type === 'text',
  )

  if (fallbackTextBlock) {
    await focusBlock(fallbackTextBlock.id, fallbackTextBlock.text.length)
  }
}

const applyCodeAutocomplete = async (
  blockId: string,
  result: CodeAutocompleteResult,
): Promise<void> => {
  const blockIndex = findBlockIndexById(blockId)
  const block = blocks.value[blockIndex]

  if (!block || block.type !== 'code') {
    return
  }

  const nextBlocks = [...blocks.value]
  nextBlocks[blockIndex] = {
    ...block,
    code: result.value,
  }
  replaceBlocks(nextBlocks)
  await focusBlockSelection(blockId, result.selectionStart, result.selectionEnd)
}

const handleCodeEditorKeydown = async (
  blockId: string,
  language: CodeBlockLanguage,
  event: KeyboardEvent,
): Promise<void> => {
  if (await handleEditorKeydown(blockId, event)) {
    return
  }

  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  const result = getCodeAutocompleteResult({
    key: event.key,
    value: target.value,
    selectionStart: target.selectionStart ?? 0,
    selectionEnd: target.selectionEnd ?? target.selectionStart ?? 0,
    language,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
  })

  if (!result) {
    return
  }

  event.preventDefault()
  await applyCodeAutocomplete(blockId, result)
}

const handlePaste = async (
  event: ClipboardEvent,
  blockId: string,
): Promise<void> => {
  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  const pastedText = event.clipboardData?.getData('text/plain') ?? ''

  if (!pastedText) {
    return
  }

  event.preventDefault()

  const focusTarget = insertTextIntoSelection(
    createSelectionSnapshot(blockId, target),
    pastedText,
  )

  if (focusTarget) {
    await focusBlock(focusTarget.blockId, focusTarget.caretPosition)
  }
}

const openContextMenu = async (
  blockId: string,
  x: number,
  y: number,
): Promise<void> => {
  contextMenu.value = {
    open: true,
    x,
    y,
    blockId,
    clipboardHasText: false,
  }

  const availability = await probeClipboardAvailability()

  if (!contextMenu.value.open || contextMenu.value.blockId !== blockId) {
    return
  }

  contextMenu.value = {
    ...contextMenu.value,
    clipboardHasText: availability.hasText,
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

  await openContextMenu(blockId, event.clientX, event.clientY)
}

const handleTouchContextMenuStart = (
  event: TouchEvent,
  blockId: string,
): void => {
  if (props.disabled) {
    return
  }

  const target = event.target

  if (!(target instanceof HTMLTextAreaElement)) {
    return
  }

  cancelTouchContextMenu()
  const selection = createSelectionSnapshot(blockId, target)
  lastSelection.value = selection
  const instantEligible =
    typeof document !== 'undefined' && document.activeElement === target

  const touch = event.touches[0]

  if (!touch) {
    return
  }

  touchContextMenu.value = {
    blockId,
    timerId: setTimeout(() => {
      touchContextMenu.value = {
        blockId,
        timerId: null,
        triggered: true,
        selectionStart: selection.selectionStart,
        selectionEnd: selection.selectionEnd,
        instantEligible,
      }
      void openContextMenu(blockId, touch.clientX, touch.clientY)
    }, 420),
    triggered: false,
    selectionStart: selection.selectionStart,
    selectionEnd: selection.selectionEnd,
    instantEligible,
  }
}

const handleTouchContextMenuEnd = (event: TouchEvent): void => {
  if (touchContextMenu.value.triggered) {
    event.preventDefault()
    cancelTouchContextMenu()
    return
  }

  const target = event.target
  const touch = event.changedTouches[0]
  const state = touchContextMenu.value

  if (
    state.blockId &&
    state.instantEligible &&
    target instanceof HTMLTextAreaElement &&
    target.selectionStart === state.selectionStart &&
    target.selectionEnd === state.selectionEnd &&
    touch
  ) {
    event.preventDefault()
    void openContextMenu(state.blockId, touch.clientX, touch.clientY)
  }

  cancelTouchContextMenu()
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

  if (actionId === 'add-code') {
    const focusTarget = insertCodeBlockAtSelection(selection)

    if (focusTarget) {
      await focusBlock(focusTarget.blockId, focusTarget.caretPosition)
    }

    return
  }

  if (actionId !== 'paste') {
    return
  }

  const clipboardContent = await readClipboardContent()

  if (!clipboardContent.text) {
    return
  }

  const focusTarget = insertTextIntoSelection(selection, clipboardContent.text)

  if (focusTarget) {
    await focusBlock(focusTarget.blockId, focusTarget.caretPosition)
  }
}

watch(
  currentSerializedValue,
  (value) => {
    if (normalizeEditorText(model.value) === normalizeEditorText(value)) {
      return
    }

    model.value = value
  },
  { immediate: true },
)

watch(
  model,
  (value) => {
    if (normalizeEditorText(value) === normalizeEditorText(currentSerializedValue.value)) {
      return
    }

    blocks.value = parseModelValue(value)
  },
)

watch(
  () => blocks.value.map((block) => block.id),
  (blockIds) => {
    const activeIds = new Set(blockIds)
    collapsedCodeBlockIds.value = collapsedCodeBlockIds.value.filter((id) =>
      activeIds.has(id),
    )
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  closeContextMenu()
  cancelTouchContextMenu()
  textEditors.clear()
  textEditorRefCallbacks.clear()
})
</script>

<template>
  <div class="interview-answer-composer">
    <article
      v-for="(block, index) in blocks"
      :key="block.id"
      class="interview-answer-composer__segment"
      :class="{
        'interview-answer-composer__segment--code': block.type === 'code',
      }"
    >
      <textarea
        v-if="block.type === 'text'"
        v-model="block.text"
        :ref="getTextEditorRef(block.id)"
        class="interview-answer-composer__editor"
        :disabled="disabled"
        rows="2"
        :placeholder="index === 0 ? placeholder : ''"
        @focus="rememberSelection(block.id, $event)"
        @click="rememberSelection(block.id, $event)"
        @keyup="rememberSelection(block.id, $event)"
        @select="rememberSelection(block.id, $event)"
        @keydown="void handleEditorKeydown(block.id, $event)"
        @input="handleEditorInput(block.id, $event)"
        @paste="void handlePaste($event, block.id)"
        @contextmenu="void openDesktopContextMenu($event, block.id)"
        @touchstart="handleTouchContextMenuStart($event, block.id)"
        @touchmove="cancelTouchContextMenu()"
        @touchend="handleTouchContextMenuEnd($event)"
        @touchcancel="cancelTouchContextMenu()"
      />

      <div
        v-else
        class="interview-answer-composer__code-card"
        :class="{
          'interview-answer-composer__code-card--collapsed': isCodeBlockCollapsed(block.id),
        }"
      >
        <div
          v-if="!isCodeBlockCollapsed(block.id)"
          class="interview-answer-composer__code-toolbar"
        >
          <select
            v-model="block.language"
            class="interview-answer-composer__code-language"
            :disabled="disabled"
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
            class="app-button app-button--secondary interview-answer-composer__code-save"
            type="button"
            :disabled="disabled"
            @click="collapseCodeBlock(block.id)"
          >
            Сохранить код
          </button>

          <button
            class="app-button app-button--secondary interview-answer-composer__code-remove"
            type="button"
            :disabled="disabled"
            @click="void removeCodeBlock(block.id)"
          >
            Удалить код
          </button>
        </div>

        <textarea
          v-if="!isCodeBlockCollapsed(block.id)"
          v-model="block.code"
          :ref="getTextEditorRef(block.id)"
          class="interview-answer-composer__editor interview-answer-composer__editor--code"
          :disabled="disabled"
          rows="8"
          spellcheck="false"
          placeholder="Напиши код здесь"
          @focus="rememberSelection(block.id, $event)"
          @click="rememberSelection(block.id, $event)"
          @keyup="rememberSelection(block.id, $event)"
          @select="rememberSelection(block.id, $event)"
          @keydown="void handleCodeEditorKeydown(block.id, block.language, $event)"
          @input="handleEditorInput(block.id, $event)"
          @paste="void handlePaste($event, block.id)"
          @contextmenu="void openDesktopContextMenu($event, block.id)"
          @touchstart="handleTouchContextMenuStart($event, block.id)"
          @touchmove="cancelTouchContextMenu()"
          @touchend="handleTouchContextMenuEnd($event)"
          @touchcancel="cancelTouchContextMenu()"
        />

        <button
          v-else
          class="interview-answer-composer__code-preview"
          type="button"
          :disabled="disabled"
          @click="void expandCodeBlock(block.id)"
        >
          <pre class="interview-answer-composer__code-preview-content">{{ block.code || 'Пустой блок кода' }}</pre>
        </button>
      </div>
    </article>

    <EditorContextMenu
      :open="contextMenu.open"
      :x="contextMenu.x"
      :y="contextMenu.y"
      :actions="contextMenuActions"
      @close="closeContextMenu()"
      @select="void handleContextMenuAction($event)"
    />
  </div>
</template>

<style scoped>
.interview-answer-composer {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.interview-answer-composer__segment {
  display: block;
}

.interview-answer-composer__editor {
  width: 100%;
  min-height: 3rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.74);
  color: var(--text);
  padding: 1rem;
  font: inherit;
  line-height: 1.6;
  tab-size: 2;
  resize: none;
  outline: none;
  -webkit-touch-callout: none;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.interview-answer-composer__editor:focus {
  border-color: rgba(149, 90, 48, 0.48);
  box-shadow: 0 0 0 3px rgba(149, 90, 48, 0.12);
}

.interview-answer-composer__code-card {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  padding: 0.9rem;
  border: 1px solid rgba(180, 154, 123, 0.2);
  border-radius: 22px;
  background: rgba(30, 31, 37, 0.96);
}

.interview-answer-composer__code-card--collapsed {
  padding: 0;
  border-color: rgba(180, 154, 123, 0.16);
}

.interview-answer-composer__code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.72rem;
}

.interview-answer-composer__code-language {
  min-height: 2.5rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.08);
  color: rgba(255, 251, 246, 0.96);
  padding: 0.45rem 0.72rem;
  font: inherit;
}

.interview-answer-composer__code-language option {
  background: #fffaf5;
  color: #231c15;
}

.interview-answer-composer__editor--code {
  min-height: 12rem;
  border-color: rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  background: rgba(18, 19, 24, 0.92);
  color: #f4f1eb;
  font-family:
    Consolas,
    'SFMono-Regular',
    'Cascadia Mono',
    'Liberation Mono',
  monospace;
  font-size: 0.94rem;
  line-height: 1.55;
  -webkit-touch-callout: none;
}

.interview-answer-composer__editor--code:focus {
  border-color: rgba(212, 183, 150, 0.44);
  box-shadow: 0 0 0 3px rgba(212, 183, 150, 0.12);
}

.interview-answer-composer__code-save,
.interview-answer-composer__code-remove {
  min-height: 2.45rem;
  padding-inline: 0.78rem;
}

.interview-answer-composer__code-preview {
  display: block;
  width: 100%;
  padding: 0.9rem 1rem;
  border: 0;
  border-radius: 20px;
  background: rgba(18, 19, 24, 0.92);
  color: #f4f1eb;
  text-align: left;
  cursor: text;
}

.interview-answer-composer__code-preview-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family:
    Consolas,
    'SFMono-Regular',
    'Cascadia Mono',
    'Liberation Mono',
    monospace;
  font-size: 0.94rem;
  line-height: 1.55;
}
</style>
