<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { regionalBrief, weatherLook } from '../../spotConditions.js';
import { clockLine } from '../../contextTime.js';
import { useEntityCardStore } from '../../stores/entityCard.js';

// Two rows of More details for something that stays put (a fire, a camera,
// a site): the weather there and its local time, "10:14 local, 16:14 UTC".
// Read once per spot; the brief behind it is cached.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
});

const store = useEntityCardStore();
const weather = ref(null);
let reading = 0;
watch(
  () => `${props.lat.toFixed(2)},${props.lon.toFixed(2)}`,
  async () => {
    const mine = ++reading;
    weather.value = null;
    const brief = await regionalBrief(props.lat, props.lon, store.readWeather, { kind: 'weather' }).catch(() => null);
    if (mine === reading) weather.value = brief?.weather || null;
  },
  { immediate: true },
);

// The clock moves once a minute.
const now = ref(Date.now());
let timer = 0;
onMounted(() => {
  timer = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => clearInterval(timer));

const time = computed(() => clockLine(weather.value, now.value));
const weatherText = computed(() => {
  const here = weather.value;
  if (!Number.isFinite(here?.temperatureC)) return '';
  const words = [t('{n} °C', { n: formatNumber(Math.round(here.temperatureC)) }), t(weatherLook(here.weatherCode).label)];
  if (Number.isFinite(here.windKph)) words.push(t('wind {n} km/h', { n: formatNumber(Math.round(here.windKph)) }));
  return words.join(' · ');
});
</script>

<template>
  <div class="entity-card__fact">
    <dt>{{ t('Local time') }}</dt>
    <dd>{{ time }}</dd>
  </div>
  <div v-if="weatherText" class="entity-card__fact">
    <dt>{{ t('Weather here') }}</dt>
    <dd>
      {{ weatherText }}
      <a v-if="weather?.source === 'open-meteo'" class="entity-card__weather-credit" href="https://open-meteo.com/" target="_blank" rel="noopener">{{ t('Weather data by Open-Meteo.com') }}</a>
    </dd>
  </div>
</template>
