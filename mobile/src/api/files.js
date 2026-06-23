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

export async function uploadFile(file, analyzeNow = false, metadata = {}) {
  const form = new FormData()
  form.append('file', file)
  form.append('analyze_now', analyzeNow ? 'true' : 'false')
  if (metadata.batchId) form.append('batch_id', metadata.batchId)
  if (metadata.batchIndex !== undefined) form.append('batch_index', String(metadata.batchIndex))
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

export async function getImageBatch(batchId) {
  const { data } = await api.get(`/mobile/files/batch/${encodeURIComponent(batchId)}`)
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

export async function updateBatchComment(batchId, comment) {
  const { data } = await api.put(`/mobile/files/batch/${encodeURIComponent(batchId)}/comment`, { comment })
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

export async function streamAssistant(question, task = 'ask', handlers = {}, scope = {}, options = {}) {
  const token = localStorage.getItem('linkbox_token')
  const response = await fetch('/api/assistant/chat/stream', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ question, task, scope, groupId: options.groupId }),
  })

  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || '资料助理请求失败')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  function handleEvent(raw) {
    const lines = raw.split('\n')
    const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message'
    const dataLine = lines.find(line => line.startsWith('data:'))
    if (!dataLine) return
    const data = JSON.parse(dataLine.slice(5).trim())

    if (event === 'sources') handlers.onSources?.(data.sources || [])
    if (event === 'delta') handlers.onDelta?.(data.text || '')
    if (event === 'done') handlers.onDone?.()
    if (event === 'error') throw new Error(data.error || '资料助理生成失败')
  }

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const events = buffer.split('\n\n')
    buffer = events.pop() || ''
    events.filter(Boolean).forEach(handleEvent)
  }

  if (buffer.trim()) handleEvent(buffer)
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
  const needsProxy = ['qpic.cn', 'mmbiz', 'weixin', 'hdslb.com', 'biliimg.com'].some(k => url.includes(k))
  return needsProxy ? `/api/links/image-proxy?url=${encodeURIComponent(url)}` : url
}


export async function searchUsers(q) {
  const { data } = await api.get('/social/users/search', { params: { q } })
  return data
}

export async function getFriends() {
  const { data } = await api.get('/social/friends')
  return data
}

export async function addFriend(username) {
  const { data } = await api.post('/social/friends', { username })
  return data
}

export async function acceptFriend(id) {
  const { data } = await api.post(`/social/friends/${id}/accept`)
  return data
}

export async function deleteFriend(id) {
  const { data } = await api.delete(`/social/friends/${id}`)
  return data
}

export async function getGroups() {
  const { data } = await api.get('/social/groups')
  return data
}

export async function createGroup(payload) {
  const { data } = await api.post('/social/groups', payload)
  return data
}

export async function getGroupMessages(groupId) {
  const { data } = await api.get(`/social/groups/${groupId}/messages`)
  return data
}

export async function sendGroupMessage(groupId, body) {
  const { data } = await api.post(`/social/groups/${groupId}/messages`, { body })
  return data
}

export async function getDirectMessages(userId) {
  const { data } = await api.get(`/social/friends/${userId}/messages`)
  return data
}

export async function sendDirectMessage(userId, body) {
  const { data } = await api.post(`/social/friends/${userId}/messages`, { body })
  return data
}

export async function shareLinkToFriend(userId, linkId) {
  const { data } = await api.post(`/social/friends/${userId}/materials`, { link_id: linkId })
  return data
}

export async function uploadDirectChatItem(userId, payload = {}) {
  const form = new FormData()
  if (payload.file) form.append('file', payload.file)
  if (payload.text) form.append('text', payload.text)
  if (payload.url) form.append('url', payload.url)
  if (payload.batchId) form.append('batch_id', payload.batchId)
  if (payload.batchIndex !== undefined) form.append('batch_index', String(payload.batchIndex))
  const { data } = await api.post(`/social/friends/${userId}/uploads`, form)
  return data
}

export async function updateDirectMaterialComment(userId, linkId, comment) {
  const { data } = await api.put(`/social/friends/${userId}/materials/${linkId}/comment`, { comment })
  return data
}

export async function deleteDirectMessage(userId, messageId) {
  const { data } = await api.delete(`/social/friends/${userId}/messages/${messageId}`)
  return data
}

export async function getGroupMaterials(groupId) {
  const { data } = await api.get(`/social/groups/${groupId}/materials`)
  return data
}

export async function shareLinkToGroup(groupId, linkId, note = '') {
  const { data } = await api.post(`/social/groups/${groupId}/materials`, { link_id: linkId, note })
  return data
}

export async function uploadGroupChatItem(groupId, payload = {}) {
  const form = new FormData()
  if (payload.file) form.append('file', payload.file)
  if (payload.text) form.append('text', payload.text)
  if (payload.url) form.append('url', payload.url)
  if (payload.note) form.append('note', payload.note)
  if (payload.batchId) form.append('batch_id', payload.batchId)
  if (payload.batchIndex !== undefined) form.append('batch_index', String(payload.batchIndex))
  const { data } = await api.post(`/social/groups/${groupId}/uploads`, form)
  return data
}

export async function updateGroupMaterialComment(groupId, linkId, comment) {
  const { data } = await api.put(`/social/groups/${groupId}/materials/${linkId}/comment`, { comment })
  return data
}

export async function deleteGroupMessage(groupId, messageId) {
  const { data } = await api.delete(`/social/groups/${groupId}/messages/${messageId}`)
  return data
}

export async function deleteGroupMaterial(groupId, linkId) {
  const { data } = await api.delete(`/social/groups/${groupId}/materials/${linkId}`)
  return data
}
