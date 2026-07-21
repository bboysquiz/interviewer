<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import {
  getInterviewCodeLanguageLabel,
  highlightInterviewCode,
  parseInterviewPrompt,
} from './interviewPrompt'

const props = defineProps<{
  prompt: string
}>()

const copiedBlockId = ref<string | null>(null)
let copiedStateTimer: number | null = null

const blocks = computed(() =>
  parseInterviewPrompt(props.prompt).map((block) => {
    if (block.type === 'text') {
      return block
    }

    return {
      ...block,
      highlightedHtml: highlightInterviewCode(block.code, block.language),
      languageLabel: getInterviewCodeLanguageLabel(block.language),
      lineNumbers: Array.from(
        { length: Math.max(1, block.code.split('\n').length) },
        (_value, index) => String(index + 1),
      ).join('\n'),
    }
  }),
)

const copyWithFallback = (value: string): boolean => {
  if (typeof document === 'undefined') {
    return false
  }

  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  textarea.style.pointerEvents = 'none'
  document.body.appendChild(textarea)
  textarea.select()
  const copied = document.execCommand('copy')
  textarea.remove()
  return copied
}

const copyCode = async (blockId: string, code: string): Promise<void> => {
  let copied = false

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(code)
      copied = true
    } else {
      copied = copyWithFallback(code)
    }
  } catch {
    copied = copyWithFallback(code)
  }

  if (!copied) {
    return
  }

  copiedBlockId.value = blockId

  if (copiedStateTimer !== null) {
    window.clearTimeout(copiedStateTimer)
  }

  copiedStateTimer = window.setTimeout(() => {
    copiedBlockId.value = null
    copiedStateTimer = null
  }, 1800)
}

onBeforeUnmount(() => {
  if (copiedStateTimer !== null) {
    window.clearTimeout(copiedStateTimer)
  }
})
</script>

<template>
  <div class="interview-prompt-renderer">
    <template v-for="block in blocks" :key="block.id">
      <p v-if="block.type === 'text'" class="interview-prompt-renderer__text">
        {{ block.text }}
      </p>

      <section v-else class="interview-prompt-renderer__code-card">
        <header class="interview-prompt-renderer__code-toolbar">
          <div class="interview-prompt-renderer__window-meta">
            <span class="interview-prompt-renderer__window-dots" aria-hidden="true">
              <i></i><i></i><i></i>
            </span>
            <span class="interview-prompt-renderer__language">
              {{ block.languageLabel }}
            </span>
          </div>

          <button
            class="interview-prompt-renderer__copy"
            type="button"
            :aria-label="`Скопировать код ${block.languageLabel}`"
            @click="void copyCode(block.id, block.code)"
          >
            {{ copiedBlockId === block.id ? 'Скопировано' : 'Копировать' }}
          </button>
        </header>

        <div class="interview-prompt-renderer__code-body">
          <pre
            class="interview-prompt-renderer__line-numbers"
            aria-hidden="true"
          >{{ block.lineNumbers }}</pre>
          <pre class="interview-prompt-renderer__source"><code
            v-if="block.highlightedHtml"
            class="interview-prompt-renderer__source-code hljs"
            v-html="block.highlightedHtml"
          ></code><code
            v-else
            class="interview-prompt-renderer__source-code"
          >{{ block.code }}</code></pre>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.interview-prompt-renderer {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  min-width: 0;
}

.interview-prompt-renderer__text {
  margin: 0;
  color: var(--text);
  font-size: 1.04rem;
  font-weight: 700;
  line-height: 1.52;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.interview-prompt-renderer__code-card {
  min-width: 0;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  background: #121419;
  box-shadow: 0 14px 32px rgba(18, 19, 24, 0.16);
}

.interview-prompt-renderer__code-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  min-height: 2.9rem;
  padding: 0.55rem 0.72rem 0.55rem 0.9rem;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: #1b1e25;
}

.interview-prompt-renderer__window-meta,
.interview-prompt-renderer__window-dots {
  display: inline-flex;
  align-items: center;
}

.interview-prompt-renderer__window-meta {
  gap: 0.78rem;
  min-width: 0;
}

.interview-prompt-renderer__window-dots {
  gap: 0.34rem;
}

.interview-prompt-renderer__window-dots i {
  width: 0.58rem;
  height: 0.58rem;
  border-radius: 999px;
  background: #ef6a5b;
}

.interview-prompt-renderer__window-dots i:nth-child(2) {
  background: #e9bd4f;
}

.interview-prompt-renderer__window-dots i:nth-child(3) {
  background: #62c454;
}

.interview-prompt-renderer__language {
  overflow: hidden;
  color: rgba(236, 239, 244, 0.72);
  font-family:
    Consolas,
    'SFMono-Regular',
    'Cascadia Mono',
    'Liberation Mono',
    monospace;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.interview-prompt-renderer__copy {
  flex: 0 0 auto;
  min-height: 2rem;
  padding: 0.35rem 0.64rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.06);
  color: rgba(247, 249, 252, 0.84);
  font-size: 0.74rem;
  font-weight: 700;
  transition:
    border-color 0.18s ease,
    background-color 0.18s ease,
    color 0.18s ease;
}

.interview-prompt-renderer__copy:hover {
  border-color: rgba(126, 203, 177, 0.44);
  background: rgba(126, 203, 177, 0.12);
  color: #f7fffc;
}

.interview-prompt-renderer__code-body {
  display: grid;
  grid-template-columns: auto minmax(max-content, 1fr);
  max-height: 34rem;
  overflow: auto;
  background: #121419;
  scrollbar-color: rgba(160, 172, 190, 0.38) transparent;
}

.interview-prompt-renderer__line-numbers,
.interview-prompt-renderer__source {
  margin: 0;
  font-family:
    Consolas,
    'SFMono-Regular',
    'Cascadia Mono',
    'Liberation Mono',
    monospace;
  font-size: 0.91rem;
  line-height: 1.65;
  tab-size: 2;
}

.interview-prompt-renderer__line-numbers {
  position: sticky;
  left: 0;
  z-index: 1;
  padding: 1rem 0.68rem 1rem 0.82rem;
  border-right: 1px solid rgba(255, 255, 255, 0.07);
  background: #171a20;
  color: rgba(166, 178, 194, 0.46);
  text-align: right;
  user-select: none;
}

.interview-prompt-renderer__source {
  min-width: 100%;
  padding: 1rem 1.15rem;
  color: #d8dee9;
  white-space: pre;
}

.interview-prompt-renderer__source-code,
.interview-prompt-renderer__source-code.hljs {
  display: block;
  padding: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  white-space: pre;
}

.interview-prompt-renderer :deep(.hljs-comment),
.interview-prompt-renderer :deep(.hljs-quote) {
  color: #7f8c98;
  font-style: italic;
}

.interview-prompt-renderer :deep(.hljs-keyword),
.interview-prompt-renderer :deep(.hljs-selector-tag),
.interview-prompt-renderer :deep(.hljs-literal),
.interview-prompt-renderer :deep(.hljs-doctag) {
  color: #ff7b72;
}

.interview-prompt-renderer :deep(.hljs-title),
.interview-prompt-renderer :deep(.hljs-title.function_),
.interview-prompt-renderer :deep(.hljs-section) {
  color: #d2a8ff;
}

.interview-prompt-renderer :deep(.hljs-string),
.interview-prompt-renderer :deep(.hljs-regexp),
.interview-prompt-renderer :deep(.hljs-attribute),
.interview-prompt-renderer :deep(.hljs-symbol) {
  color: #a5d6ff;
}

.interview-prompt-renderer :deep(.hljs-number),
.interview-prompt-renderer :deep(.hljs-built_in),
.interview-prompt-renderer :deep(.hljs-type) {
  color: #79c0ff;
}

.interview-prompt-renderer :deep(.hljs-variable),
.interview-prompt-renderer :deep(.hljs-template-variable),
.interview-prompt-renderer :deep(.hljs-params) {
  color: #ffa657;
}

.interview-prompt-renderer :deep(.hljs-meta),
.interview-prompt-renderer :deep(.hljs-meta .hljs-keyword) {
  color: #8ddb8c;
}

@media (max-width: 560px) {
  .interview-prompt-renderer__text {
    font-size: 0.98rem;
  }

  .interview-prompt-renderer__line-numbers,
  .interview-prompt-renderer__source {
    font-size: 0.82rem;
  }

  .interview-prompt-renderer__source {
    padding-inline: 0.9rem;
  }
}
</style>
