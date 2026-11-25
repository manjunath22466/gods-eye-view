<script setup>
import { computed, onBeforeUnmount, shallowRef, watch } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import { useCctvStore } from '../../stores/cctv.js';
import { contextRadiusKm } from '../../contextRadius.js';
import { contextNeedle, matchesContextSearch } from '../../contextSearch.js';
import EntityCard from './EntityCard.vue';
import { distanceText } from '../../distanceText.js';
import ContextListCard from '../../kit/ContextListCard.vue';

// The inline list and Data Layers controls use the same distance-sorted walk.
const props = defineProps({ shown: { type: Boolean, default: false }, selected: { type: String, default: null } });

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
const returnCenter = shallowRef(null);
const manualInput = computed(() => store.view?.manualInputCount ?? 0);
const listReset = shallowRef(0);
const returnRevision = computed(() => `${manualInput.value}:${store.viewCommandRevision}:${contextRadiusKm.value}:${listReset.value}`);
const discardCenter = () => (returnCenter.value = null);
function resetReturn() {
  discardCenter();
  listReset.value++;
}
watch([() => props.shown, () => props.selected], ([shown, selected]) => {
  if (!shown && !selected && returnCenter.value) resetReturn();
});

// A row pick flies away. Keep its list origin for the trip back, while the
// camera walk continues to read the real view.
const cameras = computed(() => {
  const at = returnCenter.value ?? center.value;
  if (catalogKey.value === 'off' || !at) return [];
  try {
    return cctv()?.camerasNear?.(at, { radiusKm: contextRadiusKm.value }) || [];
  } catch {
    return [];
  }
});
// Narrowed by Context's search.
const search = (camera) => !contextNeedle.value || matchesContextSearch(camera.name, camera.city, camera.provider);
const order = shallowRef([]);

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

function openCamera(camera) {
  returnCenter.value ??= center.value;
  if (!store.open({ layerId: 'cctv', id: String(camera.id), label: camera.name, lat: camera.lat, lon: camera.lon }))
    resetReturn();
}
</script>

<template>
  <ContextListCard
    v-if="catalogKey !== 'off'"
    id="cctv"
    header-close
    allow-unlisted
    :selected="selected"
    :back-title="t('Close card')"
    @back="store.clear({ dismiss: true })"
    :title="t('Cameras')"
    icon="videocam"
    :items="cameras"
    :item-key="(camera) => String(camera.id)"
    :filter="search"
    :query="contextNeedle"
    :return-revision="returnRevision"
    @release-order="discardCenter"
    :group-by="provider"
    @order="order = $event"
    @select="openCamera"
  >
    <template #detail><EntityCard embedded /></template>
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
