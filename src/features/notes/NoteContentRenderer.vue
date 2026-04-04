<script setup lang="ts">
import { openImageViewer } from '@/features/images/imageViewer'
import { buildApiUrl } from '@/services/client/http'
import { highlightText } from '@/shared/lib/highlight'
import type { Attachment, NoteContentBlock, NoteImageBlock } from '@/types'

const props = withDefaults(
  defineProps<{
    blocks: NoteContentBlock[]
    attachmentsById?: Record<string, Attachment>
    highlightQuery?: string
    selectedAttachmentId?: string | null
  }>(),
  {
    attachmentsById: () => ({}),
    highlightQuery: '',
    selectedAttachmentId: null,
  },
)

const attachmentForBlock = (block: NoteImageBlock): Attachment | null =>
  props.attachmentsById[block.attachmentId] ?? null

const imageStatusLabel = (block: NoteImageBlock): string => {
  const attachment = attachmentForBlock(block)

  if (!attachment) {
    return 'Файл недоступен'
  }

  if (attachment.processingStatus === 'pending') {
    return 'В очереди'
  }

  if (attachment.processingStatus === 'processing') {
    return 'AI анализ'
  }

  if (attachment.processingStatus === 'failed') {
    return 'Ошибка анализа'
  }

  return 'Готово'
}

const attachmentPreviewUrl = (block: NoteImageBlock): string | null => {
  const attachment = attachmentForBlock(block)
  return attachment ? buildApiUrl(attachment.storagePath) : null
}

const openAttachmentPreview = (block: NoteImageBlock): void => {
  const previewUrl = attachmentPreviewUrl(block)

  if (!previewUrl) {
    return
  }

  const imageLabel =
    attachmentForBlock(block)?.originalFileName ?? 'Скриншот заметки'

  openImageViewer({
    src: previewUrl,
    alt: imageLabel,
    title: imageLabel,
  })
}

const imageStatusCopy = (block: NoteImageBlock): string | null => {
  const attachment = attachmentForBlock(block)

  if (!attachment) {
    return 'Файл скриншота пока недоступен.'
  }

  if (attachment.processingStatus === 'pending') {
    return 'Скриншот ждёт OCR и AI-анализ.'
  }

  if (attachment.processingStatus === 'processing') {
    return 'Извлекаем текст и описание прямо из изображения.'
  }

  if (attachment.processingStatus === 'failed') {
    return attachment.processingError ?? 'AI-анализ завершился ошибкой.'
  }

  return null
}

const highlightedText = (value: string): string =>
  highlightText(value, props.highlightQuery)
</script>

<template>
  <div class="note-content-renderer">
    <article
      v-for="block in blocks"
      :key="block.id"
      class="note-content-renderer__block"
      :class="{
        'note-content-renderer__block--image': block.type === 'image',
        'note-content-renderer__block--selected':
          block.type === 'image' && block.attachmentId === selectedAttachmentId,
      }"
      :id="block.type === 'image' ? `attachment-${block.attachmentId}` : undefined"
    >
      <div
        v-if="block.type === 'text'"
        class="note-content-renderer__text"
        v-html="highlightedText(block.text)"
      />

      <template v-else>
        <button
          v-if="attachmentPreviewUrl(block)"
          class="note-content-renderer__image-link"
          type="button"
          @click="openAttachmentPreview(block)"
        >
          <img
            class="note-content-renderer__image"
            :src="attachmentPreviewUrl(block) ?? ''"
            :alt="
              attachmentForBlock(block)?.originalFileName ??
              'Скриншот заметки'
            "
            loading="lazy"
          />
        </button>

        <div class="note-content-renderer__image-copy">
          <div class="tag-row">
            <span class="tag">
              {{
                attachmentForBlock(block)?.originalFileName ??
                'Скриншот заметки'
              }}
            </span>
            <span class="tag">
              {{ imageStatusLabel(block) }}
            </span>
            <span
              v-if="block.attachmentId === selectedAttachmentId"
              class="tag"
            >
              Найдено в поиске
            </span>
          </div>

          <p
            v-if="attachmentForBlock(block)?.imageDescription"
            class="note-content-renderer__copy"
            v-html="highlightedText(attachmentForBlock(block)?.imageDescription ?? '')"
          />

          <p
            v-else-if="imageStatusCopy(block)"
            class="note-content-renderer__copy"
            :class="{
              'note-content-renderer__copy--error':
                attachmentForBlock(block)?.processingStatus === 'failed',
            }"
          >
            {{ imageStatusCopy(block) }}
          </p>

          <div
            v-if="attachmentForBlock(block)?.extractedText"
            class="note-content-renderer__text-block"
          >
            <span class="note-content-renderer__label">Extracted text</span>
            <p
              class="note-content-renderer__copy"
              v-html="highlightedText(attachmentForBlock(block)?.extractedText ?? '')"
            />
          </div>
        </div>
      </template>
    </article>
  </div>
</template>

<style scoped>
.note-content-renderer {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
}

.note-content-renderer__block {
  padding: 1.08rem;
  border: 1px solid rgba(180, 154, 123, 0.22);
  border-radius: 20px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 250, 243, 0.58));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4);
}

.note-content-renderer__block--image {
  display: flex;
  flex-direction: column;
  gap: 0.82rem;
}

.note-content-renderer__block--selected {
  border-color: rgba(31, 109, 90, 0.5);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 0 0 3px rgba(31, 109, 90, 0.12);
}

.note-content-renderer__text,
.note-content-renderer__copy {
  color: var(--text);
  font-size: 0.98rem;
  line-height: 1.7;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-content-renderer__copy {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.9rem;
  line-height: 1.55;
}

.note-content-renderer__copy--error {
  color: #9f3b35;
}

.note-content-renderer__image-link {
  display: block;
  width: 100%;
  padding: 0;
  border: 0;
  overflow: hidden;
  border-radius: 18px;
  background: rgba(240, 229, 215, 0.6);
  cursor: zoom-in;
}

.note-content-renderer__image {
  display: block;
  width: 100%;
  max-height: 30rem;
  object-fit: cover;
}

.note-content-renderer__image-copy,
.note-content-renderer__text-block {
  display: flex;
  flex-direction: column;
  gap: 0.42rem;
}

.note-content-renderer__label {
  color: var(--text-muted);
  font-size: 0.74rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.note-content-renderer :deep(mark) {
  padding: 0.04rem 0.18rem;
  border-radius: 0.32rem;
  background: rgba(207, 116, 64, 0.22);
  color: var(--text);
}
</style>
