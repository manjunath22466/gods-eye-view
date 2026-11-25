<script setup>
import { computed, ref, watch } from 'vue';
import { formatNumber, t, tn } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { contextRadiusKm } from '../../contextRadius.js';

// Small charts of how a picked item is changing, from what the layers have
// loaded: for a fire, the satellite hits around it by the hour over the last
// day and their fire power; for a quake, the quakes around it over the feed's
// window by magnitude; for anything that moves and reports its speed (a
// vessel), its speed while the card is open. Nothing is fetched for them.
const props = defineProps({
  card: { type: Object, required: true },
  /** Bumped by the card on every refresh. */
  tick: { type: Number, default: 0 },
});

const store = useEntityCardStore();
const HOUR = 3_600_000;
const FIRE_LAYERS = new Set(['local-firms', 'fire-perimeters']);
// The hits that count as this fire's: within this distance of it.
const FIRE_KM = 25;

const fire = computed(() => {
  void props.tick;
  const card = props.card;
  if (!FIRE_LAYERS.has(card.layerId) || !Number.isFinite(card.lat)) return null;
  const now = Date.now();
  const counts = Array(24).fill(0);
  const power = Array(24).fill(0);
  for (const { record } of store.recordsNear('local-firms', card.lat, card.lon, FIRE_KM)) {
    const age = now - record.acqTime;
    if (!Number.isFinite(age) || age < 0 || age >= 24 * HOUR) continue;
    const slot = 23 - Math.floor(age / HOUR);
    counts[slot]++;
    if (Number.isFinite(record.frp)) power[slot] += record.frp;
  }
  const total = counts.reduce((sum, n) => sum + n, 0);
  return total ? { counts, power, total } : null;
});

const quakes = computed(() => {
  void props.tick;
  const card = props.card;
  if (card.layerId !== 'earthquakes' || !Number.isFinite(card.lat)) return null;
  const found = store
    .recordsNear('earthquakes', card.lat, card.lon, contextRadiusKm.value)
    .map(({ record }) => record)
    .filter((record) => Number.isFinite(record.magnitude) && Number.isFinite(record.timeMs))
    .sort((a, b) => a.timeMs - b.timeMs)
    .slice(-24);
  return found.length > 1 ? found : null;
});

// Speed, sampled while the card is open: one reading per refresh.
const speeds = ref([]);
watch(
  () => props.card.key,
  () => (speeds.value = []),
);
watch(
  () => [props.tick, props.card.speedMps],
  () => {
    const card = props.card;
    if (!card.moving || card.kind === 'aircraft' || card.kind === 'satellite') return;
    if (!Number.isFinite(card.speedMps)) return;
    speeds.value = [...speeds.value, card.speedMps * 1.943844].slice(-40);
  },
  { immediate: true },
);

const W = 160;
const H = 28;
const bars = (values) => {
  const top = Math.max(...values, 1);
  const width = W / values.length;
  return values.map((value, index) => ({
    x: index * width + 0.5,
    width: Math.max(1, width - 1.5),
    height: Math.max(value ? 2 : 0.5, (value / top) * H),
  }));
};
const line = (values) => {
  if (values.length < 2) return '';
  const top = Math.max(...values);
  const low = Math.min(...values);
  const span = top - low || 1;
  return values
    .map((value, index) => `${((index / (values.length - 1)) * W).toFixed(1)},${(H - ((value - low) / span) * (H - 2) - 1).toFixed(1)}`)
    .join(' ');
};
const fireBars = computed(() => (fire.value ? bars(fire.value.counts) : []));
const powerLine = computed(() => (fire.value ? line(fire.value.power) : ''));
const quakeBars = computed(() => (quakes.value ? bars(quakes.value.map((quake) => quake.magnitude)) : []));
const speedLine = computed(() => line(speeds.value));
const shown = computed(() => Boolean(fire.value || quakes.value || speeds.value.length > 1));
</script>

<template>
  <section v-if="shown" class="item-charts" :aria-label="t('How it is changing')">
    <h4>{{ fire ? t('Last 24 hours') : t('How it is changing') }}</h4>
    <template v-if="fire">
      <div class="item-charts__row">
        <span class="item-charts__label">{{ t('Hotspots') }}</span>
        <svg class="item-charts__chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="tn(fire.total, '{count} satellite fire hit within {km} km in the last 24 hours', '{count} satellite fire hits within {km} km in the last 24 hours', { km: FIRE_KM })">
          <rect v-for="(bar, index) in fireBars" :key="index" :x="bar.x" :y="H - bar.height" :width="bar.width" :height="bar.height" :class="{ 'is-last': index === fireBars.length - 1 }" />
        </svg>
        <strong>{{ formatNumber(fire.total) }}</strong>
      </div>
      <div v-if="powerLine" class="item-charts__row">
        <span class="item-charts__label">{{ t('Fire power') }}</span>
        <svg class="item-charts__chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
          <polyline :points="powerLine" />
        </svg>
        <strong>{{ t('{n} MW', { n: formatNumber(Math.round(fire.power.reduce((sum, n) => sum + n, 0))) }) }}</strong>
      </div>
    </template>
    <div v-if="quakes" class="item-charts__row">
      <span class="item-charts__label">{{ t('Magnitudes nearby') }}</span>
      <svg class="item-charts__chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" role="img" :aria-label="tn(quakes.length, '{count} quake nearby, oldest first', '{count} quakes nearby, oldest first', { count: formatNumber(quakes.length) })">
        <rect v-for="(bar, index) in quakeBars" :key="index" :x="bar.x" :y="H - bar.height" :width="bar.width" :height="bar.height" :class="{ 'is-last': quakes[index].timeMs === card.identity?.record?.timeMs }" />
      </svg>
      <strong>{{ formatNumber(quakes.length) }}</strong>
    </div>
    <div v-if="speeds.length > 1" class="item-charts__row">
      <span class="item-charts__label">{{ t('Speed') }}</span>
      <svg class="item-charts__chart" :viewBox="`0 0 ${W} ${H}`" preserveAspectRatio="none" aria-hidden="true">
        <polyline :points="speedLine" />
      </svg>
      <strong>{{ t('{n} kn', { n: formatNumber(Math.round(speeds[speeds.length - 1])) }) }}</strong>
    </div>
  </section>
</template>
