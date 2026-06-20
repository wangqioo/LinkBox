import { fileLabel } from './mobileItemDisplay.js'

export const CATEGORY_TYPES = ['image', 'video', 'article', 'document', 'audio', 'link', 'text', 'other']

export function categoryItems(stats = {}) {
  const byType = stats?.by_type || {}
  return CATEGORY_TYPES
    .map(type => ({
      type,
      label: fileLabel(type),
      count: byType[type] || 0,
    }))
    .filter(category => category.count > 0)
    .sort((a, b) => b.count - a.count)
}

export function filesForCategory(files = [], type) {
  return files.filter(file => file.type === type)
}
