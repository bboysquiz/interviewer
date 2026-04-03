<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

interface ConfirmSheetProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'danger' | 'neutral'
  isSubmitting?: boolean
  errorMessage?: string | null
}

const props = withDefaults(defineProps<ConfirmSheetProps>(), {
  confirmLabel: 'Подтвердить',
  cancelLabel: 'Отмена',
  tone: 'danger',
  isSubmitting: false,
  errorMessage: null,
})

const emit = defineEmits<{
  cancel: []
  confirm: []
}>()

const confirmButtonClass = computed(() =>
  props.tone === 'danger' ? 'app-button app-button--danger' : 'app-button app-button--primary',
)

const close = (): void => {
  if (props.isSubmitting) {
    return
  }

  emit('cancel')
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    close()
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (typeof document === 'undefined') {
      return
    }

    if (isOpen) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeydown)
      return
    }

    document.body.style.overflow = ''
    window.removeEventListener('keydown', handleKeydown)
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }

  window.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="confirm-sheet"
      role="dialog"
      aria-modal="true"
      @click="close"
    >
      <div class="confirm-sheet__backdrop" />

      <div class="confirm-sheet__panel" @click.stop>
        <div class="confirm-sheet__grabber" aria-hidden="true" />

        <div class="confirm-sheet__copy">
          <h2 class="confirm-sheet__title">{{ title }}</h2>
          <p class="confirm-sheet__description">{{ description }}</p>
        </div>

        <p v-if="errorMessage" class="confirm-sheet__error">
          {{ errorMessage }}
        </p>

        <div class="confirm-sheet__actions">
          <button
            class="app-button app-button--secondary confirm-sheet__action"
            type="button"
            :disabled="isSubmitting"
            @click="close"
          >
            {{ cancelLabel }}
          </button>

          <button
            :class="`${confirmButtonClass} confirm-sheet__action`"
            type="button"
            :disabled="isSubmitting"
            @click="emit('confirm')"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-sheet {
  position: fixed;
  inset: 0;
  z-index: 40;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 1rem 0.75rem calc(1rem + env(safe-area-inset-bottom));
}

.confirm-sheet__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(35, 28, 21, 0.3);
  backdrop-filter: blur(10px);
}

.confirm-sheet__panel {
  position: relative;
  width: min(100%, 30rem);
  display: flex;
  flex-direction: column;
  gap: 1rem;
  padding: 0.9rem 1rem 1rem;
  border: 1px solid rgba(180, 154, 123, 0.28);
  border-radius: 24px;
  background:
    linear-gradient(180deg, rgba(255, 250, 243, 0.98), rgba(255, 246, 236, 0.96));
  box-shadow: 0 24px 44px rgba(35, 28, 21, 0.2);
}

.confirm-sheet__grabber {
  width: 2.8rem;
  height: 0.32rem;
  margin: 0 auto;
  border-radius: 999px;
  background: rgba(111, 97, 83, 0.2);
}

.confirm-sheet__copy {
  display: flex;
  flex-direction: column;
  gap: 0.45rem;
}

.confirm-sheet__title {
  margin: 0;
  font-family: 'Iowan Old Style', 'Palatino Linotype', Georgia, serif;
  font-size: 1.26rem;
  line-height: 1.08;
  letter-spacing: -0.03em;
}

.confirm-sheet__description,
.confirm-sheet__error {
  margin: 0;
  font-size: 0.94rem;
  line-height: 1.5;
}

.confirm-sheet__description {
  color: var(--text-muted);
}

.confirm-sheet__error {
  padding: 0.8rem 0.88rem;
  border-radius: 16px;
  background: rgba(181, 65, 59, 0.1);
  color: #9f3b35;
}

.confirm-sheet__actions {
  display: grid;
  grid-template-columns: 1fr;
  gap: 0.64rem;
}

.confirm-sheet__action {
  width: 100%;
}

@media (min-width: 420px) {
  .confirm-sheet {
    padding-inline: 1rem;
  }

  .confirm-sheet__actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
