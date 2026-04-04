import { createRouter, createWebHistory } from 'vue-router'
import type { RouteRecordRaw } from 'vue-router'

import AnalyticsPage from '@/pages/AnalyticsPage.vue'
import CategoryNotesPage from '@/pages/CategoryNotesPage.vue'
import CategoriesPage from '@/pages/CategoriesPage.vue'
import HistoryDetailPage from '@/pages/HistoryDetailPage.vue'
import HistoryPage from '@/pages/HistoryPage.vue'
import HomePage from '@/pages/HomePage.vue'
import InterviewPage from '@/pages/InterviewPage.vue'
import NoteDetailPage from '@/pages/NoteDetailPage.vue'
import SearchPage from '@/pages/SearchPage.vue'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: {
      eyebrow: 'Programming Interviewer',
      title: 'Главная',
      subtitle: 'Короткий обзор базы знаний и самые частые сценарии использования.',
      badge: 'MVP',
    },
  },
  {
    path: '/categories',
    name: 'categories',
    component: CategoriesPage,
    meta: {
      eyebrow: 'Knowledge Base',
      title: 'Категории',
      subtitle: 'Темы, из которых будет собрана твоя личная техническая база.',
      badge: 'Fast',
    },
  },
  {
    path: '/categories/:categoryId',
    name: 'category-notes',
    component: CategoryNotesPage,
    meta: {
      eyebrow: 'Knowledge Base',
      title: 'Заметки',
      subtitle: 'Все заметки выбранной категории в одном мобильном экране.',
      badge: 'Notes',
      navigationRoute: 'categories',
    },
  },
  {
    path: '/categories/:categoryId/notes/:noteId',
    name: 'note-detail',
    component: NoteDetailPage,
    meta: {
      eyebrow: 'Knowledge Base',
      title: 'Заметка',
      subtitle: 'Просмотр, редактирование и удаление текста без лишних переходов.',
      badge: 'View',
      navigationRoute: 'categories',
    },
  },
  {
    path: '/search',
    name: 'search',
    component: SearchPage,
    meta: {
      eyebrow: 'Unified Search',
      title: 'Поиск',
      subtitle: 'Один экран для заметок, OCR-текста и описаний изображений.',
      badge: 'OCR',
    },
  },
  {
    path: '/interview',
    name: 'interview',
    component: InterviewPage,
    meta: {
      eyebrow: 'Interview Trainer',
      title: 'Собеседование',
      subtitle: 'Генерация вопросов и разбор ответов через реальные API endpointы.',
      badge: 'AI',
    },
  },
  {
    path: '/history',
    name: 'history',
    component: HistoryPage,
    meta: {
      eyebrow: 'Review Log',
      title: 'История',
      subtitle: 'Прошлые ответы, оценки и рекомендации для следующего повторения.',
      badge: 'Log',
    },
  },
  {
    path: '/analytics',
    name: 'analytics',
    component: AnalyticsPage,
    meta: {
      eyebrow: 'Analytics',
      title: 'Аналитика',
      subtitle: 'Лимиты, usage и остатки по AI-операциям в одном месте.',
      badge: 'Stats',
    },
  },
  {
    path: '/history/:sessionId',
    name: 'history-detail',
    component: HistoryDetailPage,
    meta: {
      eyebrow: 'Review Log',
      title: 'Попытка',
      subtitle: 'Подробный разбор вопроса, ответа и рекомендаций по прошлой сессии.',
      badge: 'Detail',
      navigationRoute: 'history',
    },
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: {
      name: 'home',
    },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return {
      top: 0,
    }
  },
})

export default router
