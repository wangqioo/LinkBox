<template>
  <div class="login-page">
    <div class="login-bg"></div>
    <main class="login-card">
      <div class="login-mark">LB</div>
      <h1>LinkBox</h1>
      <p>{{ mode === 'login' ? '登录后使用手机文件传输助手' : '创建 LinkBox 账号并开始收集' }}</p>

      <div class="mode-tabs">
        <button type="button" :class="{ active: mode === 'login' }" @click="switchMode('login')">登录</button>
        <button type="button" :class="{ active: mode === 'register' }" @click="switchMode('register')">注册</button>
      </div>

      <form class="login-form" @submit.prevent="submit">
        <input v-model.trim="username" autocomplete="username" placeholder="用户名" />
        <input
          v-model="password"
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="密码"
          type="password"
        />
        <input
          v-if="mode === 'register'"
          v-model="confirmPassword"
          autocomplete="new-password"
          placeholder="确认密码"
          type="password"
        />
        <button :disabled="loading || !username || !password" type="submit">
          {{ loading ? '处理中...' : (mode === 'login' ? '登录' : '注册并登录') }}
        </button>
      </form>

      <div v-if="error" class="login-error">{{ error }}</div>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { login, register } from '../api/files'

const router = useRouter()
const route = useRoute()
const mode = ref('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const loading = ref(false)
const error = ref('')

function switchMode(nextMode) {
  mode.value = nextMode
  error.value = ''
  confirmPassword.value = ''
}

async function submit() {
  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致'
    return
  }

  loading.value = true
  error.value = ''
  try {
    if (mode.value === 'login') await login(username.value, password.value)
    else await register(username.value, password.value)
    router.replace(route.query.redirect || '/')
  } catch (e) {
    error.value = e.response?.data?.error || e.message || (mode.value === 'login' ? '登录失败' : '注册失败')
  } finally {
    loading.value = false
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  height: 100%;
  background: var(--bg);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: hidden;
}
.login-bg {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 260px 220px at 22% 8%, rgba(94,234,181,.12), transparent 68%),
    radial-gradient(ellipse 300px 260px at 88% 86%, rgba(255,170,92,.10), transparent 70%),
    var(--bg);
}
.login-card {
  position: relative;
  width: 100%;
  max-width: 310px;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.login-mark {
  width: 54px;
  height: 54px;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--teal), var(--accent));
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  font-weight: 800;
  margin-bottom: 18px;
}
h1 {
  font-size: 24px;
  line-height: 1.1;
  color: var(--text);
}
p {
  margin-top: 8px;
  color: var(--text3);
  font-size: 13px;
}
.mode-tabs {
  margin-top: 24px;
  height: 42px;
  padding: 4px;
  border-radius: 14px;
  background: var(--s2);
  border: 1px solid var(--border2);
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
}
.mode-tabs button {
  height: 32px;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: var(--text3);
  font: inherit;
  font-weight: 700;
}
.mode-tabs button.active {
  background: var(--accent);
  color: #fff;
}
.login-form {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
input {
  height: 46px;
  border-radius: 14px;
  border: 1px solid var(--border2);
  background: var(--s2);
  color: var(--text);
  outline: none;
  padding: 0 14px;
  font: inherit;
}
input::placeholder {
  color: var(--text3);
}
.login-form button {
  height: 46px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-weight: 700;
  font: inherit;
}
.login-form button:disabled {
  opacity: .45;
}
.login-error {
  margin-top: 14px;
  color: var(--red);
  font-size: 12px;
  line-height: 1.5;
}
</style>
