<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { formatNumber, onLocaleChange, t } from '../../../i18n/index.js';
import { hazardsNear } from '../../spotConditions.js';
import { distanceKm } from '../../../data/entityContext.js';
import { useOmnibarStore } from '../../stores/omnibar.js';
import { shownLayerName } from '../../layerNames.js';
import { contextRadiusKm } from '../../contextRadius.js';
import { contextNeedle, matchesContextSearch } from '../../contextSearch.js';
import { sayWords, useEntityCardStore } from '../../stores/entityCard.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import NearbyLists from './NearbyLists.vue';
import { focusCardTitle } from '../../cardFocus.js';

// Nearby, at the foot of every card: one list per layer that is on, sorted by
// distance, with the picked item's own layer first (other cameras for a
// camera, other vessels for a vessel). It looks out as far as the Context
// radius, the same distance the counts use, and is set where the counts are.
// A satellite's card lists what is inside its swath instead: the ground it
// sees right now. Natural hazards near the item follow (earthquakes, tropical
// storms and wildfire perimeters from their public feeds, also while those
// layers are off; satellite fire hits only while FIRMS is on), then warnings
// broadcast by things nearby.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  /** The selected item's own key, left out of the lists. */
  excludeKey: { type: String, default: '' },
  /** The selected item's layer, listed first. */
  ownLayer: { type: String, default: '' },
  /** A satellite's swath width: the lists look inside it instead. */
  swathKm: { type: Number, default: null },
  /**
   * How far the item moves before its hazards are read again: 1 km for
   * something that stays put (a correction of its position), 25 km for one
   * that moves.
   */
  settleKm: { type: Number, default: 1 },
});

const store = useEntityCardStore();
const omnibar = useOmnibarStore();

// What the layers have nearby moves with their records; read it often.
const tick = ref(0);
let timer = null;
onMounted(() => {
  timer = setInterval(() => tick.value++, 4000);
});
onBeforeUnmount(() => clearInterval(timer));

const inSwath = computed(() => Number.isFinite(props.swathKm) && props.swathKm > 0);
const radiusKm = computed(() => (inSwath.value ? props.swathKm / 2 : contextRadiusKm.value));
const km = (n) => t('{n} km', { n: formatNumber(n) });
const title = computed(() =>
  inSwath.value
    ? t('Inside the swath · {width} wide', { width: km(Math.round(props.swathKm)) })
    : t('Nearby · {radius}', { radius: km(contextRadiusKm.value) }),
);

// The Context search narrows every list below to what holds its text.
const searching = computed(() => Boolean(contextNeedle.value));
const lists = computed(() => {
  void tick.value;
  const found = store.nearbyLayers(props.lat, props.lon, {
    radiusKm: radiusKm.value,
    limit: searching.value ? 12 : 3,
    excludeKey: props.excludeKey,
    query: contextNeedle.value,
    excludeLayers: ['radio'],
  });
  if (!props.ownLayer) return found;
  return [...found.filter((list) => list.layerId === props.ownLayer), ...found.filter((list) => list.layerId !== props.ownLayer)];
});

const alerts = computed(() => {
  void tick.value;
  return store
    .alertsAt(props.lat, props.lon, { radiusKm: radiusKm.value, limit: searching.value ? 40 : 4 })
    .filter((alert) => alert.key !== props.excludeKey)
    .filter((alert) => matchesContextSearch(alert.title, sayWords(alert.words, alert.text), alert.text));
});

// Hazards near the item, from the feeds the hazard layers read, kept for
// five minutes whichever spot asks (spotConditions.js): the same cache
// guards every read here, the scheduled ones included, so a feed is asked at
// most once every five minutes. They look out as far as the Context radius,
// also on a satellite's card (whose Nearby lists keep to its swath). They
// are read again once the item has moved more than `settleKm` (after a
// short settle), when the radius or FIRMS changes, in a new language, and
// every five minutes while the card stays open.
const HAZARD_LAYER = {
  quake: 'earthquakes',
  storm: 'weather-cyclones',
  wildfire: 'fire-perimeters',
  hotspots: 'local-firms',
};
// Far enough out to see the markers (and pick one), not just the ground.
const HAZARD_RANGE_M = { quake: 120000, storm: 1500000, wildfire: 40000, hotspots: 180000 };
const SETTLE_MS = 350;
const REREAD_MS = 5 * 60_000;
const hazards = ref([]);
let hazardsAt = null;
let readingHazards = 0;
let settleTimer = 0;
const layerRows = () => omnibar.controls?.layers() || [];
// Satellite fire hits need FIRMS on: read live wherever it decides a request
// or a row, never from a copy that may be seconds old.
const firmsLive = () => Boolean(layerRows().find((layer) => layer.id === HAZARD_LAYER.hotspots)?.enabled);
// What the template follows to notice FIRMS turning on or off: at once, from
// manager changes, layer updates and the poll.
const firesOn = computed(() => {
  void store.managerVersion;
  void store.layerRevision;
  void tick.value;
  return firmsLive();
});
async function readHazards() {
  hazardsAt = { lat: props.lat, lon: props.lon };
  const mine = ++readingHazards;
  const next = await hazardsNear(props.lat, props.lon, contextRadiusKm.value, { fires: firmsLive() }).catch(() => []);
  if (readingHazards === mine) hazards.value = next;
}
watch(
  () => [props.lat, props.lon],
  () => {
    if (!hazardsAt) return void readHazards();
    if (distanceKm(hazardsAt, { lat: props.lat, lon: props.lon }) <= props.settleKm) return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void readHazards(), SETTLE_MS);
  },
  { immediate: true },
);
watch([contextRadiusKm, firesOn], () => void readHazards());
const stopLocale = onLocaleChange(() => void readHazards());
let rereadTimer = 0;
onMounted(() => {
  rereadTimer = setInterval(() => void readHazards(), REREAD_MS);
});
onBeforeUnmount(() => {
  clearInterval(rereadTimer);
  clearTimeout(settleTimer);
  stopLocale();
});
const hazardLayers = computed(() => {
  void store.managerVersion;
  void store.layerRevision;
  void tick.value;
  const rows = layerRows();
  return Object.fromEntries(
    Object.entries(HAZARD_LAYER).map(([kind, id]) => {
      const row = rows.find((layer) => layer.id === id);
      return [kind, row ? { id, name: shownLayerName(row.name, id), on: Boolean(row.enabled) } : null];
    }),
  );
});
// Fire hits show only while FIRMS is on now, whatever a read found earlier.
const liveHazards = computed(() => {
  void store.managerVersion;
  void store.layerRevision;
  void tick.value;
  const fires = firmsLive();
  return hazards.value.filter((hazard) => hazard.kind !== 'hotspots' || fires);
});
const shownHazards = computed(() =>
  liveHazards.value.filter((hazard) => matchesContextSearch(hazard.title, hazard.detail, hazardLayers.value[hazard.kind]?.name)).slice(0, searching.value ? 12 : 5),
);
// Picking a hazard turns its layer on (when it is off), so its marker is
// there to select, and flies to it.
function flyToHazard(hazard) {
  // A fire-hit row left over from before FIRMS went off does nothing.
  if (hazard.kind === 'hotspots' && !firmsLive()) return;
  const layer = hazardLayers.value[hazard.kind];
  if (layer && !layer.on) void omnibar.controls?.setLayer(layer.id, true);
  omnibar.runner?.('fly_to_location', {
    latitude: hazard.at.lat,
    longitude: hazard.at.lon,
    query: hazard.title,
    viewMode: 'overview',
    rangeM: HAZARD_RANGE_M[hazard.kind] ?? 100000,
  });
}

// The feeds behind the hazard rows, credited in the card: their layers may
// be off, so the map's own credits do not name them.
const HAZARD_SOURCE = { quake: 'USGS', storm: 'NOAA NHC', wildfire: 'NIFC WFIGS', hotspots: 'NASA FIRMS' };
const hazardSources = computed(() => [...new Set(liveHazards.value.map((hazard) => HAZARD_SOURCE[hazard.kind]).filter(Boolean))].join(' · '));

const distance = (n) =>
  t('{n} km', { n: n < 10 ? formatNumber(n, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : formatNumber(Math.round(n)) });
</script>

<template>
  <section class="spot-conditions" :aria-label="title">
    <NearbyLists :lists="lists" :title="title" :list-links="false" @focus-lost="focusCardTitle()" />

    <div v-if="shownHazards.length" class="spot-conditions__block spot-conditions__hazards">
      <h4>
        <UiIcon name="warning" :size="null" />
        <span>{{ t('Hazards within {radius}', { radius: km(contextRadiusKm) }) }}</span>
        <span class="spot-conditions__count spot-conditions__count--hot">{{ shownHazards.length }}</span>
      </h4>
      <ul>
        <li v-for="hazard in shownHazards" :key="`${hazard.kind}-${hazard.title}-${hazard.distanceKm}`" :class="`spot-conditions__hazard--${hazard.kind}`">
          <UiButton @click="flyToHazard(hazard)">
            <UiIcon :name="hazard.icon" :size="null" />
            <span class="spot-conditions__row-main">
              <span class="spot-conditions__row-title">{{ hazard.title }}</span>
              <span v-if="hazard.detail" class="spot-conditions__row-detail">{{ hazard.detail }}</span>
              <span v-if="hazardLayers[hazard.kind]" class="spot-conditions__row-layer" :class="{ 'is-on': hazardLayers[hazard.kind].on }" :title="hazardLayers[hazard.kind].on ? t('Layer on') : t('Turns the layer on')">
                <span class="spot-conditions__row-dot" aria-hidden="true"></span>{{ hazardLayers[hazard.kind].name }}
              </span>
            </span>
            <span class="spot-conditions__row-meta">{{ distance(hazard.distanceKm) }} {{ t(hazard.direction) }}</span>
          </UiButton>
        </li>
      </ul>
      <p v-if="hazardSources" class="spot-conditions__source">{{ hazardSources }}</p>
    </div>

    <div v-if="alerts.length" class="spot-conditions__block">
      <h4>
        <UiIcon name="emergency_home" :size="null" />
        <span>{{ t('Broadcast alerts') }}</span>
        <span class="spot-conditions__count spot-conditions__count--hot">{{ alerts.length }}</span>
      </h4>
      <ul>
        <li v-for="alert in alerts" :key="alert.key" class="spot-conditions__hazard--alert">
          <UiButton @click="store.open(alert.identity)">
            <UiIcon :name="alert.icon" :size="null" />
            <span class="spot-conditions__row-main">
              <span class="spot-conditions__row-title">{{ alert.title }}</span>
              <span class="spot-conditions__row-detail">{{ sayWords(alert.words, alert.text) }}</span>
            </span>
            <span class="spot-conditions__row-meta">{{ distance(alert.distanceKm) }}</span>
          </UiButton>
        </li>
      </ul>
    </div>
  </section>
</template>
