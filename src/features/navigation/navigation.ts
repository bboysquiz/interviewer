import type { NavigationItem } from '@/types'

export const navigationItems: NavigationItem[] = [
  {
    label: 'Главная',
    mark: 'HM',
    routeName: 'home',
  },
  {
    label: 'Темы',
    mark: 'CT',
    routeName: 'categories',
  },
  {
    label: 'Поиск',
    mark: 'SR',
    routeName: 'search',
  },
  {
    label: 'Собес',
    mark: 'QA',
    routeName: 'interview',
  },
  {
    label: 'Аналитика',
    mark: 'AN',
    routeName: 'analytics',
  },
  {
    label: 'История',
    mark: 'HS',
    routeName: 'history',
  },
]
