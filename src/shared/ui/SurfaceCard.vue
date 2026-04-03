<script setup lang="ts">
defineProps<{
  eyebrow?: string
  title?: string
}>()
</script>

<template>
  <section class="surface-card">
    <header v-if="eyebrow || title" class="surface-card__header">
      <p v-if="eyebrow" class="surface-card__eyebrow">{{ eyebrow }}</p>
      <h2 v-if="title" class="surface-card__title">{{ title }}</h2>
    </header>

    <div class="surface-card__body">
      <slot />
    </div>
  </section>
</template>
