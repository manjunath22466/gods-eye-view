<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { formatNumber, t, tn } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { usePanelChromeStore } from '../../stores/panelChrome.js';
import { contextRadiusKm } from '../../contextRadius.js';
import { contextNeedle, matchesContextSearch } from '../../contextSearch.js';
import { leaveContextLists, setContextListPresence } from '../../contextLists.js';
import { distanceText } from '../../distanceText.js';
import UiButton from '../../kit/UiButton.vue';

// Context's Cameras list: every loaded camera within Context's radius of the
// centre of the view, nearest first, in the order Nearby lists them and
// Prev/Next on the Data Layers row steps through them (the layer's
// camerasNear). It stays in the page while Cameras is on, so its tab shows
// with its count; a row opens the camera's card on Inspect. Rows show a page
// at a time.
const PAGE = 50;

const store = useEntityCardStore();
const chrome = usePanelChromeStore();

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
const matching = computed(() =>
  contextNeedle.value ? cameras.value.filter((camera) => matchesContextSearch(camera.name, camera.city, camera.provider)) : cameras.value,
);

// The tab, with the count Nearby's Cameras group shows, while Cameras is on.
watch(
  [catalogKey, cameras],
  ([key, list]) => setContextListPresence('cctv', key === 'off' ? null : { count: center.value ? list.length : null }),
  { immediate: true },
);
// Prev/Next walk this list while Context is open; with Context closed its
// centre is not kept up to date, so they walk the cameras nearest the view.
watch(
  [catalogKey, center, contextRadiusKm, contextOpen],
  ([key, at, radiusKm, open]) => {
    try {
      cctv()?.setNearbyArea?.(key !== 'off' && open && at ? { ...at, radiusKm } : null);
    } catch {
      // The walk then goes by the view.
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  setContextListPresence('cctv', null);
  try {
    cctv()?.setNearbyArea?.(null);
  } catch {
    // Nothing to let go of.
  }
});

const shownCount = ref(PAGE);
watch([center, contextRadiusKm, contextNeedle], () => (shownCount.value = PAGE));
const rows = computed(() => matching.value.slice(0, shownCount.value));
const remaining = computed(() => matching.value.length - rows.value.length);
const more = computed(() => Math.min(PAGE, remaining.value));

const radiusText = computed(() => t('{n} km', { n: formatNumber(contextRadiusKm.value) }));
const detail = (camera) => [camera.city, camera.provider].filter(Boolean).join(' · ');

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
  <div class="camera-list nearby-lists" :aria-label="t('Cameras')" role="region">
    <p v-if="!rows.length" class="camera-list__empty">
      {{ contextNeedle && cameras.length ? t('No cameras here match the search') : t('No cameras within {radius} of the view centre', { radius: radiusText }) }}
    </p>
    <ul v-else>
      <li v-for="(camera, index) in rows" :key="camera.id" :class="{ 'nearby-lists__row--nearest': index === 0 }">
        <UiButton @click="openCamera(camera, $event)">
          <span class="camera-list__text">
            <span class="nearby-lists__name" :title="camera.name">{{ camera.name || camera.id }}</span>
            <span v-if="detail(camera)" class="camera-list__detail" :title="detail(camera)">{{ detail(camera) }}</span>
          </span>
          <span class="nearby-lists__meta">{{ distanceText(camera.km) }}</span>
        </UiButton>
      </li>
    </ul>
    <UiButton v-if="remaining > 0" class="camera-list__more" @click="shownCount += PAGE">
      {{ tn(more, 'Show {count} more camera', 'Show {count} more cameras', { count: formatNumber(more) }) }}
    </UiButton>
  </div>
</template>
