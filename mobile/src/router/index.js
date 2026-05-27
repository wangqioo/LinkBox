import { createRouter, createWebHistory } from 'vue-router'
import Home from '../views/Home.vue'
import Category from '../views/Category.vue'
import Search from '../views/Search.vue'
import FileDetail from '../views/FileDetail.vue'
import DayFiles from '../views/DayFiles.vue'
import Login from '../views/Login.vue'
import Friends from '../views/Friends.vue'
import { isLoggedIn } from '../api/files'

const routes = [
  { path: '/', name: 'home', component: Home },
  { path: '/login', name: 'login', component: Login },
  { path: '/category', name: 'category', component: Category },
  { path: '/friends', name: 'friends', component: Friends },
  { path: '/search', name: 'search', component: Search },
  { path: '/file/:id', name: 'file-detail', component: FileDetail },
  { path: '/day', name: 'day-files', component: DayFiles },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  if (to.name !== 'login' && !isLoggedIn()) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && isLoggedIn()) {
    return { name: 'home' }
  }
})

export default router
