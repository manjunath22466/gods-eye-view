<script setup>
import { computed, ref, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { nearestCity } from '../../../data/wikidataCities.js';
import { airportCode, NEAR_AIRPORT_KM } from '../../../data/airports.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import UiButton from '../../kit/UiButton.vue';
import { focusInCard } from '../../cardFocus.js';
import { BASES_LAYER, nearSite, spotCoordinates } from '../../placeCard.js';

// A place line: a spot's name, then its coordinates, its local time and, within about 2 km of
// an airport or base, a "near" link to that site's card. The link only
// offers the card; it never opens by itself. A spot without a
// name goes by the nearest city, from the bundled cities pack.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  /** The place's name; empty names the spot after the nearest city. */
  name: { type: String, default: '' },
  /** The airport this line is about, when it is one (no near link to itself). */
  airport: { type: Object, default: null },
  /** Show the name; a card already shows it in its own header. */
  headed: { type: Boolean, default: true },
  time: { type: String, default: '' },
});

const store = useEntityCardStore();

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

// The airport or base within about 2 km, if any.
const near = ref(null);
const loadedAt = computed(() => {
  void store.tick;
  if (store.layerOff(BASES_LAYER)) return null;
  return store.layerModule(BASES_LAYER)?.getStats?.()?.lastUpdate ?? null;
});
watch(
  [() => props.lat, () => props.lon, () => props.airport?.ident, () => store.layerOff(BASES_LAYER), () => store.baseCatalogRevision, loadedAt],
  async (_, __, onCleanup) => {
    let current = true;
    onCleanup(() => { current = false; });
    near.value = null;
    const found = await nearSite(props.lat, props.lon, { recordsNear: store.recordsNear }).catch(() => null);
    if (!current) return;
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
  if (!site || (site.kind === 'base' && store.layerOff(BASES_LAYER))) return;
  if (site.kind === 'airport') {
    if (store.openAirport(site.airport, { fromNear: true })) void focusInCard(['.place-details__back'], store);
  } else {
    // A parked viewport can replace its base records between visible-card refreshes.
    const [nearest] = store.recordsNear(BASES_LAYER, props.lat, props.lon, NEAR_AIRPORT_KM);
    if (nearest?.record.id === site.identity.id && store.open(site.identity)) void focusInCard([], store);
  }
}
</script>

<template>
  <div class="place-line">
    <div v-if="headed" class="place-line__head">
      <strong class="place-line__name">{{ shownName }}</strong>
    </div>
    <p class="place-line__meta">
      <span>{{ coordinates }}</span>
      <span v-if="time">{{ time }}</span>
      <UiButton v-if="near" class="place-line__near" :data-airport="near.airport?.ident" @click="openNear">{{ nearText }}</UiButton>
    </p>
  </div>
</template>
