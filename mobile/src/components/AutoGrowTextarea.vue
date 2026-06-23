<template>
  <textarea
    ref="textareaEl"
    :value="modelValue"
    :rows="minRows"
    :style="{ maxHeight: `${maxHeight}px` }"
    @input="handleInput"
  ></textarea>
</template>

<script setup>
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps({
  modelValue: { type: String, default: '' },
  modelModifiers: { type: Object, default: () => ({}) },
  minRows: { type: Number, default: 1 },
  maxHeight: { type: Number, default: 150 },
})

const emit = defineEmits(['update:modelValue'])
const textareaEl = ref(null)

function resize() {
  const el = textareaEl.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, props.maxHeight)}px`
  el.style.overflowY = el.scrollHeight > props.maxHeight ? 'auto' : 'hidden'
}

function handleInput(event) {
  const nextValue = props.modelModifiers.trim ? event.target.value.trim() : event.target.value
  emit('update:modelValue', nextValue)
  nextTick(resize)
}

onMounted(resize)
watch(() => props.modelValue, () => nextTick(resize))
</script>
