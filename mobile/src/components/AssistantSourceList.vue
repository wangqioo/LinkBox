<template>
  <div v-if="sources.length" class="sources">
    <details>
      <summary>引用资料 {{ sources.length }} 条</summary>
      <div
        v-for="(source, index) in sources"
        :key="source.id"
        class="source-card"
      >
        <button
          class="source-open"
          type="button"
          :disabled="!sourceOpenId(source)"
          @click="openSource(source)"
        >
          <span class="source-index">[{{ index + 1 }}]</span>
          <span class="source-main">
            <strong>{{ source.title }}</strong>
            <em v-if="source.summary">{{ source.summary }}</em>
            <small v-if="source.url">{{ source.url }}</small>
            <span v-if="inspectionRows(source.retrieval).length" class="source-inspection">
              <span
                v-for="row in inspectionRows(source.retrieval)"
                :key="`${row.label}:${row.value}`"
                class="inspection-chip"
              >
                <b>{{ row.label }}</b>
                <span>{{ row.value }}</span>
              </span>
            </span>
          </span>
        </button>
        <span class="source-main">
          <span v-if="source.chunks?.length" class="source-chunks">
            <span
              v-for="chunk in source.chunks"
              :key="chunk.id"
              class="source-chunk"
            >
              <b>片段 {{ chunk.index }}</b>
              <span v-if="inspectionRows(chunk.retrieval).length" class="source-inspection chunk">
                <span
                  v-for="row in inspectionRows(chunk.retrieval)"
                  :key="`${row.label}:${row.value}`"
                  class="inspection-chip"
                >
                  <b>{{ row.label }}</b>
                  <span>{{ row.value }}</span>
                </span>
              </span>
              <span>{{ chunk.text }}</span>
            </span>
          </span>
        </span>
      </div>
    </details>
  </div>
</template>

<script setup>
import { sourceOpenId } from '../utils/assistantConversations'
import { assistantSourceInspectionRows } from '../utils/assistantSourceInspection'

const props = defineProps({
  sources: { type: Array, default: () => [] },
})
const emit = defineEmits(['open-source'])

function inspectionRows(retrieval) {
  return assistantSourceInspectionRows(retrieval)
}

function openSource(source) {
  const id = sourceOpenId(source)
  if (id) emit('open-source', id)
}
</script>

<style scoped>
.sources {
  border: 1px solid var(--border);
  background: var(--s1);
  border-radius: 14px;
  overflow: hidden;
}
.sources summary {
  padding: 9px 11px;
  font-size: 12px;
  color: var(--text2);
  font-weight: 700;
}
.source-card {
  width: 100%;
  border: 0;
  border-top: 1px solid var(--border);
  background: transparent;
  color: var(--text);
  padding: 0;
}
.source-open {
  width: 100%;
  border: 0;
  background: transparent;
  color: var(--text);
  display: flex;
  gap: 8px;
  padding: 9px 11px;
  text-align: left;
}
.source-index {
  color: var(--accent);
  font-size: 12px;
  font-weight: 800;
  flex-shrink: 0;
}
.source-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.source-main strong {
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-main em {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
  font-style: normal;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.source-main small {
  color: var(--accent);
  font-size: 10px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.source-inspection {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 3px;
}
.source-inspection.chunk {
  margin: 0 0 4px;
}
.inspection-chip {
  min-width: 0;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--s2);
  color: var(--text2);
  padding: 1px 5px;
  font-size: 10px;
  line-height: 16px;
}
.inspection-chip b {
  color: var(--text3);
  font-size: 10px;
  margin: 0;
  flex-shrink: 0;
}
.inspection-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.source-chunks {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 0 11px 10px 31px;
}
.source-chunk {
  border: 1px solid var(--border);
  background: var(--s2);
  border-radius: 9px;
  padding: 7px 8px;
}
.source-chunk b {
  display: block;
  color: var(--accent);
  font-size: 11px;
  margin-bottom: 3px;
}
.source-chunk span {
  color: var(--text2);
  font-size: 11px;
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
