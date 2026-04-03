import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from '@/app/App.vue'
import '@/app/styles.css'
import router from '@/router'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js')
  })
}
