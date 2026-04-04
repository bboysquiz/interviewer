import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import {
  knowledgeBaseApi,
  type CreateCategoryInput,
  type UpdateCategoryInput,
} from '@/services/client/knowledgeBaseApi'
import type { Category } from '@/types'

const fallbackCategories: Category[] = [
  {
    id: 'javascript',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    slug: 'javascript',
    name: 'JavaScript',
    description: 'Язык, event loop, async-паттерны и ключевые концепции.',
    color: null,
    icon: null,
    sortOrder: 0,
    noteIds: [],
    noteCount: 0,
    attachmentCount: 0,
  },
  {
    id: 'vue',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    slug: 'vue',
    name: 'Vue',
    description: 'Composition API, компоненты, reactivity и архитектурные заметки.',
    color: null,
    icon: null,
    sortOrder: 0,
    noteIds: [],
    noteCount: 0,
    attachmentCount: 0,
  },
  {
    id: 'git',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    slug: 'git',
    name: 'Git',
    description: 'Команды, ветвление, rebase и сценарии для собеседований.',
    color: null,
    icon: null,
    sortOrder: 0,
    noteIds: [],
    noteCount: 0,
    attachmentCount: 0,
  },
  {
    id: 'css',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    slug: 'css',
    name: 'CSS',
    description: 'Layout, каскад, адаптивность и типовые UI-задачи.',
    color: null,
    icon: null,
    sortOrder: 0,
    noteIds: [],
    noteCount: 0,
    attachmentCount: 0,
  },
  {
    id: 'html',
    createdAt: '2026-04-02T00:00:00.000Z',
    updatedAt: '2026-04-02T00:00:00.000Z',
    slug: 'html',
    name: 'HTML',
    description: 'Семантика, доступность и структура интерфейсов.',
    color: null,
    icon: null,
    sortOrder: 0,
    noteIds: [],
    noteCount: 0,
    attachmentCount: 0,
  },
]

const sortCategories = (value: Category[]): Category[] =>
  [...value].sort((left, right) => left.name.localeCompare(right.name, 'ru'))

export const useKnowledgeBaseStore = defineStore('knowledge-base', () => {
  const categories = ref<Category[]>(sortCategories(fallbackCategories))
  const isLoading = ref(false)
  const hasLoaded = ref(false)
  const loadError = ref<string | null>(null)

  const totalCategories = computed(() => categories.value.length)

  const loadCategories = async (): Promise<void> => {
    if (isLoading.value) {
      return
    }

    isLoading.value = true

    try {
      categories.value = sortCategories(await knowledgeBaseApi.listCategories())
      hasLoaded.value = true
      loadError.value = null
    } catch (error) {
      loadError.value =
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить категории.'
    } finally {
      isLoading.value = false
    }
  }

  const createCategory = async (
    input: CreateCategoryInput,
  ): Promise<Category> => {
    const created = await knowledgeBaseApi.createCategory(input)
    categories.value = sortCategories([...categories.value, created])
    return created
  }

  const updateCategory = async (
    categoryId: string,
    input: UpdateCategoryInput,
  ): Promise<Category> => {
    const updated = await knowledgeBaseApi.updateCategory(categoryId, input)
    categories.value = sortCategories(
      categories.value.map((category) =>
        category.id === categoryId ? updated : category,
      ),
    )
    return updated
  }

  const deleteCategory = async (categoryId: string): Promise<void> => {
    await knowledgeBaseApi.deleteCategory(categoryId)
    categories.value = categories.value.filter(
      (category) => category.id !== categoryId,
    )
  }

  return {
    categories,
    isLoading,
    hasLoaded,
    loadError,
    totalCategories,
    loadCategories,
    createCategory,
    updateCategory,
    deleteCategory,
  }
})
