<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useRoute, useRouter } from 'vue-router'

import { buildApiUrl } from '@/services/client/http'
import { knowledgeBaseApi } from '@/services/client/knowledgeBaseApi'
import { highlightText } from '@/shared/lib/highlight'
import { formatDateTime } from '@/shared/lib/format'
import AppNotice from '@/shared/ui/AppNotice.vue'
import SurfaceCard from '@/shared/ui/SurfaceCard.vue'
import { useKnowledgeBaseStore } from '@/stores/knowledgeBase'
import type { SearchResult, SearchResultSource } from '@/types'

interface NoteSearchGroup {
  noteId: string
  categoryId: string
  noteTitle: string
  categoryName: string
  updatedAt: string
  matches: SearchResult[]
}

interface ImageSearchGroup {
  attachmentId: string
  attachmentName: string
  attachmentStoragePath: string | null
  noteId: string
  categoryId: string
  noteTitle: string
  categoryName: string
  updatedAt: string
  matches: SearchResult[]
}

const route = useRoute()
const router = useRouter()
const knowledgeBaseStore = useKnowledgeBaseStore()
const { categories, hasLoaded, isLoading: areCategoriesLoading, loadError: categoriesLoadError } =
  storeToRefs(knowledgeBaseStore)

const initialQuery =
  typeof route.query.q === 'string' ? route.query.q.trim() : ''
const initialCategoryId =
  typeof route.query.categoryId === 'string' ? route.query.categoryId : ''

const searchDraft = ref(initialQuery)
const selectedCategoryId = ref(initialCategoryId)
const searchResults = ref<SearchResult[]>([])
const isSearching = ref(false)
const searchError = ref<string | null>(null)
const hasSearched = ref(false)

let debounceHandle: ReturnType<typeof setTimeout> | null = null
let requestSequence = 0

const searchExamples = [
  'event loop',
  'microtask',
  'Promise.allSettled',
  'reactivity diagram',
]

const sourceLabels: Record<SearchResultSource, string> = {
  note_title: 'Заголовок заметки',
  note_content: 'Текст заметки',
  attachment_extracted_text: 'Текст на изображении',
  attachment_description: 'Описание изображения',
}

const sourcePriority: Record<SearchResultSource, number> = {
  note_title: 0,
  note_content: 1,
  attachment_extracted_text: 2,
  attachment_description: 3,
}

const activeScopes = [
  'Title заметки',
  'Raw text заметки',
  'Extracted text изображения',
  'Image summary',
]

const suggestedTags = computed(() =>
  categories.value.slice(0, 4).map((category) => category.name),
)

const categoryOptions = computed(() => [
  {
    id: '',
    name: 'Все категории',
  },
  ...categories.value.map((category) => ({
    id: category.id,
    name: category.name,
  })),
])

const currentQuery = computed(() => searchDraft.value.trim())

const noteMatches = computed(() =>
  searchResults.value.filter(
    (result) =>
      result.source === 'note_title' || result.source === 'note_content',
  ),
)

const imageMatches = computed(() =>
  searchResults.value.filter(
    (result) =>
      result.source === 'attachment_extracted_text' ||
      result.source === 'attachment_description',
  ),
)

const noteGroups = computed<NoteSearchGroup[]>(() => {
  const grouped = new Map<string, NoteSearchGroup>()

  for (const result of noteMatches.value) {
    const currentGroup = grouped.get(result.noteId)

    if (!currentGroup) {
      grouped.set(result.noteId, {
        noteId: result.noteId,
        categoryId: result.categoryId,
        noteTitle: result.noteTitle,
        categoryName: result.categoryName,
        updatedAt: result.updatedAt,
        matches: [result],
      })
      continue
    }

    currentGroup.matches.push(result)

    if (result.updatedAt > currentGroup.updatedAt) {
      currentGroup.updatedAt = result.updatedAt
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort((left, right) => {
        if (sourcePriority[left.source] !== sourcePriority[right.source]) {
          return sourcePriority[left.source] - sourcePriority[right.source]
        }

        return left.rank - right.rank
      }),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

const imageGroups = computed<ImageSearchGroup[]>(() => {
  const grouped = new Map<string, ImageSearchGroup>()

  for (const result of imageMatches.value) {
    if (!result.attachmentId) {
      continue
    }

    const currentGroup = grouped.get(result.attachmentId)

    if (!currentGroup) {
      grouped.set(result.attachmentId, {
        attachmentId: result.attachmentId,
        attachmentName: result.attachmentName ?? 'Изображение',
        attachmentStoragePath: result.attachmentStoragePath,
        noteId: result.noteId,
        categoryId: result.categoryId,
        noteTitle: result.noteTitle,
        categoryName: result.categoryName,
        updatedAt: result.updatedAt,
        matches: [result],
      })
      continue
    }

    currentGroup.matches.push(result)

    if (result.updatedAt > currentGroup.updatedAt) {
      currentGroup.updatedAt = result.updatedAt
    }
  }

  return [...grouped.values()]
    .map((group) => ({
      ...group,
      matches: [...group.matches].sort((left, right) => left.rank - right.rank),
    }))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
})

const resultCountLabel = computed(() => {
  const count = searchResults.value.length

  if (count === 1) {
    return '1 совпадение'
  }

  if (count >= 2 && count <= 4) {
    return `${count} совпадения`
  }

  return `${count} совпадений`
})

const noteCountLabel = computed(() => {
  const count = noteGroups.value.length

  if (count === 1) {
    return '1 заметка'
  }

  if (count >= 2 && count <= 4) {
    return `${count} заметки`
  }

  return `${count} заметок`
})

const imageCountLabel = computed(() => {
  const count = imageGroups.value.length

  if (count === 1) {
    return '1 изображение'
  }

  if (count >= 2 && count <= 4) {
    return `${count} изображения`
  }

  return `${count} изображений`
})

const syncRouteState = async (): Promise<void> => {
  const query = currentQuery.value
  const categoryId = selectedCategoryId.value

  await router.replace({
    name: 'search',
    query: {
      ...(query ? { q: query } : {}),
      ...(categoryId ? { categoryId } : {}),
    },
  })
}

const executeSearch = async (): Promise<void> => {
  const query = currentQuery.value
  const categoryId = selectedCategoryId.value || undefined
  const currentRequestId = ++requestSequence

  await syncRouteState()

  if (!query) {
    searchResults.value = []
    searchError.value = null
    hasSearched.value = false
    isSearching.value = false
    return
  }

  isSearching.value = true
  hasSearched.value = true
  searchError.value = null

  try {
    const results = await knowledgeBaseApi.search({
      query,
      categoryId,
    })

    if (currentRequestId !== requestSequence) {
      return
    }

    searchResults.value = results
  } catch (error) {
    if (currentRequestId !== requestSequence) {
      return
    }

    searchResults.value = []
    searchError.value =
      error instanceof Error ? error.message : 'Не удалось выполнить поиск.'
  } finally {
    if (currentRequestId === requestSequence) {
      isSearching.value = false
    }
  }
}

const scheduleSearch = (): void => {
  if (debounceHandle) {
    clearTimeout(debounceHandle)
  }

  debounceHandle = setTimeout(() => {
    void executeSearch()
  }, 300)
}

watch([searchDraft, selectedCategoryId], () => {
  scheduleSearch()
})

if (initialQuery) {
  hasSearched.value = true
  scheduleSearch()
}

onBeforeUnmount(() => {
  if (debounceHandle) {
    clearTimeout(debounceHandle)
  }
})

const submitSearch = async (): Promise<void> => {
  if (debounceHandle) {
    clearTimeout(debounceHandle)
    debounceHandle = null
  }

  await executeSearch()
}

const applySuggestion = async (value: string): Promise<void> => {
  searchDraft.value = value
  await submitSearch()
}

const clearSearch = async (): Promise<void> => {
  searchDraft.value = ''
  searchResults.value = []
  hasSearched.value = false
  searchError.value = null
  await syncRouteState()
}

const clearCategoryFilter = async (): Promise<void> => {
  selectedCategoryId.value = ''
  await submitSearch()
}

const highlightedText = (value: string): string =>
  highlightText(value, currentQuery.value)

const attachmentPreviewUrl = (storagePath: string | null): string | null =>
  storagePath ? buildApiUrl(storagePath) : null

onMounted(() => {
  if (!hasLoaded.value) {
    void knowledgeBaseStore.loadCategories()
  }
})
</script>

<template>
  <div class="page-stack search-page">
    <SurfaceCard eyebrow="Поиск" title="Быстрый поиск для повторения">
      <AppNotice
        v-if="areCategoriesLoading && !hasLoaded"
        tone="loading"
        title="Подключаем фильтры"
        message="Загружаем категории, чтобы можно было сузить поиск по теме."
      />

      <form class="search-page__form" @submit.prevent="void submitSearch()">
        <label class="search-page__field">
          <span class="search-page__label">Запрос</span>
          <input
            v-model.trim="searchDraft"
            class="search-page__input"
            type="search"
            name="q"
            placeholder="Например, event loop или Promise.allSettled"
            enterkeyhint="search"
          />
        </label>

        <label class="search-page__field">
          <span class="search-page__label">Категория</span>
          <select
            v-model="selectedCategoryId"
            class="search-page__select"
            name="categoryId"
          >
            <option
              v-for="option in categoryOptions"
              :key="option.id || 'all-categories'"
              :value="option.id"
            >
              {{ option.name }}
            </option>
          </select>
        </label>

        <div class="search-page__actions">
          <button
            class="app-button app-button--primary"
            type="submit"
            :disabled="isSearching"
          >
            {{ isSearching ? 'Ищем...' : 'Найти' }}
          </button>

          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="!searchDraft && !selectedCategoryId"
            @click="void clearSearch()"
          >
            Очистить запрос
          </button>

          <button
            v-if="selectedCategoryId"
            class="app-button app-button--ghost"
            type="button"
            @click="void clearCategoryFilter()"
          >
            Сбросить категорию
          </button>
        </div>
      </form>

      <div class="chip-row">
        <button
          v-for="scope in activeScopes"
          :key="scope"
          class="chip chip--active search-page__chip"
          type="button"
        >
          {{ scope }}
        </button>
      </div>

      <div class="chip-row">
        <button
          v-for="example in searchExamples"
          :key="example"
          class="chip search-page__chip"
          type="button"
          @click="void applySuggestion(example)"
        >
          {{ example }}
        </button>
        <button
          v-for="tag in suggestedTags"
          :key="tag"
          class="chip search-page__chip"
          type="button"
          @click="void applySuggestion(tag)"
        >
          {{ tag }}
        </button>
      </div>

      <AppNotice
        v-if="isSearching"
        tone="loading"
        title="Ищем по базе знаний"
        message="Проверяем заметки, OCR по изображениям и сохраненные описания."
        compact
      />

      <AppNotice
        v-if="categoriesLoadError"
        tone="warning"
        title="Категории пока не обновились"
        :message="categoriesLoadError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="areCategoriesLoading"
            @click="void knowledgeBaseStore.loadCategories()"
          >
            {{ areCategoriesLoading ? 'Пробуем снова...' : 'Повторить' }}
          </button>
        </template>
      </AppNotice>

      <AppNotice
        v-if="searchError"
        tone="error"
        title="Поиск не выполнился"
        :message="searchError"
      >
        <template #actions>
          <button
            class="app-button app-button--secondary"
            type="button"
            :disabled="isSearching || !currentQuery"
            @click="void submitSearch()"
          >
            {{ isSearching ? 'Пробуем снова...' : 'Повторить поиск' }}
          </button>
        </template>
      </AppNotice>

      <div v-else-if="hasSearched" class="search-page__summary">
        <span class="tag">{{ resultCountLabel }}</span>
        <span class="tag">{{ noteCountLabel }}</span>
        <span class="tag">{{ imageCountLabel }}</span>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="!hasSearched"
      eyebrow="Подсказка"
      title="Что ищется"
    >
      <div class="search-page__empty">
        Поиск работает сразу по title заметки, raw text заметки, extracted text
        изображения и image summary. Ввод срабатывает с короткой задержкой, так
        что страницу можно использовать как быстрый personal recall screen.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-else-if="isSearching && !searchResults.length"
      eyebrow="Результаты"
      title="Ищем по заметкам и OCR"
    >
      <AppNotice
        tone="loading"
        title="Поиск выполняется"
        message="Проверяем заголовки заметок, обычный текст и извлеченный текст из изображений."
      />
    </SurfaceCard>

    <SurfaceCard
      v-else-if="!searchResults.length && !isSearching && !searchError"
      eyebrow="Результаты"
      title="Ничего не найдено"
    >
      <div class="search-page__empty">
        Попробуй более короткий термин, конкретный API name или сними фильтр по
        категории.
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="hasSearched && noteGroups.length"
      eyebrow="Заметки"
      title="Совпадения в тексте заметок"
    >
      <div class="search-page__results">
        <article
          v-for="group in noteGroups"
          :key="group.noteId"
          class="search-group-card"
        >
          <div class="search-group-card__header">
            <div class="search-group-card__copy">
              <h3
                class="search-group-card__title"
                v-html="highlightedText(group.noteTitle)"
              />
              <div class="tag-row search-group-card__meta">
                <span class="tag">{{ group.categoryName }}</span>
                <span class="tag">
                  Обновлено: {{ formatDateTime(group.updatedAt) }}
                </span>
                <span class="tag">{{ group.matches.length }} совпадений</span>
              </div>
            </div>

            <RouterLink
              class="app-button app-button--primary search-group-card__link"
              :to="{
                name: 'note-detail',
                params: {
                  categoryId: group.categoryId,
                  noteId: group.noteId,
                },
                query: currentQuery ? { q: currentQuery } : {},
              }"
            >
              К заметке
            </RouterLink>
          </div>

          <div class="search-group-card__matches">
            <article
              v-for="match in group.matches"
              :key="match.chunkId"
              class="search-match-card"
            >
              <div class="search-match-card__top">
                <span class="search-match-card__source">
                  {{ sourceLabels[match.source] }}
                </span>
              </div>

              <p
                class="search-match-card__excerpt"
                v-html="highlightedText(match.excerpt)"
              />
            </article>
          </div>
        </article>
      </div>
    </SurfaceCard>

    <SurfaceCard
      v-if="hasSearched && imageGroups.length"
      eyebrow="Изображения"
      title="Совпадения во вложениях"
    >
      <div class="search-page__results">
        <article
          v-for="group in imageGroups"
          :key="group.attachmentId"
          class="search-group-card search-group-card--image"
        >
          <div class="search-group-card__header">
            <div class="search-group-card__copy">
              <div
                v-if="attachmentPreviewUrl(group.attachmentStoragePath)"
                class="search-image-card__preview-wrap"
              >
                <img
                  class="search-image-card__preview"
                  :src="attachmentPreviewUrl(group.attachmentStoragePath) ?? ''"
                  :alt="group.attachmentName"
                  loading="lazy"
                />
              </div>

              <h3
                class="search-group-card__title"
                v-html="highlightedText(group.attachmentName)"
              />
              <div class="tag-row search-group-card__meta">
                <span class="tag">{{ group.categoryName }}</span>
                <span class="tag">{{ group.noteTitle }}</span>
                <span class="tag">{{ group.matches.length }} совпадений</span>
              </div>
            </div>

            <RouterLink
              class="app-button app-button--primary search-group-card__link"
              :to="{
                name: 'note-detail',
                params: {
                  categoryId: group.categoryId,
                  noteId: group.noteId,
                },
                query: {
                  ...(currentQuery ? { q: currentQuery } : {}),
                  attachmentId: group.attachmentId,
                },
              }"
            >
              К вложению
            </RouterLink>
          </div>

          <div class="search-group-card__matches">
            <article
              v-for="match in group.matches"
              :key="match.chunkId"
              class="search-match-card"
            >
              <div class="search-match-card__top">
                <span class="search-match-card__source">
                  {{ sourceLabels[match.source] }}
                </span>
              </div>

              <p
                class="search-match-card__excerpt"
                v-html="highlightedText(match.excerpt)"
              />
            </article>
          </div>
        </article>
      </div>
    </SurfaceCard>
  </div>
</template>

<style scoped>
.search-page__form {
  display: flex;
  flex-direction: column;
  gap: 0.88rem;
}

.search-page__field {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.search-page__label {
  color: var(--text-muted);
  font-size: 0.78rem;
  font-weight: 700;
}

.search-page__input,
.search-page__select {
  width: 100%;
  border: 1px solid rgba(180, 154, 123, 0.35);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  color: var(--text);
  padding: 0.82rem 0.94rem;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    background-color 0.2s ease;
}

.search-page__input:focus,
.search-page__select:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(31, 109, 90, 0.12);
  background: var(--surface-strong);
}

.search-page__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.6rem;
}

.search-page__chip {
  border: 0;
}

.search-page__feedback {
  margin: 0;
  padding: 0.78rem 0.9rem;
  border-radius: 16px;
  font-size: 0.88rem;
}

.search-page__feedback--error {
  background: rgba(181, 65, 59, 0.12);
  color: #9f3b35;
}

.search-page__summary {
  display: flex;
  flex-wrap: wrap;
  gap: 0.52rem;
}

.search-page__empty {
  padding: 1rem;
  border: 1px dashed rgba(180, 154, 123, 0.4);
  border-radius: 18px;
  color: var(--text-muted);
  text-align: center;
}

.search-page__results {
  display: flex;
  flex-direction: column;
  gap: 0.82rem;
}

.search-group-card {
  display: flex;
  flex-direction: column;
  gap: 0.92rem;
  padding: 1.02rem;
  border: 1px solid rgba(180, 154, 123, 0.24);
  border-radius: 22px;
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.76), rgba(255, 250, 243, 0.58));
  box-shadow: 0 12px 24px rgba(71, 50, 24, 0.06);
  transition:
    transform 0.18s ease,
    border-color 0.18s ease,
    box-shadow 0.18s ease;
}

.search-group-card--image {
  background:
    linear-gradient(180deg, rgba(255, 248, 241, 0.94), rgba(255, 245, 234, 0.78));
}

.search-group-card__header {
  display: flex;
  flex-direction: column;
  gap: 0.72rem;
}

.search-group-card__copy {
  min-width: 0;
}

.search-group-card__title {
  margin: 0;
  font-size: 1.04rem;
  line-height: 1.22;
}

.search-group-card__meta {
  margin-top: 0.4rem;
}

.search-group-card__link {
  width: 100%;
}

.search-group-card__matches {
  display: flex;
  flex-direction: column;
  gap: 0.66rem;
}

.search-match-card {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  padding: 0.9rem;
  border-radius: 20px;
  background: rgba(255, 250, 243, 0.82);
  border: 1px solid rgba(180, 154, 123, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.36);
}

.search-match-card__top {
  display: flex;
  flex-wrap: wrap;
  gap: 0.48rem;
  align-items: center;
  justify-content: space-between;
}

.search-match-card__source {
  display: inline-flex;
  align-items: center;
  padding: 0.34rem 0.54rem;
  border-radius: 999px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 0.76rem;
  font-weight: 700;
}

.search-match-card__excerpt {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.92rem;
  line-height: 1.52;
}

.search-image-card__preview-wrap {
  margin-bottom: 0.78rem;
  overflow: hidden;
  border-radius: 20px;
  background: rgba(240, 229, 215, 0.6);
  box-shadow: 0 10px 20px rgba(71, 50, 24, 0.08);
}

.search-image-card__preview {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  object-fit: cover;
}

.search-page :deep(mark) {
  padding: 0.04rem 0.18rem;
  border-radius: 0.32rem;
  background: rgba(207, 116, 64, 0.22);
  color: var(--text);
}

@media (hover: hover) {
  .search-group-card:hover {
    transform: translateY(-1px);
    border-color: rgba(31, 109, 90, 0.16);
    box-shadow: 0 16px 28px rgba(71, 50, 24, 0.09);
  }
}

@media (min-width: 420px) {
  .search-group-card__header {
    flex-direction: row;
    align-items: flex-end;
    justify-content: space-between;
  }

  .search-group-card__link {
    width: auto;
    min-width: 7.5rem;
  }
}
</style>
