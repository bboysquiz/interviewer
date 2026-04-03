<script setup lang="ts">
import { useRoute } from 'vue-router'

import { navigationItems } from '@/features/navigation/navigation'
import type { AppRouteName } from '@/types'

const route = useRoute()

const resolveActiveRoute = (): AppRouteName | null => {
  const navigationRoute = route.meta.navigationRoute

  if (typeof navigationRoute === 'string') {
    return navigationRoute as AppRouteName
  }

  return typeof route.name === 'string' ? (route.name as AppRouteName) : null
}

const isActive = (routeName: AppRouteName) => resolveActiveRoute() === routeName
</script>

<template>
  <div class="bottom-nav-shell">
    <nav class="bottom-nav" aria-label="Основная навигация">
      <RouterLink
        v-for="item in navigationItems"
        :key="item.routeName"
        :to="{ name: item.routeName }"
        class="bottom-nav__item"
        :class="{ 'bottom-nav__item--active': isActive(item.routeName) }"
      >
        <span class="bottom-nav__icon" aria-hidden="true">{{ item.mark }}</span>
        <span class="bottom-nav__label">{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
