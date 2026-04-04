<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

import { useImageViewer } from '@/features/images/imageViewer'

const {
  alt,
  close,
  isOpen,
  maxScale,
  minScale,
  resetScale,
  scale,
  setScale,
  src,
  title,
  toggleScale,
  zoomIn,
  zoomOut,
} = useImageViewer()

let pinchStartDistance = 0
let pinchStartScale = minScale

const imageWidth = computed(() => `${Math.round(scale.value * 100)}%`)
const zoomPercent = computed(() => `${Math.round(scale.value * 100)}%`)
const canZoomOut = computed(() => scale.value > minScale)
const canZoomIn = computed(() => scale.value < maxScale)

const distanceBetweenTouches = (event: TouchEvent): number => {
  if (event.touches.length < 2) {
    return 0
  }

  const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]]
  const deltaX = firstTouch.clientX - secondTouch.clientX
  const deltaY = firstTouch.clientY - secondTouch.clientY
  return Math.hypot(deltaX, deltaY)
}

const handleWheelZoom = (event: WheelEvent): void => {
  if (!isOpen.value) {
    return
  }

  event.preventDefault()
  const nextScale = scale.value + (event.deltaY < 0 ? 0.15 : -0.15)
  setScale(nextScale)
}

const handleTouchStart = (event: TouchEvent): void => {
  if (event.touches.length < 2) {
    return
  }

  pinchStartDistance = distanceBetweenTouches(event)
  pinchStartScale = scale.value
}

const handleTouchMove = (event: TouchEvent): void => {
  if (event.touches.length < 2 || pinchStartDistance <= 0) {
    return
  }

  event.preventDefault()
  const currentDistance = distanceBetweenTouches(event)

  if (currentDistance <= 0) {
    return
  }

  setScale(pinchStartScale * (currentDistance / pinchStartDistance))
}

const resetPinchState = (): void => {
  pinchStartDistance = 0
  pinchStartScale = minScale
}

const handleKeydown = (event: KeyboardEvent): void => {
  if (!isOpen.value) {
    return
  }

  if (event.key === 'Escape') {
    close()
    return
  }

  if (event.key === '+' || event.key === '=') {
    event.preventDefault()
    zoomIn()
    return
  }

  if (event.key === '-') {
    event.preventDefault()
    zoomOut()
    return
  }

  if (event.key === '0') {
    event.preventDefault()
    resetScale()
  }
}

watch(
  isOpen,
  (value) => {
    if (typeof document === 'undefined') {
      return
    }

    if (value) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeydown)
      return
    }

    document.body.style.overflow = ''
    window.removeEventListener('keydown', handleKeydown)
    resetPinchState()
  },
  { immediate: true },
)

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }

  window.removeEventListener('keydown', handleKeydown)
  resetPinchState()
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="image-viewer"
      role="dialog"
      aria-modal="true"
      :aria-label="(title ?? alt) || 'Просмотр изображения'"
    >
      <button
        class="image-viewer__backdrop"
        type="button"
        aria-label="Закрыть просмотр изображения"
        @click="close()"
      />

      <div class="image-viewer__panel">
        <div class="image-viewer__toolbar">
          <div class="image-viewer__copy">
            <p v-if="title" class="image-viewer__title">{{ title }}</p>
            <p v-else-if="alt" class="image-viewer__title">{{ alt }}</p>
          </div>

          <div class="image-viewer__controls">
            <button
              class="app-button app-button--secondary image-viewer__control"
              type="button"
              :disabled="!canZoomOut"
              aria-label="Уменьшить изображение"
              @click="zoomOut()"
            >
              -
            </button>
            <span class="image-viewer__zoom-label">{{ zoomPercent }}</span>
            <button
              class="app-button app-button--secondary image-viewer__control"
              type="button"
              :disabled="!canZoomIn"
              aria-label="Увеличить изображение"
              @click="zoomIn()"
            >
              +
            </button>
            <button
              class="app-button app-button--secondary image-viewer__reset"
              type="button"
              :disabled="!canZoomOut"
              @click="resetScale()"
            >
              100%
            </button>
            <button
              class="app-button app-button--secondary image-viewer__close"
              type="button"
              aria-label="Закрыть просмотр изображения"
              @click="close()"
            >
              ×
            </button>
          </div>
        </div>

        <div
          class="image-viewer__stage"
          @wheel="handleWheelZoom"
        >
          <img
            class="image-viewer__image"
            :class="{
              'image-viewer__image--zoomed': scale > minScale,
            }"
            :src="src"
            :alt="alt || title || 'Изображение'"
            :style="{
              width: imageWidth,
            }"
            @click.stop="toggleScale()"
            @touchstart.passive="handleTouchStart"
            @touchmove="handleTouchMove"
            @touchend="resetPinchState"
            @touchcancel="resetPinchState"
          />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.image-viewer {
  position: fixed;
  inset: 0;
  z-index: 60;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.image-viewer__backdrop {
  position: absolute;
  inset: 0;
  background: rgba(19, 16, 12, 0.82);
  backdrop-filter: blur(14px);
}

.image-viewer__panel {
  position: relative;
  z-index: 1;
  width: min(100%, 70rem);
  max-height: calc(100svh - 2rem);
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
}

.image-viewer__toolbar {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  padding: 0.85rem 0.95rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  background: rgba(30, 24, 19, 0.78);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
}

.image-viewer__copy {
  min-width: 0;
}

.image-viewer__title {
  margin: 0;
  color: rgba(255, 250, 243, 0.92);
  font-size: 0.94rem;
  line-height: 1.45;
  word-break: break-word;
}

.image-viewer__controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.55rem;
}

.image-viewer__control,
.image-viewer__reset,
.image-viewer__close {
  min-height: 2.8rem;
}

.image-viewer__control {
  min-width: 2.8rem;
  padding-inline: 0.85rem;
}

.image-viewer__zoom-label {
  min-width: 3.4rem;
  color: rgba(255, 250, 243, 0.88);
  font-size: 0.86rem;
  font-weight: 700;
  text-align: center;
}

.image-viewer__stage {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 24px;
  background: rgba(30, 24, 19, 0.78);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 1rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
}

.image-viewer__image {
  display: block;
  max-width: none;
  height: auto;
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
  cursor: zoom-in;
  user-select: none;
  -webkit-user-drag: none;
  touch-action: none;
}

.image-viewer__image--zoomed {
  cursor: zoom-out;
}

@media (min-width: 720px) {
  .image-viewer {
    padding: 1.2rem;
  }

  .image-viewer__toolbar {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .image-viewer__copy {
    flex: 1;
  }
}
</style>
