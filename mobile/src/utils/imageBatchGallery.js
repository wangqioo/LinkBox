export function groupImageBatches(files = []) {
  const batchCounts = new Map()
  const batchSeen = new Map()
  for (const file of files) {
    if (file?.type !== 'image' || !file.batch_id) continue
    batchCounts.set(file.batch_id, (batchCounts.get(file.batch_id) || 0) + 1)
  }

  const emitted = new Set()
  return files.flatMap(file => {
    if (file?.type !== 'image' || !file.batch_id || batchCounts.get(file.batch_id) < 2) {
      return [{ kind: 'item', id: `item:${file.id}`, file }]
    }
    const seen = (batchSeen.get(file.batch_id) || 0) + 1
    batchSeen.set(file.batch_id, seen)
    if (seen < batchCounts.get(file.batch_id)) return []
    if (emitted.has(file.batch_id)) return []
    emitted.add(file.batch_id)
    const images = files
      .filter(candidate => candidate?.type === 'image' && candidate.batch_id === file.batch_id)
      .sort((a, b) => Number(a.batch_index || 0) - Number(b.batch_index || 0) || Number(a.id) - Number(b.id))

    return [{
      kind: 'image-batch',
      id: `batch:${file.batch_id}`,
      batchId: file.batch_id,
      activeIndex: 0,
      images,
      created_at: images[0]?.created_at || file.created_at,
    }]
  })
}
