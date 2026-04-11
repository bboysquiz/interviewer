<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { useImageViewer } from '@/features/images/imageViewer'

interface ActivePointer {
  clientX: number
  clientY: number
}

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
let pinchStartContentX = 0
let pinchStartContentY = 0
let dragPointerId: number | null = null
let dragStartClientX = 0
let dragStartClientY = 0
let dragStartScrollLeft = 0
let dragStartScrollTop = 0
let suppressImageClick = false
let pendingViewportFrame = 0
let stageResizeObserver: ResizeObserver | null = null
let observedStageElement: HTMLElement | null = null

const activePointers = new Map<number, ActivePointer>()
const stageElement = ref<HTMLElement | null>(null)
const stageWidth = ref(0)
const naturalImageWidth = ref(0)
const isDragging = ref(false)

const updateStageWidth = (): void => {
  stageWidth.value = Math.max((stageElement.value?.clientWidth ?? 0) - 32, 240)
}

const observeStageElement = (element: HTMLElement | null): void => {
  if (observedStageElement && stageResizeObserver) {
    stageResizeObserver.unobserve(observedStageElement)
  }

  observedStageElement = element

  if (element && stageResizeObserver) {
    stageResizeObserver.observe(element)
    updateStageWidth()
  }
}

const imageWidth = computed(() => {
  if (!naturalImageWidth.value || !stageWidth.value) {
    return `${Math.round(scale.value * 100)}%`
  }

  const baseWidth = Math.min(naturalImageWidth.value, stageWidth.value)
  return `${Math.max(180, Math.round(baseWidth * scale.value))}px`
})

const zoomPercent = computed(() => `${Math.round(scale.value * 100)}%`)
const canZoomOut = computed(() => scale.value > minScale)
const canZoomIn = computed(() => scale.value < maxScale)
const isPannable = computed(() => scale.value > minScale)

const clampScrollValue = (value: number, maxValue: number): number =>
  Math.min(Math.max(0, value), Math.max(0, maxValue))

const runAfterViewportRender = (callback: () => void): void => {
  if (typeof window === 'undefined') {
    callback()
    return
  }

  if (pendingViewportFrame) {
    window.cancelAnimationFrame(pendingViewportFrame)
  }

  pendingViewportFrame = window.requestAnimationFrame(() => {
    pendingViewportFrame = 0
    callback()
  })
}

const getStageViewportPoint = (
  clientX: number,
  clientY: number,
): { x: number; y: number } => {
  const stage = stageElement.value

  if (!stage) {
    return {
      x: 0,
      y: 0,
    }
  }

  const rect = stage.getBoundingClientRect()
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  }
}

const getActivePointerList = (): ActivePointer[] =>
  Array.from(activePointers.values())

const distanceBetweenPointers = (pointers: ActivePointer[]): number => {
  if (pointers.length < 2) {
    return 0
  }

  const [firstPointer, secondPointer] = pointers
  return Math.hypot(
    firstPointer.clientX - secondPointer.clientX,
    firstPointer.clientY - secondPointer.clientY,
  )
}

const midpointBetweenPointers = (
  pointers: ActivePointer[],
): { x: number; y: number } => {
  if (pointers.length < 2) {
    return {
      x: 0,
      y: 0,
    }
  }

  const [firstPointer, secondPointer] = pointers
  return {
    x: (firstPointer.clientX + secondPointer.clientX) / 2,
    y: (firstPointer.clientY + secondPointer.clientY) / 2,
  }
}

const syncViewportToScale = (
  nextScale: number,
  contentX: number,
  contentY: number,
  viewportX: number,
  viewportY: number,
  originScale = scale.value,
): void => {
  const stage = stageElement.value

  if (!stage) {
    setScale(nextScale)
    return
  }

  const safeOriginScale = Math.max(originScale, minScale)
  const zoomRatio = nextScale / safeOriginScale

  setScale(nextScale)

  runAfterViewportRender(() => {
    const maxScrollLeft = stage.scrollWidth - stage.clientWidth
    const maxScrollTop = stage.scrollHeight - stage.clientHeight

    stage.scrollLeft = clampScrollValue(
      contentX * zoomRatio - viewportX,
      maxScrollLeft,
    )
    stage.scrollTop = clampScrollValue(
      contentY * zoomRatio - viewportY,
      maxScrollTop,
    )
  })
}

const handleWheelZoom = (event: WheelEvent): void => {
  if (!isOpen.value) {
    return
  }

  event.preventDefault()

  const stage = stageElement.value

  if (!stage) {
    return
  }

  const viewportPoint = getStageViewportPoint(event.clientX, event.clientY)
  syncViewportToScale(
    scale.value + (event.deltaY < 0 ? 0.15 : -0.15),
    stage.scrollLeft + viewportPoint.x,
    stage.scrollTop + viewportPoint.y,
    viewportPoint.x,
    viewportPoint.y,
  )
}

const startDrag = (pointerId: number, pointer: ActivePointer): void => {
  const stage = stageElement.value

  if (!stage || !isPannable.value) {
    dragPointerId = null
    return
  }

  dragPointerId = pointerId
  dragStartClientX = pointer.clientX
  dragStartClientY = pointer.clientY
  dragStartScrollLeft = stage.scrollLeft
  dragStartScrollTop = stage.scrollTop
  isDragging.value = false
}

const startPinch = (): void => {
  const stage = stageElement.value
  const pointers = getActivePointerList()

  if (!stage || pointers.length < 2) {
    return
  }

  const midpoint = midpointBetweenPointers(pointers)
  const viewportPoint = getStageViewportPoint(midpoint.x, midpoint.y)

  pinchStartDistance = distanceBetweenPointers(pointers)
  pinchStartScale = scale.value
  pinchStartContentX = stage.scrollLeft + viewportPoint.x
  pinchStartContentY = stage.scrollTop + viewportPoint.y
  dragPointerId = null
  isDragging.value = false
  suppressImageClick = true
}

const handlePointerDown = (event: PointerEvent): void => {
  if (event.pointerType === 'mouse' && event.button !== 0) {
    return
  }

  activePointers.set(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  })

  ;(event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId)

  if (activePointers.size >= 2) {
    startPinch()
    return
  }

  startDrag(event.pointerId, {
    clientX: event.clientX,
    clientY: event.clientY,
  })
}

const handlePointerMove = (event: PointerEvent): void => {
  const pointer = activePointers.get(event.pointerId)

  if (!pointer) {
    return
  }

  pointer.clientX = event.clientX
  pointer.clientY = event.clientY

  const stage = stageElement.value

  if (!stage) {
    return
  }

  if (activePointers.size >= 2 && pinchStartDistance > 0) {
    event.preventDefault()

    const pointers = getActivePointerList()
    const currentDistance = distanceBetweenPointers(pointers)

    if (currentDistance <= 0) {
      return
    }

    const midpoint = midpointBetweenPointers(pointers)
    const viewportPoint = getStageViewportPoint(midpoint.x, midpoint.y)

    syncViewportToScale(
      pinchStartScale * (currentDistance / pinchStartDistance),
      pinchStartContentX,
      pinchStartContentY,
      viewportPoint.x,
      viewportPoint.y,
      pinchStartScale,
    )
    return
  }

  if (dragPointerId !== event.pointerId || !isPannable.value) {
    return
  }

  event.preventDefault()

  const deltaX = event.clientX - dragStartClientX
  const deltaY = event.clientY - dragStartClientY

  if (!isDragging.value && Math.hypot(deltaX, deltaY) > 6) {
    isDragging.value = true
    suppressImageClick = true
  }

  stage.scrollLeft = clampScrollValue(
    dragStartScrollLeft - deltaX,
    stage.scrollWidth - stage.clientWidth,
  )
  stage.scrollTop = clampScrollValue(
    dragStartScrollTop - deltaY,
    stage.scrollHeight - stage.clientHeight,
  )
}

const resetPinchState = (): void => {
  pinchStartDistance = 0
  pinchStartScale = minScale
  pinchStartContentX = 0
  pinchStartContentY = 0
}

const releasePointer = (pointerId: number): void => {
  activePointers.delete(pointerId)

  if (dragPointerId === pointerId) {
    dragPointerId = null

    if (isDragging.value) {
      runAfterViewportRender(() => {
        isDragging.value = false
      })
    }
  }

  if (activePointers.size >= 2) {
    startPinch()
    return
  }

  resetPinchState()

  if (activePointers.size === 1) {
    const [remainingPointerId, remainingPointer] = Array.from(activePointers.entries())[0]
    startDrag(remainingPointerId, remainingPointer)
  }
}

const handlePointerUp = (event: PointerEvent): void => {
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
  releasePointer(event.pointerId)
}

const handlePointerCancel = (event: PointerEvent): void => {
  ;(event.currentTarget as HTMLElement | null)?.releasePointerCapture?.(event.pointerId)
  releasePointer(event.pointerId)
}

const handleImageClick = (): void => {
  if (suppressImageClick) {
    suppressImageClick = false
    return
  }

  toggleScale()
}

const handleImageLoad = (event: Event): void => {
  const image = event.target as HTMLImageElement | null

  naturalImageWidth.value = image?.naturalWidth ?? 0
  updateStageWidth()
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
  async (value) => {
    if (typeof document === 'undefined') {
      return
    }

    if (value) {
      document.body.style.overflow = 'hidden'
      await nextTick()
      updateStageWidth()
      window.addEventListener('keydown', handleKeydown)
      return
    }

    document.body.style.overflow = ''
    window.removeEventListener('keydown', handleKeydown)
    naturalImageWidth.value = 0
    activePointers.clear()
    dragPointerId = null
    isDragging.value = false
    suppressImageClick = false
    resetPinchState()
  },
  { immediate: true },
)

watch(scale, (value) => {
  if (value > minScale) {
    return
  }

  runAfterViewportRender(() => {
    const stage = stageElement.value

    if (!stage) {
      return
    }

    stage.scrollLeft = 0
    stage.scrollTop = 0
  })
})

watch(stageElement, (value) => {
  observeStageElement(value)
})

onMounted(() => {
  if (typeof ResizeObserver === 'undefined') {
    return
  }

  stageResizeObserver = new ResizeObserver(() => {
    updateStageWidth()
  })

  observeStageElement(stageElement.value)
})

onBeforeUnmount(() => {
  if (typeof document !== 'undefined') {
    document.body.style.overflow = ''
  }

  stageResizeObserver?.disconnect()
  stageResizeObserver = null
  observedStageElement = null
  activePointers.clear()
  dragPointerId = null
  isDragging.value = false
  suppressImageClick = false
  window.removeEventListener('keydown', handleKeydown)

  if (pendingViewportFrame && typeof window !== 'undefined') {
    window.cancelAnimationFrame(pendingViewportFrame)
  }

  pendingViewportFrame = 0
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
              &times;
            </button>
          </div>
        </div>

        <div
          ref="stageElement"
          class="image-viewer__stage"
          @wheel="handleWheelZoom"
        >
          <div class="image-viewer__canvas">
            <img
              class="image-viewer__image"
              :class="{
                'image-viewer__image--zoomed': scale > minScale,
                'image-viewer__image--pannable': isPannable,
                'image-viewer__image--dragging': isDragging,
              }"
              :src="src"
              :alt="alt || title || 'Изображение'"
              :style="{
                width: imageWidth,
              }"
              @load="handleImageLoad"
              @click.stop="handleImageClick"
              @pointerdown="handlePointerDown"
              @pointermove="handlePointerMove"
              @pointerup="handlePointerUp"
              @pointercancel="handlePointerCancel"
            />
          </div>
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
  padding: 1rem;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
}

.image-viewer__canvas {
  width: max-content;
  min-width: 100%;
  min-height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
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

.image-viewer__image--pannable {
  cursor: grab;
}

.image-viewer__image--dragging {
  cursor: grabbing;
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
