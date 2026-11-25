<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatNumber, t, tn } from '../../../i18n/index.js';
import { distanceKm } from '../../../data/entityContext.js';
import { CONTEXT_RADIUS_STEPS, contextRadiusKm, setContextRadiusKm } from '../../contextRadius.js';
import { contextNeedle, matchesContextSearch } from '../../contextSearch.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { useOmnibarStore } from '../../stores/omnibar.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { useRadioStore } from '../../stores/radio.js';
import { stationCategory, stationPinKey, stationPlayback, toggleStation } from '../../radioContext.js';
import { pinnedStationMiss } from '../../pinnedStation.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import RadioVolume from './RadioVolume.vue';
import MarqueeText from './MarqueeText.vue';

// Radio in Context: while the Radio layer is on and nothing is picked,
// Context shows its stations directly, under Inspect when something is
// pinned. The station that is selected leads, with Pause, Fly to and Pin
// (only it can be pinned; its pin is a still on the Pinned tab). Tag chips and
// the Context search narrow the list, which holds the stations within the
// Context radius, nearest first. Choosing a row plays it.
const props = defineProps({
  /** The Radio layer module and its UI state (see useRadioLayer). */
  module: { type: Object, default: null },
  ui: { type: Object, default: null },
});

const cards = useEntityCardStore();
const { view } = storeToRefs(cards);
const omnibar = useOmnibarStore();
const pinned = usePinnedStore();
const radio = useRadioStore();

const selected = computed(() => props.ui?.selected || null);
// The selected station's playback, read as the mini player reads it
// (stationPlayback), so the two never disagree.
const playback = computed(() => stationPlayback(props.ui, selected.value?.id));
const playingHere = computed(() => playback.value === 'live' || playback.value === 'loading');
// A stream that failed says so, and why under the name, as the Radio fold
// does, instead of "Paused".
const failedHere = computed(() => playback.value === 'lost');
const stateText = computed(
  () =>
    ({ live: t('Playing'), loading: t('Loading'), lost: t('No feed'), paused: t('Paused') })[playback.value] ||
    t('Ready'),
);
const failure = computed(() =>
  failedHere.value ? (props.ui.audioError ? t(props.ui.audioError) : t('Broadcaster stream unavailable')) : '',
);

const center = computed(() => view.value?.center || null);
const away = (station) =>
  center.value && Number.isFinite(station?.lat) ? distanceKm(center.value, { lat: station.lat, lon: station.lon }) : null;
const distance = (km) =>
  km === null ? '' : t('{n} km', { n: formatNumber(km < 10 ? Number(km.toFixed(1)) : Math.round(km)) });
const placeOf = (station) => [station.state, station.country].filter(Boolean).join(', ');
const tagOf = (station) => (Array.isArray(station.tags) ? station.tags[0] : '') || '';
// A station's category, coloured as its marker; its first tag follows on
// the meta line unless it only repeats the category.
const categoryOf = (station) => stationCategory(props.module, props.ui, station);
const selectedCategory = computed(() => (selected.value ? categoryOf(selected.value) : null));
const selectedTag = computed(() => {
  const tag = selected.value ? tagOf(selected.value) : '';
  return tag && tag.toLowerCase() !== selectedCategory.value?.label.toLowerCase() ? tag : '';
});

// The stations of the tag shown, within the radius, nearest first.
const stations = computed(() => {
  const module = props.module;
  const ui = props.ui;
  if (!module || !ui?.enabled) return { count: 0, rows: [] };
  void ui.acceptedCatalogGeneration;
  const all = module.getRadioAcceptedCatalogSnapshot?.()?.stations || [];
  const shown = module.filterRadioStations ? module.filterRadioStations(all, ui.filter) : all;
  const found = [];
  for (const station of shown) {
    const km = away(station);
    if (km === null || km > contextRadiusKm.value) continue;
    if (contextNeedle.value && !matchesContextSearch(station.name, ...(station.tags || []))) continue;
    found.push({ station, km });
  }
  found.sort((a, b) => a.km - b.km);
  return { count: found.length, rows: found.slice(0, contextNeedle.value ? 30 : 12) };
});

// About seven rows show; more scroll inside the list, so Tuner and Worldwide
// Now stay near. The cap is the seventh row's bottom, so a row that wraps
// counts at its real height. It is measured again only when the rows or the
// list's width change, and kept unless it moves, so the scrollbar does not
// blink as stations refresh.
const LIST_ROWS = 7;
const list = ref(null);
const listCap = ref(0);
function measureList() {
  const el = list.value;
  const rows = el?.children;
  const last = rows && rows.length > LIST_ROWS ? rows[LIST_ROWS - 1] : null;
  const cap = last ? Math.ceil(last.offsetTop + last.offsetHeight) : 0;
  if (Math.abs(cap - listCap.value) > 1 || (!cap && listCap.value)) listCap.value = cap;
}
const rowKey = computed(() => stations.value.rows.map(({ station }) => station.id).join('|'));
// The list and its rows are watched for size: a capped list keeps its own
// height while a row rewraps (a font arriving, a narrower column).
let listObserver = null;
function observeList() {
  if (!listObserver) return;
  listObserver.disconnect();
  const el = list.value;
  if (!el) return;
  listObserver.observe(el);
  for (const row of el.children) listObserver.observe(row);
}
watch([list, rowKey], () =>
  nextTick(() => {
    observeList();
    measureList();
  }),
);
onMounted(() => {
  if (typeof ResizeObserver === 'function') listObserver = new ResizeObserver(() => measureList());
  observeList();
  measureList();
});
onBeforeUnmount(() => {
  listObserver?.disconnect();
  listObserver = null;
});
// A row reached by the keyboard comes into the list's view.
const showFocused = (event) => {
  if (listCap.value) event.target?.closest?.('li')?.scrollIntoView?.({ block: 'nearest' });
};

// The first few tags as chips, and the tag in use wherever it sits; the rest
// open with More tags.
// A sparse list (a few stations, all far out) offers the next radius step.
const SPARSE_AT = 3;
const nextRadius = computed(() => CONTEXT_RADIUS_STEPS.find((step) => step > contextRadiusKm.value) ?? null);
const sparse = computed(
  () => !contextNeedle.value && stations.value.count > 0 && stations.value.count <= SPARSE_AT && nextRadius.value !== null,
);
const widen = () => nextRadius.value !== null && setContextRadiusKm(nextRadius.value);
// Four chips at a time (All and three tags), then More: one row.
const CHIPS_SHOWN = 3;
const allTags = ref(false);
const chips = computed(() => {
  const tags = (props.ui?.categories || []).filter((category) => category.id !== 'all');
  const filter = props.ui?.filter || 'all';
  const shown = allTags.value
    ? tags
    : tags.filter((tag, index) => index < CHIPS_SHOWN || tag.id === filter);
  return [{ id: 'all', label: t('All', { context: 'radio tag' }) }, ...shown];
});
const moreTags = computed(() => (props.ui?.categories || []).filter((category) => category.id !== 'all').length > CHIPS_SHOWN);
const setFilter = (id) => radio.act('setRadioFilter', id);

const play = (station) => props.module?.selectStation?.(station.id, { autoplay: true, origin: 'user' });
const togglePlayback = () => selected.value && void toggleStation(props.module, props.ui, selected.value.id);
function flyTo() {
  const station = selected.value;
  if (!station || !omnibar.runner) return;
  void omnibar.runner('fly_to_location', { latitude: station.lat, longitude: station.lon });
}
const isPinned = computed(() => Boolean(selected.value && pinned.isPinned(stationPinKey(selected.value.id))));
function togglePin() {
  const station = selected.value;
  if (!station) return;
  pinned.toggle({
    key: stationPinKey(station.id),
    kind: 'station',
    title: station.name,
    icon: 'radio',
    identity: { layerId: 'radio', id: station.id, label: station.name, lat: station.lat, lon: station.lon },
  });
}
// Now playing's one line: what the station is and where, shortened with an
// ellipsis when long, then its distance, which always stays on the line.
const metaText = computed(() => {
  const station = selected.value;
  if (!station) return '';
  return [selectedTag.value, placeOf(station), station.codec, station.bitrate ? t('{n}k', { n: station.bitrate }) : ''].filter(Boolean).join(' · ');
});
const metaDistance = computed(() => (selected.value ? distance(away(selected.value)) : ''));
</script>

<template>
  <section v-if="ui?.enabled" class="radio-stations" :aria-label="t('Radio')">
    <p class="radio-stations__eyebrow">{{ selected ? t('Radio · now playing') : t('Radio') }}</p>
    <!-- A pinned station played from its tile that is not in the directory. -->
    <p v-if="pinnedStationMiss" class="radio-stations__miss" role="status">{{ t('{name} is not in the station directory right now', { name: pinnedStationMiss.name }) }}</p>
    <p v-if="!selected" class="radio-stations__idle">{{ t('No station selected · pick one to play') }}</p>
    <div v-if="selected" class="radio-stations__now">
      <div class="radio-stations__now-head">
        <UiIcon name="radio" :size="null" />
        <strong><MarqueeText :text="selected.name" /></strong>
        <span class="radio-stations__state" :class="{ 'is-on': playingHere, 'is-error': failedHere }">{{ stateText }}</span>
      </div>
      <p v-if="failure" class="radio-stations__error" role="status">{{ failure }}</p>
      <p class="radio-stations__meta">
        <span v-if="selectedCategory" class="radio-category" :style="{ '--radio-category': selectedCategory.color }">{{ selectedCategory.label }}</span>
        <span class="radio-stations__meta-text" :title="metaText">{{ metaText }}</span>
        <span v-if="metaDistance" class="radio-stations__meta-distance">{{ metaDistance }}</span>
      </p>
      <RadioVolume class="radio-stations__volume" :ui="ui" />
      <div class="radio-stations__actions">
        <UiButton class="entity-card__action" @click="togglePlayback">
          <UiIcon :name="playingHere ? 'pause' : 'play_arrow'" :size="null" />{{ playingHere ? t('Pause') : t('Play') }}
        </UiButton>
        <UiButton class="entity-card__action" @click="flyTo">
          <UiIcon name="my_location" :size="null" />{{ t('Fly to') }}
        </UiButton>
        <UiButton class="entity-card__action entity-card__action--pin" :pressed="isPinned" pressed-class="entity-card__action--on" :title="isPinned ? t('Unpin from the Pinned tab') : t('Pin to the Pinned tab')" @click="togglePin">
          <UiIcon name="keep" :size="null" />{{ isPinned ? t('Pinned') : t('Pin') }}
        </UiButton>
      </div>
    </div>

    <div class="radio-stations__chips" role="group" :aria-label="t('Filter stations by station tag')">
      <UiButton v-for="chip in chips" :key="chip.id" :pressed="(ui.filter || 'all') === chip.id" :disabled="!ui.presentationActive" @click="setFilter(chip.id)">{{ chip.label }}</UiButton>
      <UiButton v-if="moreTags" class="radio-stations__more" :disabled="!ui.presentationActive" :aria-expanded="String(allTags)" @click="allTags = !allTags">{{ allTags ? t('Fewer tags') : t('More tags') }}</UiButton>
    </div>

    <h4 class="radio-stations__label">
      <template v-if="sparse">{{ tn(stations.count, 'Only {count} station within {radius}', 'Only {count} stations within {radius}', { radius: t('{n} km', { n: formatNumber(contextRadiusKm) }) }) }}</template>
      <template v-else>{{ tn(stations.count, 'Station within {radius} · {count}', 'Stations within {radius} · {count}', { radius: t('{n} km', { n: formatNumber(contextRadiusKm) }), count: formatNumber(stations.count) }) }}</template>
      <UiButton v-if="sparse" class="radio-stations__widen" @click="widen">{{ t('Widen the radius') }}</UiButton>
    </h4>
    <ul v-if="stations.rows.length" ref="list" class="radio-stations__list ui-scroll" :class="{ 'is-capped': listCap > 0 }" :style="listCap ? { maxHeight: `${listCap}px` } : undefined" @focusin="showFocused">
      <li v-for="{ station, km } in stations.rows" :key="station.id" :class="{ 'is-selected': station.id === selected?.id }">
        <UiButton :aria-current="station.id === selected?.id ? 'true' : undefined" @click="play(station)">
          <span v-if="categoryOf(station)" class="radio-category-dot" :style="{ '--radio-category': categoryOf(station).color }" role="img" :aria-label="categoryOf(station).label" :title="categoryOf(station).label"></span>
          <span class="radio-stations__name" :title="station.name">{{ station.name }}<template v-if="tagOf(station)"> · {{ tagOf(station) }}</template></span>
          <UiIcon v-if="station.id === selected?.id && playingHere" class="radio-stations__playing" name="play_arrow" :size="null" />
          <span class="radio-stations__distance">{{ distance(km) }}</span>
        </UiButton>
      </li>
    </ul>
    <p v-else class="radio-stations__empty">
      {{ ui.loading ? t('Reading the station directory…') : t('No stations within {radius}. Widen the radius or zoom out.', { radius: t('{n} km', { n: formatNumber(contextRadiusKm) }) }) }}
      <UiButton v-if="!ui.loading && nextRadius !== null" class="radio-stations__widen" @click="widen">{{ t('Widen the radius') }}</UiButton>
    </p>
    <!-- Every way a station starts (a row, the globe, voice, a pinned tile)
         streams from its broadcaster: said where the stations are, in view. -->
    <p class="radio-stations__privacy">{{ t('Stations play straight from their broadcasters, who see your IP address.') }}</p>
    <!-- Radio's tuner, transport and volume (RadioFold) move in here. -->
    <div id="radio-fold-slot"></div>
  </section>
</template>
