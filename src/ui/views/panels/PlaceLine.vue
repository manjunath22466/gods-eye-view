<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { nearestCity } from '../../../data/wikidataCities.js';
import { airportCode } from '../../../data/airports.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { regionalBrief } from '../../spotConditions.js';
import { clockLine } from '../../contextTime.js';
import UiButton from '../../kit/UiButton.vue';
import { focusInCard } from '../../cardFocus.js';
import UiIcon from '../../kit/UiIcon.vue';
import { nearSite, placeIdentity, placeKey, placePin, spotCoordinates } from '../../placeCard.js';

// A place line: a spot's name with a 📌 that pins it as a still
// place pin, then its coordinates, its local time and, within about 2 km of
// an airport or base, a "near" link to that site's card. The link only
// offers the card; it never opens by itself. A spot without a
// name goes by the nearest city, from the bundled cities pack.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  /** The place's name; empty names the spot after the nearest city. */
  name: { type: String, default: '' },
  /** How the place was picked: 'spot' (empty ground), 'search' or 'airport'. */
  from: { type: String, default: 'spot' },
  /** The airport this line is about, when it is one (no near link to itself). */
  airport: { type: Object, default: null },
  /** Show the name and the 📌; a card already shows its name and its Pin. */
  headed: { type: Boolean, default: true },
  /**
   * Read the local time (the regional brief's time zone). A clicked spot
   * does not: a click on empty ground asks for nothing, and its line is the
   * name and coordinates alone. A place's card, once opened, does.
   */
  readsTime: { type: Boolean, default: true },
});

const store = useEntityCardStore();
const pinned = usePinnedStore();

const cityName = ref('');
watch(
  () => (props.name ? '' : `${props.lat.toFixed(3)},${props.lon.toFixed(3)}`),
  async (key) => {
    cityName.value = '';
    if (!key) return;
    try {
      const city = await nearestCity(props.lat, props.lon, { radiusKm: 30, nearKm: 10 });
      if (key === `${props.lat.toFixed(3)},${props.lon.toFixed(3)}`) cityName.value = city?.name || '';
    } catch {
      cityName.value = '';
    }
  },
  { immediate: true },
);
const shownName = computed(() => props.name || cityName.value || t('Picked spot'));

const coordinates = computed(() => spotCoordinates(props.lat, props.lon, (n) => formatNumber(n, { minimumFractionDigits: 4, maximumFractionDigits: 4 })));

// The local time, from the time zone the spot's weather reading names.
const zone = ref(null);
watch(
  () => (props.readsTime ? `${props.lat.toFixed(2)},${props.lon.toFixed(2)}` : ''),
  async (key) => {
    zone.value = null;
    if (!key) return;
    const brief = await regionalBrief(props.lat, props.lon, store.readWeather, { kind: 'weather' }).catch(() => null);
    if (key === `${props.lat.toFixed(2)},${props.lon.toFixed(2)}`) zone.value = brief?.weather || null;
  },
  { immediate: true },
);
const now = ref(Date.now());
let clock = 0;
onMounted(() => {
  clock = setInterval(() => (now.value = Date.now()), 30_000);
});
onBeforeUnmount(() => clearInterval(clock));
const time = computed(() => clockLine(zone.value, now.value));

// The airport or base within about 2 km, if any.
const near = ref(null);
watch(
  () => `${props.lat.toFixed(4)},${props.lon.toFixed(4)}|${props.airport?.ident || ''}`,
  async (key) => {
    near.value = null;
    const found = await nearSite(props.lat, props.lon, { recordsNear: store.recordsNear }).catch(() => null);
    if (key !== `${props.lat.toFixed(4)},${props.lon.toFixed(4)}|${props.airport?.ident || ''}`) return;
    // An airport's own card has no link to itself.
    if (found?.kind === 'airport' && found.airport.ident === props.airport?.ident) return;
    near.value = found;
  },
  { immediate: true },
);
const nearText = computed(() => {
  const site = near.value;
  if (!site) return '';
  const km = formatNumber(site.km < 10 ? Number(site.km.toFixed(1)) : Math.round(site.km));
  return site.kind === 'airport'
    ? t('near {name} ({code}) · {km} km', { name: site.airport.name, code: airportCode(site.airport), km })
    : t('near {name} · {km} km', { name: site.name, km });
});
// The link goes with the card it was on: focus moves to the new card's Back
// (an airport's), else its title.
function openNear() {
  const site = near.value;
  if (!site) return;
  if (site.kind === 'airport') {
    if (store.openAirport(site.airport)) void focusInCard(['.place-details__back']);
  } else if (store.open(site.identity)) void focusInCard([]);
}

// The 📌: a still place pin with a map, its name and where it is.
const identity = computed(() => placeIdentity({ name: shownName.value, lat: props.lat, lon: props.lon, from: props.from, airport: props.airport }));
const isPinned = computed(() => pinned.isPinned(placeKey(identity.value)));
function togglePin() {
  pinned.toggle(placePin(identity.value, shownName.value));
}
</script>

<template>
  <div class="place-line">
    <div v-if="headed" class="place-line__head">
      <strong class="place-line__name">{{ shownName }}</strong>
      <UiButton class="place-line__pin" :pressed="isPinned" pressed-class="is-on" :label="isPinned ? t('Unpin {name}', { name: shownName }) : t('Pin {name} to the Pinned tab', { name: shownName })" :title="isPinned ? t('Unpin from the Pinned tab') : t('Pin to the Pinned tab')" @click="togglePin">
        <UiIcon name="keep" :size="null" />
      </UiButton>
    </div>
    <p class="place-line__meta">
      <span>{{ coordinates }}</span>
      <span v-if="readsTime">{{ time }}</span>
      <UiButton v-if="near" class="place-line__near" @click="openNear">{{ nearText }}</UiButton>
    </p>
  </div>
</template>
