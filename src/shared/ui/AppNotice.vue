<script setup lang="ts">
export type AppNoticeTone =
  | 'info'
  | 'loading'
  | 'warning'
  | 'error'
  | 'success'

withDefaults(
  defineProps<{
    tone?: AppNoticeTone
    title?: string | null
    message?: string | null
    compact?: boolean
  }>(),
  {
    tone: 'info',
    title: null,
    message: null,
    compact: false,
  },
)
</script>

<template>
  <section
    class="app-notice"
    :class="[
      `app-notice--${tone}`,
      {
        'app-notice--compact': compact,
      },
    ]"
  >
    <div class="app-notice__main">
      <div class="app-notice__accent" />

      <div class="app-notice__copy">
        <p v-if="title" class="app-notice__title">{{ title }}</p>
        <p v-if="message" class="app-notice__message">{{ message }}</p>
        <slot />
      </div>
    </div>

    <div v-if="$slots.actions" class="app-notice__actions">
      <slot name="actions" />
    </div>
  </section>
</template>

<style scoped>
.app-notice {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
  padding: 0.88rem 0.94rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.58);
}

.app-notice--compact {
  padding: 0.74rem 0.82rem;
}

.app-notice__main,
.app-notice__actions {
  display: flex;
  align-items: flex-start;
  gap: 0.72rem;
}

.app-notice__actions {
  flex-wrap: wrap;
}

.app-notice__accent {
  flex-shrink: 0;
  width: 0.78rem;
  height: 0.78rem;
  margin-top: 0.18rem;
  border-radius: 999px;
  background: var(--accent);
  box-shadow: 0 0 0 0.32rem rgba(31, 109, 90, 0.12);
}

.app-notice__copy {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.24rem;
}

.app-notice__title,
.app-notice__message {
  margin: 0;
}

.app-notice__title {
  color: var(--text);
  font-size: 0.9rem;
  font-weight: 800;
  line-height: 1.32;
}

.app-notice__message,
.app-notice :deep(p) {
  color: var(--text-muted);
  font-size: 0.88rem;
  line-height: 1.44;
}

.app-notice--loading {
  background: rgba(31, 109, 90, 0.08);
  border-color: rgba(31, 109, 90, 0.18);
}

.app-notice--loading .app-notice__accent {
  background: var(--accent);
  animation: app-notice-pulse 1.1s ease-in-out infinite;
}

.app-notice--warning {
  background: rgba(207, 116, 64, 0.1);
  border-color: rgba(207, 116, 64, 0.18);
}

.app-notice--warning .app-notice__accent {
  background: var(--highlight);
  box-shadow: 0 0 0 0.32rem rgba(207, 116, 64, 0.12);
}

.app-notice--error {
  background: rgba(181, 65, 59, 0.08);
  border-color: rgba(181, 65, 59, 0.2);
}

.app-notice--error .app-notice__accent {
  background: #b5413b;
  box-shadow: 0 0 0 0.32rem rgba(181, 65, 59, 0.12);
}

.app-notice--error .app-notice__message,
.app-notice--error :deep(p) {
  color: #9f3b35;
}

.app-notice--success {
  background: rgba(31, 109, 90, 0.08);
  border-color: rgba(31, 109, 90, 0.2);
}

@keyframes app-notice-pulse {
  0%,
  100% {
    transform: scale(1);
    opacity: 1;
  }

  50% {
    transform: scale(0.9);
    opacity: 0.72;
  }
}
</style>
