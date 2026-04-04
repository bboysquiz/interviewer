import { computed, ref } from 'vue'

interface OpenImageViewerInput {
  src: string
  alt?: string | null
  title?: string | null
}

const MIN_IMAGE_SCALE = 1
const MAX_IMAGE_SCALE = 4
const IMAGE_SCALE_STEP = 0.25

const isImageViewerOpen = ref(false)
const imageViewerSrc = ref('')
const imageViewerAlt = ref('')
const imageViewerTitle = ref<string | null>(null)
const imageViewerScale = ref(MIN_IMAGE_SCALE)

const clampImageScale = (value: number): number =>
  Math.min(MAX_IMAGE_SCALE, Math.max(MIN_IMAGE_SCALE, value))

export const openImageViewer = (input: OpenImageViewerInput): void => {
  if (!input.src.trim()) {
    return
  }

  imageViewerSrc.value = input.src
  imageViewerAlt.value = input.alt?.trim() ?? ''
  imageViewerTitle.value = input.title?.trim() ?? null
  imageViewerScale.value = MIN_IMAGE_SCALE
  isImageViewerOpen.value = true
}

export const closeImageViewer = (): void => {
  isImageViewerOpen.value = false
  imageViewerScale.value = MIN_IMAGE_SCALE
}

export const setImageViewerScale = (value: number): void => {
  imageViewerScale.value = clampImageScale(value)
}

export const zoomInImageViewer = (): void => {
  setImageViewerScale(imageViewerScale.value + IMAGE_SCALE_STEP)
}

export const zoomOutImageViewer = (): void => {
  setImageViewerScale(imageViewerScale.value - IMAGE_SCALE_STEP)
}

export const resetImageViewerScale = (): void => {
  imageViewerScale.value = MIN_IMAGE_SCALE
}

export const toggleImageViewerScale = (): void => {
  imageViewerScale.value =
    imageViewerScale.value > MIN_IMAGE_SCALE ? MIN_IMAGE_SCALE : 2
}

export const useImageViewer = () => ({
  isOpen: computed(() => isImageViewerOpen.value),
  src: computed(() => imageViewerSrc.value),
  alt: computed(() => imageViewerAlt.value),
  title: computed(() => imageViewerTitle.value),
  scale: computed(() => imageViewerScale.value),
  minScale: MIN_IMAGE_SCALE,
  maxScale: MAX_IMAGE_SCALE,
  close: closeImageViewer,
  setScale: setImageViewerScale,
  zoomIn: zoomInImageViewer,
  zoomOut: zoomOutImageViewer,
  resetScale: resetImageViewerScale,
  toggleScale: toggleImageViewerScale,
})
