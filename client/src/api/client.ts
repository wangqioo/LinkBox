const BASE = '/api';

async function request(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('linkbox_token');
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percent: number;
  speed: number; // bytes per second
}

export interface AIProvider {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  visionModel: string;
  apiKeyEnv?: string;
  keyPlaceholder?: string;
  description?: string;
}

export interface AIConfig {
  provider: string;
  providerName?: string;
  providers?: AIProvider[];
  baseUrl: string;
  model: string;
  visionModel: string;
  temperature: number;
  enableThinking: boolean;
  apiKeyConfigured: boolean;
  apiKey?: string;
}

export interface AssistantSource {
  id: number;
  link_id?: number;
  type: string;
  title: string;
  url: string;
  summary: string;
  imported_at: string;
  chunks?: AssistantSourceChunk[];
}

export interface AssistantSourceChunk {
  id: number | string;
  index: number;
  chunk_index?: number;
  text: string;
}

export interface AssistantAnswer {
  answer: string;
  sources: AssistantSource[];
}

export interface AssistantStreamHandlers {
  onSources?: (sources: AssistantSource[]) => void;
  onDelta?: (text: string) => void;
  onDone?: () => void;
}

function uploadWithProgress(
  path: string,
  formData: FormData,
  onProgress?: (p: UploadProgress) => void,
): Promise<any> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const token = localStorage.getItem('linkbox_token');
    let startTime = Date.now();
    let lastLoaded = 0;
    let lastTime = startTime;
    let smoothSpeed = 0;

    xhr.upload.addEventListener('progress', (e) => {
      if (!e.lengthComputable || !onProgress) return;
      const now = Date.now();
      const dt = (now - lastTime) / 1000;
      if (dt > 0.2) {
        const instantSpeed = (e.loaded - lastLoaded) / dt;
        smoothSpeed = smoothSpeed ? smoothSpeed * 0.3 + instantSpeed * 0.7 : instantSpeed;
        lastLoaded = e.loaded;
        lastTime = now;
      }
      onProgress({
        loaded: e.loaded,
        total: e.total,
        percent: Math.round((e.loaded / e.total) * 100),
        speed: smoothSpeed,
      });
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) resolve(data);
        else reject(new Error(data.error || '上传失败'));
      } catch {
        reject(new Error('上传失败'));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('网络错误')));
    xhr.addEventListener('abort', () => reject(new Error('上传已取消')));

    xhr.open('POST', `${BASE}${path}`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.send(formData);
  });
}

export const api = {
  // Auth
  login: (username: string, password: string) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  register: (username: string, password: string) =>
    request('/auth/register', { method: 'POST', body: JSON.stringify({ username, password }) }),

  // Links
  getLinks: (params?: Record<string, string>) => {
    const qs = params ? '?' + new URLSearchParams(params).toString() : '';
    return request(`/links${qs}`);
  },
  getLink: (id: number) => request(`/links/${id}`),
  addLink: (data: { url: string; comment?: string; tag_ids?: number[]; imported_at?: string }) =>
    request('/links', { method: 'POST', body: JSON.stringify(data) }),
  addText: (data: { title: string; content: string; comment?: string; tag_ids?: number[]; imported_at?: string }) =>
    request('/links/text', { method: 'POST', body: JSON.stringify(data) }),
  addImage: (formData: FormData, onProgress?: (p: UploadProgress) => void) =>
    uploadWithProgress('/links/image', formData, onProgress),
  addAudio: (formData: FormData, onProgress?: (p: UploadProgress) => void) =>
    uploadWithProgress('/links/audio', formData, onProgress),
  addFile: (formData: FormData, onProgress?: (p: UploadProgress) => void) =>
    uploadWithProgress('/links/file', formData, onProgress),
  summarizeLink: (id: number) =>
    request(`/links/${id}/summarize`, { method: 'POST' }),
  extractContent: (id: number) =>
    request(`/links/${id}/extract`, { method: 'POST' }),
  getLearningNote: (id: number, refresh = false) =>
    request(`/links/${id}/learning-note${refresh ? '?refresh=1' : ''}`, { method: 'POST' }),
  updateLink: (id: number, data: Record<string, unknown>) =>
    request(`/links/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteLink: (id: number) =>
    request(`/links/${id}`, { method: 'DELETE' }),
  importLinks: (links: Array<{ url: string; comment?: string; imported_at?: string }>) =>
    request('/links/import', { method: 'POST', body: JSON.stringify({ links }) }),
  exportLinks: () => request('/links/export/all'),

  // Assistant
  askAssistant: (question: string, task = 'ask'): Promise<AssistantAnswer> =>
    request('/assistant/chat', { method: 'POST', body: JSON.stringify({ question, task }) }),
  streamAssistant: async (question: string, task = 'ask', handlers: AssistantStreamHandlers = {}) => {
    const token = localStorage.getItem('linkbox_token');
    const res = await fetch(`${BASE}/assistant/chat/stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ question, task }),
    });
    if (!res.ok || !res.body) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || '资料助理请求失败');
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const handleEvent = (raw: string) => {
      const lines = raw.split('\n');
      const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim() || 'message';
      const dataLine = lines.find(line => line.startsWith('data:'));
      if (!dataLine) return;
      const data = JSON.parse(dataLine.slice(5).trim());

      if (event === 'sources') handlers.onSources?.(data.sources || []);
      if (event === 'delta') handlers.onDelta?.(data.text || '');
      if (event === 'done') handlers.onDone?.();
      if (event === 'error') throw new Error(data.error || '资料助理生成失败');
    };

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split('\n\n');
      buffer = events.pop() || '';
      events.filter(Boolean).forEach(handleEvent);
    }

    if (buffer.trim()) handleEvent(buffer);
  },

  // Settings (admin only)
  getSettings: () => request('/settings'),
  updateSettings: (data: Record<string, string>) =>
    request('/settings', { method: 'PUT', body: JSON.stringify(data) }),
  getAIConfig: (): Promise<AIConfig> => request('/settings/ai'),
  updateAIConfig: (data: Partial<AIConfig>) =>
    request('/settings/ai', { method: 'PUT', body: JSON.stringify(data) }),
  testAIConfig: (data: Partial<AIConfig>) =>
    request('/settings/ai/test', { method: 'POST', body: JSON.stringify(data) }),

  // Tags
  getTags: () => request('/tags'),
  addTag: (name: string, color: string) =>
    request('/tags', { method: 'POST', body: JSON.stringify({ name, color }) }),
  updateTag: (id: number, data: { name?: string; color?: string }) =>
    request(`/tags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteTag: (id: number) =>
    request(`/tags/${id}`, { method: 'DELETE' }),
};
