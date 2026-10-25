<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  store: { type: Object, required: true },
  version: { type: Number, default: 0 },
  lang: { type: String, default: 'pt' }
})
const emit = defineEmits(['clear'])

const COLORS = ['#34d399', '#38bdf8', '#fbbf24', '#f472b6', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171']

const canvasRef = ref(null)
const wrapRef = ref(null)
const windowSize = ref(300)
const paused = ref(false)
const hidden = ref(new Set())
// Frozen copy used while paused, so the chart stops but data keeps arriving
let frozen = null
let resizeObserver = null

const names = computed(() => {
  props.version // re-evaluate when new samples arrive
  return Array.from(props.store.series.keys())
})

const legend = computed(() => {
  props.version
  return names.value.map((name, i) => {
    const values = props.store.series.get(name)
    return { name, color: COLORS[i % COLORS.length], last: values.length ? values[values.length - 1] : null }
  })
})

function toggleSeries(name) {
  const next = new Set(hidden.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  hidden.value = next
  draw()
}

function togglePause() {
  paused.value = !paused.value
  frozen = paused.value ? new Map(Array.from(props.store.series, ([k, v]) => [k, v.slice()])) : null
  draw()
}

function formatTick(v) {
  const abs = Math.abs(v)
  if (abs >= 1000 || (abs > 0 && abs < 0.01)) return v.toExponential(1)
  return Number(v.toFixed(2)).toString()
}

function cssVar(name, fallback) {
  const value = getComputedStyle(wrapRef.value).getPropertyValue(name).trim()
  return value || fallback
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas || !wrapRef.value) return
  const dpr = window.devicePixelRatio || 1
  const width = wrapRef.value.clientWidth
  const height = wrapRef.value.clientHeight
  if (!width || !height) return
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
  }
  const ctx = canvas.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, width, height)

  const source = frozen || props.store.series
  const visible = []
  names.value.forEach((name, i) => {
    if (hidden.value.has(name) || !source.has(name)) return
    visible.push({ name, color: COLORS[i % COLORS.length], values: source.get(name).slice(-windowSize.value) })
  })

  const left = 52
  const right = 10
  const top = 10
  const bottom = 18
  const plotW = width - left - right
  const plotH = height - top - bottom
  const gridColor = cssVar('--border-subtle', 'rgba(255,255,255,0.08)')
  const textColor = cssVar('--text-muted', '#64748b')

  let min = Infinity
  let max = -Infinity
  let longest = 0
  for (const s of visible) {
    longest = Math.max(longest, s.values.length)
    for (const v of s.values) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!visible.length || !Number.isFinite(min)) {
    ctx.fillStyle = textColor
    ctx.font = '12px system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText(props.lang === 'pt'
      ? 'Sem dados numéricos. Envie linhas como "25.4" ou "temp:25.4,hum:40".'
      : 'No numeric data yet. Send lines like "25.4" or "temp:25.4,hum:40".', width / 2, height / 2)
    return
  }
  if (min === max) {
    min -= 1
    max += 1
  }
  const pad = (max - min) * 0.08
  min -= pad
  max += pad

  ctx.font = '10px ui-monospace, monospace'
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.lineWidth = 1
  for (let i = 0; i <= 4; i++) {
    const y = top + (plotH * i) / 4
    ctx.strokeStyle = gridColor
    ctx.beginPath()
    ctx.moveTo(left, y + 0.5)
    ctx.lineTo(left + plotW, y + 0.5)
    ctx.stroke()
    ctx.fillStyle = textColor
    ctx.fillText(formatTick(max - ((max - min) * i) / 4), left - 6, y)
  }

  const step = plotW / Math.max(windowSize.value - 1, 1)
  ctx.lineWidth = 1.6
  ctx.lineJoin = 'round'
  for (const s of visible) {
    ctx.strokeStyle = s.color
    ctx.beginPath()
    // Newest sample is always at the right edge
    const offset = left + plotW - (s.values.length - 1) * step
    s.values.forEach((v, i) => {
      const x = offset + i * step
      const y = top + plotH - ((v - min) / (max - min)) * plotH
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  }

  ctx.fillStyle = textColor
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(`${longest} ${props.lang === 'pt' ? 'amostras' : 'samples'}`, left, height - 4)
}

function exportCsv() {
  const cols = names.value
  const rows = Math.max(0, ...cols.map(n => props.store.series.get(n).length))
  const lines = [cols.join(',')]
  for (let r = 0; r < rows; r++) {
    lines.push(cols.map(n => {
      const values = props.store.series.get(n)
      const offset = rows - values.length
      return r >= offset ? values[r - offset] : ''
    }).join(','))
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `esp-studio-plot-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

watch(() => props.version, () => {
  if (!paused.value) draw()
})
watch([windowSize, () => props.lang], draw)

onMounted(() => {
  resizeObserver = new ResizeObserver(draw)
  resizeObserver.observe(wrapRef.value)
  draw()
})

onBeforeUnmount(() => resizeObserver?.disconnect())
</script>

<template>
  <div class="plotter">
    <div class="plotter-bar">
      <div class="plotter-legend">
        <button
          v-for="item in legend"
          :key="item.name"
          type="button"
          class="legend-item"
          :class="{ off: hidden.has(item.name) }"
          @click="toggleSeries(item.name)"
        >
          <span class="legend-swatch" :style="{ background: item.color }"></span>
          <span>{{ item.name }}</span>
          <span v-if="item.last !== null" class="legend-value">{{ item.last }}</span>
        </button>
      </div>
      <div class="plotter-actions">
        <select v-model.number="windowSize" class="plotter-select" :aria-label="lang === 'pt' ? 'Janela' : 'Window'">
          <option :value="100">100</option>
          <option :value="300">300</option>
          <option :value="1000">1000</option>
        </select>
        <button type="button" class="tool-btn" :class="{ active: paused }" @click="togglePause">{{ paused ? (lang === 'pt' ? 'Retomar' : 'Resume') : (lang === 'pt' ? 'Pausar' : 'Pause') }}</button>
        <button type="button" class="tool-btn" :disabled="!names.length" @click="exportCsv">CSV</button>
        <button type="button" class="tool-btn danger" @click="emit('clear')">{{ lang === 'pt' ? 'Limpar' : 'Clear' }}</button>
      </div>
    </div>
    <div ref="wrapRef" class="plotter-canvas-wrap">
      <canvas ref="canvasRef"></canvas>
    </div>
  </div>
</template>
