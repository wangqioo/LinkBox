import { createApp } from 'vue'
import App from './App.vue'
import router from './router'

document.documentElement.dataset.linkboxBuild = __LINKBOX_BUILD_REV__

const app = createApp(App)
app.use(router)
app.mount('#app')
