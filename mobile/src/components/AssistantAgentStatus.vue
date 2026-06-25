<template>
  <div v-if="rows.length" class="agent-status">
    <span
      v-for="row in rows"
      :key="row.label"
      class="agent-chip"
    >
      <b>{{ row.label }}</b>
      <span>{{ row.value }}</span>
    </span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { assistantAgentStatusRows } from '../utils/assistantDiagnostics'

const props = defineProps({
  agent: { type: Object, default: null },
})

const rows = computed(() => assistantAgentStatusRows(props.agent))
</script>

<style scoped>
.agent-status {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}
.agent-chip {
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
.agent-chip b {
  color: var(--text3);
  font-size: 10px;
  flex-shrink: 0;
}
.agent-chip span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
