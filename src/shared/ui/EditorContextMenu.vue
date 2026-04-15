<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

interface EditorContextMenuAction {
  id: string
  label: string
  disabled?: boolean
}

const props = defineProps<{
  open: boolean
  x: number
  y: number
  actions: EditorContextMenuAction[]
}>()

const emit = defineEmits<{
  select: [actionId: string]
  close: []
}>()

const panelElement = ref<HTMLElement | null>(null)
const panelPosition = ref({
  left: 0,
  top: 0,
})

const clampPanelPosition = async (): Promise<void> => {
  if (!props.open) {
    return
  }

  await nextTick()

  if (typeof window === 'undefined') {
    panelPosition.value = {
      left: props.x,
      top: props.y,
    }
    return
  }

  const panel = panelElement.value
  const panelWidth = panel?.offsetWidth ?? 0
  const panelHeight = panel?.offsetHeight ?? 0
  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const edgeOffset = 12

  panelPosition.value = {
    left: Math.max(
      edgeOffset,
      Math.min(props.x, viewportWidth - panelWidth - edgeOffset),
    ),
    top: Math.max(
      edgeOffset,
      Math.min(props.y, viewportHeight - panelHeight - edgeOffset),
    ),
  }
}

const panelStyle = computed(() => ({
  left: `${panelPosition.value.left}px`,
  top: `${panelPosition.value.top}px`,
}))

const handleActionClick = (action: EditorContextMenuAction): void => {
  if (action.disabled) {
    return
  }

  emit('select', action.id)
}

watch(
  () => [props.open, props.x, props.y],
  () => {
    void clampPanelPosition()
  },
  { immediate: true },
)

const handleWindowResize = (): void => {
  void clampPanelPosition()
}

if (typeof window !== 'undefined') {
  window.addEventListener('resize', handleWindowResize)
}

onBeforeUnmount(() => {
  if (typeof window !== 'undefined') {
    window.removeEventListener('resize', handleWindowResize)
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="props.open"
      class="editor-context-menu"
      @click="emit('close')"
      @contextmenu.prevent="emit('close')"
    >
      <div
        ref="panelElement"
        class="editor-context-menu__panel"
        :style="panelStyle"
        @click.stop
      >
        <button
          v-for="action in props.actions"
          :key="action.id"
          class="editor-context-menu__action"
          :class="{
            'editor-context-menu__action--disabled': action.disabled,
          }"
          type="button"
          :disabled="action.disabled"
          @click="handleActionClick(action)"
        >
          {{ action.label }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.editor-context-menu {
  position: fixed;
  inset: 0;
  z-index: 80;
}

.editor-context-menu__panel {
  position: fixed;
  min-width: 14rem;
  max-width: min(18rem, calc(100vw - 1.5rem));
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  padding: 0.35rem;
  border: 1px solid rgba(180, 154, 123, 0.26);
  border-radius: 18px;
  background: rgba(255, 251, 246, 0.98);
  box-shadow: 0 18px 36px rgba(35, 28, 21, 0.16);
  backdrop-filter: blur(14px);
}

.editor-context-menu__action {
  min-height: 2.6rem;
  padding: 0.55rem 0.78rem;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  font-weight: 600;
}

.editor-context-menu__action:hover:not(:disabled) {
  background: rgba(31, 109, 90, 0.1);
}

.editor-context-menu__action--disabled,
.editor-context-menu__action:disabled {
  opacity: 0.42;
}
</style>
