import type {
  CreateCategoryInput,
} from '@/services/client/knowledgeBaseApi'
import type { Category } from '@/types'

export interface CategoryFormValues {
  name: string
  description: string
  color: string
  icon: string
  sortOrder: string
}

export const CATEGORY_COLOR_PRESETS = [
  '#f2d06b',
  '#6cbf93',
  '#df8f67',
  '#6fa1d8',
  '#cc785d',
  '#9271c9',
] as const

const normalizeOptionalString = (value: string): string | null => {
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

export const createEmptyCategoryForm = (): CategoryFormValues => ({
  name: '',
  description: '',
  color: CATEGORY_COLOR_PRESETS[0],
  icon: '',
  sortOrder: '0',
})

export const createCategoryFormFromCategory = (
  category: Category,
): CategoryFormValues => ({
  name: category.name,
  description: category.description,
  color: category.color ?? '',
  icon: category.icon ?? '',
  sortOrder: String(category.sortOrder),
})

export const toCategoryMutationInput = (
  values: CategoryFormValues,
): CreateCategoryInput => {
  const parsedSortOrder = Number.parseInt(values.sortOrder.trim(), 10)

  return {
    name: values.name.trim(),
    description: values.description.trim(),
    color: normalizeOptionalString(values.color),
    icon: normalizeOptionalString(values.icon)?.slice(0, 4).toUpperCase() ?? null,
    sortOrder: Number.isFinite(parsedSortOrder) ? parsedSortOrder : 0,
  }
}
