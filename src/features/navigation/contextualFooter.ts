import { computed, readonly, ref } from 'vue'

interface ContextualFooterInput {
  title: string
  onBack?: (() => void) | null
}

const title = ref<string | null>(null)
const backAction = ref<(() => void) | null>(null)

export const setContextualFooter = (input: ContextualFooterInput): void => {
  title.value = input.title.trim()
  backAction.value = input.onBack ?? null
}

export const clearContextualFooter = (): void => {
  title.value = null
  backAction.value = null
}

export const useContextualFooter = () => {
  const isVisible = computed(() => Boolean(title.value))
  const hasBackAction = computed(() => Boolean(backAction.value))

  const triggerBack = (): void => {
    backAction.value?.()
  }

  return {
    title: readonly(title),
    isVisible,
    hasBackAction,
    triggerBack,
  }
}
