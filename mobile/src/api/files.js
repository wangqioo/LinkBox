import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('linkbox_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

export async function login(username, password) {
  const { data } = await api.post('/auth/login', { username, password })
  if (data.token) localStorage.setItem('linkbox_token', data.token)
  return data
}

export async function register(username, password) {
  const { data } = await api.post('/auth/register', { username, password })
  if (data.token) localStorage.setItem('linkbox_token', data.token)
  return data
}

export function logout() {
  localStorage.removeItem('linkbox_token')
}

export function isLoggedIn() {
  return Boolean(localStorage.getItem('linkbox_token'))
}

export async function uploadFile(file, analyzeNow = false) {
  const form = new FormData()
  form.append('file', file)
  form.append('analyze_now', analyzeNow ? 'true' : 'false')
  const { data } = await api.post('/mobile/files/upload', form)
  return data
}

export async function uploadLink(url, analyzeNow = false) {
  const form = new FormData()
  form.append('url', url)
  form.append('analyze_now', analyzeNow ? 'true' : 'false')
  const { data } = await api.post('/mobile/files/upload', form)
  return data
}

export async function uploadText(text) {
  const form = new FormData()
  form.append('text', text)
  const { data } = await api.post('/mobile/files/upload', form)
  return data
}

export async function getFiles(params = {}) {
  const { data } = await api.get('/mobile/files', { params })
  return data
}

export async function getFile(id) {
  const { data } = await api.get(`/mobile/files/${id}`)
  return data
}

export async function deleteFile(id) {
  const { data } = await api.delete(`/mobile/files/${id}`)
  return data
}

export async function analyzeFile(id) {
  const { data } = await api.post(`/mobile/files/${id}/analyze`)
  return data
}

export async function updateComment(id, comment) {
  const { data } = await api.put(`/mobile/files/${id}/comment`, { comment })
  return data
}

export async function extractContent(id) {
  const { data } = await api.get(`/mobile/files/${id}/extract`)
  return data
}

export async function searchFiles(q, date = '', type = '') {
  const params = { q }
  if (date) params.date = date
  if (type) params.type = type
  const { data } = await api.get('/mobile/files/search', { params })
  return data
}

export async function getStats() {
  const { data } = await api.get('/mobile/files/stats')
  return data
}

export async function getFilesByDate(date) {
  const { data } = await api.get(`/mobile/files/by-date/${date}`)
  return data
}

export function downloadUrl(id) {
  const token = localStorage.getItem('linkbox_token')
  const suffix = token ? `?token=${encodeURIComponent(token)}` : ''
  return `/api/mobile/files/${id}/download${suffix}`
}

// Proxy WeChat CDN images through backend to bypass hotlink protection
export function imgUrl(url) {
  if (!url) return ''
  if (url.startsWith('/api/')) return url
  const needsProxy = ['qpic.cn', 'mmbiz', 'weixin'].some(k => url.includes(k))
  return needsProxy ? `/api/links/image-proxy?url=${encodeURIComponent(url)}` : url
}
