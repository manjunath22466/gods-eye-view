<script setup>
import { computed, nextTick, onBeforeUnmount, shallowRef, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import { useCctvStore } from '../../stores/cctv.js';
import { contextRadiusKm } from '../../contextRadius.js';
import { contextNeedle, matchesContextSearch } from '../../contextSearch.js';
import { leaveContextLists, setContextListPresence } from '../../contextLists.js';
import { distanceText } from '../../distanceText.js';
import ContextListCard from '../../kit/ContextListCard.vue';

// Context's Cameras list: every loaded camera within Context's radius of the
// centre of the view, nearest first, in the order Nearby lists them and
// Prev/Next on the Data Layers row steps through them (the layer's
// camerasNear). It stays in the page while Cameras is on, so its tab shows
// with its count; a row opens the camera's card on Inspect. The list card
// pages it, and its order (after Context's search) is the one Prev/Next and
// auto-hop walk.

// Whether the Cameras list is on screen: only then do its search and order
// steer Prev/Next and auto-hop.
const props = defineProps({ shown: { type: Boolean, default: false } });

const store = useEntityCardStore();
const chrome = usePanelChromeStore();
const cctvView = useCctvStore();

// Changes only when Cameras turns on or off or its catalog changes, so the
// list is not rebuilt for every other layer's update.
const catalogKey = computed(() => {
  void store.managerVersion;
  void store.layerRevision;
  const row = store.liveLayers().find((layer) => layer.id === 'cctv');
  return row ? `on|${row.stats?.count ?? ''}` : 'off';
});
const cctv = () => store.layerModule('cctv');
const center = computed(() => {
  const at = store.view?.center;
  return Number.isFinite(at?.lat) && Number.isFinite(at?.lon) ? { lat: at.lat, lon: at.lon } : null;
});
const contextOpen = computed(() => chrome.panels['global-context-panel']?.collapsed === false);

// Every camera within the radius, nearest first.
const cameras = computed(() => {
  if (catalogKey.value === 'off' || !center.value) return [];
  try {
    return cctv()?.camerasNear?.(center.value, { radiusKm: contextRadiusKm.value }) || [];
  } catch {
    return [];
  }
});
// Narrowed by Context's search.
const search = (camera) => !contextNeedle.value || matchesContextSearch(camera.name, camera.city, camera.provider);
const order = shallowRef([]);

// The tab, with the count Nearby's Cameras group shows, while Cameras is on.
watch(
  [catalogKey, cameras],
  ([key, list]) => setContextListPresence('cctv', key === 'off' ? null : { count: center.value ? list.length : null }),
  { immediate: true },
);
// Prev/Next walk this list while Context is open; with Context closed its
// centre is not kept up to date, so they walk the cameras nearest the view.
// The list's own order counts only while it shows. A new search, the list
// showing or hiding, or Context opening or closing starts a new walk; a
// recentre does not.
const HIDDEN = Symbol('hidden list');
let walkedFor;
watch(
  [catalogKey, center, contextRadiusKm, contextOpen, order, () => props.shown, contextNeedle],
  ([key, at, radiusKm, open, ids, shown, needle]) => {
    const listed = key !== 'off' && open && at;
    const listedFor = listed ? (shown ? needle : HIDDEN) : null;
    const restart = walkedFor !== undefined && listedFor !== walkedFor;
    walkedFor = listedFor;
    try {
      cctv()?.setNearbyArea?.(listed ? { ...at, radiusKm, order: shown ? ids : null, restart } : restart ? { restart } : null);
    } catch {
      // The walk then goes by the view.
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  setContextListPresence('cctv', null);
  try {
    cctv()?.setNearbyArea?.(walkedFor != null ? { restart: true } : null);
  } catch {
    // Nothing to let go of.
  }
});

const radiusText = computed(() => t('{n} km', { n: formatNumber(contextRadiusKm.value) }));
const detail = (camera) => [camera.city, camera.provider].filter(Boolean).join(' · ');
const provider = (camera) => camera.provider || t('Other');
// The open camera's dot: live while its video plays, else paused.
const openId = computed(() => cctvView.view?.activeCameraId ?? null);
const liveText = computed(() => (cctvView.live ? t('Live') : t('Paused')));

// A row opened from the keyboard: the card takes the list's place, so focus
// moves to its first action. A pointer open leaves focus be.
async function openCamera(camera, event) {
  leaveContextLists();
  store.open({ layerId: 'cctv', id: String(camera.id), label: camera.name, lat: camera.lat, lon: camera.lon });
  if (event?.detail !== 0) return;
  // After the card has rendered.
  await nextTick();
  const card = globalThis.document?.getElementById('entity-card');
  (card?.querySelector('.entity-card__actions button:not(:disabled)') ?? card?.querySelector('button:not(:disabled)'))?.focus({ preventScroll: true });
}
</script>

<template>
  <ContextListCard
    id="cctv"
    :title="t('Cameras')"
    icon="videocam"
    :items="cameras"
    :item-key="(camera) => String(camera.id)"
    :filter="search"
    :query="contextNeedle"
    :group-by="provider"
    @order="order = $event"
    @select="openCamera"
  >
    <template #row="{ item: camera }">
      <i v-if="String(camera.id) === openId" class="view-context__dot" :class="cctvView.live ? 'view-context__dot--nominal' : 'view-context__dot--stale'" role="img" :aria-label="liveText" :title="liveText"></i>
      <span class="camera-list__text">
        <span class="nearby-lists__name" :title="camera.name">{{ camera.name || camera.id }}</span>
        <span v-if="detail(camera)" class="camera-list__detail" :title="detail(camera)">{{ detail(camera) }}</span>
      </span>
      <span class="nearby-lists__meta">{{ distanceText(camera.km) }}</span>
    </template>
    <template #empty>{{ t('No cameras within {radius} of the view centre', { radius: radiusText }) }}</template>
    <template #no-matches>{{ t('No cameras here match the search') }}</template>
  </ContextListCard>
</template>
