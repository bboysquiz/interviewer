import 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    eyebrow: string
    title: string
    subtitle: string
    badge: string
  }
}

export {}
