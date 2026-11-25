<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatNumber, t } from '../../../i18n/index.js';
import { sayWords, useEntityCardStore } from '../../stores/entityCard.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import { regionalBrief, weatherLook } from '../../spotConditions.js';
import { dayLengthMinutes, durationText } from '../../contextTime.js';
import { AIRPORT_TRAFFIC_KM, airportTraffic, groundSpeedTrend, nearbyRow } from '../../placeCard.js';
import { suggestLayers } from '../../layerSuggestions.js';
import { useLayerFinderStore } from '../../stores/layerFinder.js';
import { shownLayerName } from '../../layerNames.js';
import PlaceLine from './PlaceLine.vue';
import UiButton from '../../kit/UiButton.vue';
import UiChip from '../../kit/UiChip.vue';
import UiIcon from '../../kit/UiIcon.vue';
import NearbyLists from './NearbyLists.vue';
import { focusCardTitle, focusInCard } from '../../cardFocus.js';

// What a place's card shows under its buttons: its place
// line (coordinates, local time, a near link), its figures (weather and
// daylight; for an airport, the flights arriving and departing within about
// 50 km, its runways and the weather), an airport's arrivals and departures
// first in Nearby, and the layers suggested here. Flights are read from what
// the flights layer has already loaded: nothing new is asked for, and with
// that layer off the airport's figures say it is off and offer to open it.
const props = defineProps({
  card: { type: Object, required: true },
});

const store = useEntityCardStore();
const { tick, managerVersion, layerRevision, backTo } = storeToRefs(store);

// An airport opened from another card (an aircraft's route, an arrival)
// offers the way back to that card.
// Back reopens the card the airport was opened from; focus returns to the
// link to this airport there, else that card's title.
function goBack() {
  const ident = props.card.place?.airport?.ident || '';
  if (store.back()) void focusInCard(ident ? [`.airport-link[data-airport="${CSS.escape(ident)}"]`] : []);
}
const backName = computed(() => {
  const to = backTo.value;
  if (!to || to.key !== props.card.key) return '';
  return sayWords(to.titleWords, to.title) || t('Picked spot');
});
const chrome = usePanelChromeStore();
const finder = useLayerFinderStore();

const airport = computed(() => props.card.place?.airport || null);

// The weather there, once per spot (the brief behind it is kept a while).
const weather = ref(null);
watch(
  () => `${props.card.lat.toFixed(2)},${props.card.lon.toFixed(2)}`,
  async (key) => {
    weather.value = null;
    const brief = await regionalBrief(props.card.lat, props.card.lon, store.readWeather, { kind: 'weather' }).catch(() => null);
    if (key === `${props.card.lat.toFixed(2)},${props.card.lon.toFixed(2)}`) weather.value = brief?.weather || null;
  },
  { immediate: true },
);
const weatherFigure = computed(() => {
  const here = weather.value;
  return Number.isFinite(here?.temperatureC) ? t('{n} °C', { n: formatNumber(Math.round(here.temperatureC)) }) : '—';
});
const weatherWords = computed(() => (Number.isFinite(weather.value?.temperatureC) ? t(weatherLook(weather.value.weatherCode).label) : ''));

// The flights the flights layer has loaded around an airport, read on the
// card's own refresh. Their ground speeds are kept from read to read, so a
// flight that has just landed (on the ground, slowing) counts as arriving.
const traffic = ref({ arriving: [], departing: [], other: [], guessed: 0, unknown: 0 });
const speeds = groundSpeedTrend();
let speedsFor = '';
function readTraffic() {
  if (!airport.value) return;
  if (speedsFor !== props.card.key) speeds.clear();
  speedsFor = props.card.key;
  const near = store.recordsNear('flights', props.card.lat, props.card.lon, AIRPORT_TRAFFIC_KM);
  speeds.note(near);
  traffic.value = airportTraffic(near, airport.value, { slowing: speeds.slowing });
}
watch([tick, managerVersion, layerRevision, () => props.card.key], readTraffic, { immediate: true });
// With Live Flights off nothing is loaded to count, so the arrival and
// departure figures say so rather than show 0.
const flightsRow = computed(() => {
  void managerVersion.value;
  void layerRevision.value;
  return store.allLayers().find((layer) => layer.id === 'flights') || null;
});
const flightsOff = computed(() => Boolean(airport.value) && !flightsRow.value?.enabled);
const flightsOffHint = computed(() =>
  t('{layer} off · turn it on in Data Layers to count arrivals and departures', { layer: shownLayerName(flightsRow.value?.name || 'Live Flights', 'flights') }),
);
function openLayers(ids) {
  chrome.act('reveal', 'data-panel');
  if (chrome.panels['data-panel']?.collapsed !== false) chrome.act('toggle', 'data-panel');
  if (finder.controlsMounted) finder.pick(ids);
}

// An arrival or departure figure is exact while every flight near the
// airport goes by its known route. Once any is judged by how it moves, the
// figure is marked as an estimate ("~12"); and when nothing was found but
// some flights there report no climb or descent, it is "—", never 0.
const airportCode = computed(() => airport.value?.iata || airport.value?.ident || '');
function trafficFigure(field) {
  const { guessed, unknown } = traffic.value;
  const count = traffic.value[field].length;
  if (!guessed) return { number: formatNumber(count) };
  if (!count && unknown)
    return { number: '—', title: t('Not known · no climb or descent data for the flights near {code}', { code: airportCode.value }), marked: true };
  return { number: t('~{n}', { n: formatNumber(count) }), title: t('Estimated from altitude, climb or descent, and ground speed'), marked: true };
}

const now = ref(Date.now());
let clock = 0;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 60_000);
});
onBeforeUnmount(() => clearInterval(clock));
const daylight = computed(() => durationText(dayLengthMinutes(props.card.lat, now.value)));

const tiles = computed(() =>
  airport.value
    ? [
        flightsOff.value
          ? { field: 'arriving', label: t('Arriving'), number: '—', title: flightsOffHint.value }
          : { field: 'arriving', label: t('Arriving'), ...trafficFigure('arriving') },
        flightsOff.value
          ? { field: 'departing', label: t('Departing'), number: '—', title: flightsOffHint.value }
          : { field: 'departing', label: t('Departing'), ...trafficFigure('departing') },
        { field: 'runways', label: t('Runways'), number: airport.value.runways ? formatNumber(airport.value.runways) : '—' },
        { field: 'weather', label: t('Weather'), number: weatherFigure.value, title: weatherWords.value },
      ]
    : [
        { field: 'weather', label: t('Weather'), number: weatherFigure.value, title: weatherWords.value },
        { field: 'daylight', label: t('Daylight'), number: daylight.value },
      ],
);

// Nearby, arrivals first: flights heading to the airport (by their route,
// or descending near it), then those leaving it, then any other flight
// within 50 km. The card's own Nearby
// (every layer that is on) follows.
const km = (n) => t('{n} km', { n: formatNumber(n) });
const trafficLists = computed(() => {
  if (!airport.value) return [];
  // An arrival names the airport it comes from, a departure the one it is
  // bound for; either opens that airport's card.
  const list = (layerId, icon, label, entries, via = null) => ({
    layerId,
    icon,
    layerName: label,
    count: entries.length,
    items: entries.slice(0, 3).map((entry) => {
      const row = nearbyRow('flights', entry);
      const code = via ? String(entry.record?.[via.field] || '').trim() : '';
      return code ? { ...row, via: { code, words: via.words } } : row;
    }),
  });
  const { arriving, departing, other } = traffic.value;
  return [
    list('arriving', 'arrow_downward', t('Arriving · within {radius}', { radius: km(AIRPORT_TRAFFIC_KM) }), arriving, { field: 'routeOrigin', words: 'from' }),
    list('departing', 'arrow_upward', t('Departing · within {radius}', { radius: km(AIRPORT_TRAFFIC_KM) }), departing, { field: 'routeDestination', words: 'to' }),
    list('around', 'flight', t('Other flights · within {radius}', { radius: km(AIRPORT_TRAFFIC_KM) }), other),
  ];
});

// Suggested here: layers that would show something at this place. Open
// shows them picked out in Data Layers; nothing switches on.
const suggestions = computed(() => {
  if (!finder.controlsMounted) return [];
  void managerVersion.value;
  void layerRevision.value;
  const rows = store.allLayers();
  return suggestLayers(rows, { place: true }).map((id) => {
    const row = rows.find((layer) => layer.id === id);
    return { id, name: String(row?.name || id), icon: String(row?.icon || '') };
  });
});
function openSuggestions() {
  const ids = suggestions.value.map((layer) => layer.id);
  if (!ids.length) return;
  openLayers(ids);
}
</script>

<template>
  <div class="place-details">
    <UiButton v-if="backName" class="place-details__back" :title="t('Back to {name}', { name: backName })" @click="goBack">
      <UiIcon name="chevron_left" :size="null" /><span class="place-details__back-name">{{ t('Back to {name}', { name: backName }) }}</span>
    </UiButton>
    <PlaceLine :lat="card.lat" :lon="card.lon" :name="card.title" :from="card.place?.from || 'search'" :airport="airport" :headed="false" />
    <div class="entity-card__tiles place-details__tiles" :style="{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }">
      <div v-for="tile in tiles" :key="tile.field" class="entity-card__tile" :data-field="tile.field" :title="tile.title || undefined">
        <span>{{ tile.label }}</span>
        <strong><abbr v-if="tile.marked" class="place-details__estimate" :title="tile.title">{{ tile.number }}</abbr><template v-else>{{ tile.number }}</template></strong>
      </div>
    </div>
    <a v-if="weather?.source === 'open-meteo' && Number.isFinite(weather.temperatureC)" class="entity-card__weather-credit" href="https://open-meteo.com/" target="_blank" rel="noopener">{{ t('Weather data by Open-Meteo.com') }}</a>
    <UiButton v-if="flightsOff" class="place-details__flights-off" @click="openLayers(['flights'])">{{ flightsOffHint }}</UiButton>
    <NearbyLists v-if="airport" :lists="flightsOff ? [] : trafficLists" :title="t('Flights at {code}', { code: airportCode })" @focus-lost="focusCardTitle()" />
    <section v-if="suggestions.length" class="place-details__suggested" :aria-label="t('Suggested here')">
      <h4 class="place-details__head">{{ t('Suggested here') }}</h4>
      <ul class="place-details__chips">
        <li v-for="layer in suggestions" :key="layer.id">
          <UiChip class="place-details__chip"><UiIcon v-if="layer.icon" :name="layer.icon" :size="null" />{{ shownLayerName(layer.name, layer.id) }}</UiChip>
        </li>
      </ul>
      <UiButton class="place-details__open" @click="openSuggestions">
        <span>{{ t('Show these in Data Layers') }}</span><span class="place-details__open-go">{{ t('Open') }} ›</span>
      </UiButton>
    </section>
  </div>
</template>
