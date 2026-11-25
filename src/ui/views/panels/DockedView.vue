<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { msg, t } from '../../../i18n/index.js';
import { useDockedStore } from '../../stores/docked.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { useStreetLevelStore } from '../../stores/streetLevel.js';
import { useCctvStore } from '../../stores/cctv.js';
import { useDockedCamera } from '../../dockedCamera.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { streetPhotoCredit } from '../../streetPhotoCredit.js';
import { cameraCredit } from '../../cameraCredit.js';
import { ESRI_IMAGERY_CREDIT } from '../../../maps/attribution.js';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import FeedDot from './FeedDot.vue';
import PausedChip from './PausedChip.vue';
import { placeStreetLevelViewer, returnStreetLevelViewerHome } from '../../streetLevelViewerPlacement.js';
import FlightCockpitView from './FlightCockpitView.vue';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';
import UiIcon from '../../kit/UiIcon.vue';

// The docked view: one live view kept on screen bottom right,
// directly above the radio mini player, while Context inspects other things.
// A camera's frame refreshes on its own interval; a flight's cockpit view
// moves with the flight. ⤢ opens it again in Context; ✕ closes the dock.
const docked = useDockedStore();
// Stowed while Context is the full-height column over the corner: hidden
// and paused, live again once Context shrinks or folds.
const { view, stowed } = storeToRefs(docked);
const cards = useEntityCardStore();

// Cockpit, clean view and recording put the whole corner away (entity-card.css):
// the dock pauses as it does when stowed, and starts again when they end.
const CORNER_HIDING_MODES = ['cockpit-mode', 'ui-clean-view', 'recording-mode'];
const body = globalThis.document?.body;
const cornerHidden = () => CORNER_HIDING_MODES.some((mode) => body?.classList?.contains(mode));
const modeHidden = ref(cornerHidden());
// A background tab reads nothing either; it reads once on return.
const pageHidden = ref(Boolean(globalThis.document?.hidden));
const onVisibility = () => (pageHidden.value = Boolean(globalThis.document?.hidden));
// Watched only once mounted, so a render that never mounts (the page's
// server-side render) leaves no observer or listener behind.
let bodyWatch = null;
onMounted(() => {
  modeHidden.value = cornerHidden();
  pageHidden.value = Boolean(globalThis.document?.hidden);
  if (body && globalThis.MutationObserver) {
    bodyWatch = new MutationObserver(() => (modeHidden.value = cornerHidden()));
    bodyWatch.observe(body, { attributes: true, attributeFilter: ['class'] });
  }
  globalThis.document?.addEventListener?.('visibilitychange', onVisibility);
});
onBeforeUnmount(() => {
  bodyWatch?.disconnect();
  bodyWatch = null;
  globalThis.document?.removeEventListener?.('visibilitychange', onVisibility);
});
// Not on screen: no stream of its own, no painting and no reads.
const away = computed(() => stowed.value || modeHidden.value || pageHidden.value);

// It reads again every 2 s, and only while something is docked and shown;
// shown again, it reads at once.
const tick = ref(0);
let timer = 0;
watch(
  () => Boolean(view.value) && !away.value,
  (running, wasRunning) => {
    clearInterval(timer);
    timer = running ? setInterval(() => tick.value++, 2000) : 0;
    if (running && wasRunning === false) tick.value++;
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));

// Whether the docked view's layer is off. Docking is "keep this on screen":
// a docked camera keeps its one feed, the only thing from that layer still
// live (its pin shows the same, below). A cockpit view needs its layer's
// live record, so it pauses on its last view.
const layerOff = computed(() => {
  void tick.value;
  return Boolean(view.value && cards.layerOff(view.value.identity.layerId));
});

// A docked camera's picture and how live it is (dockedCamera.js): a video
// camera keeps playing its own stream, shared with the map while Cameras is
// on and held by the dock after; a still camera is live only over a loaded,
// real frame.
const pinned = usePinnedStore();
const { frame: activeFrame, live: cctvLive, view: cctvView } = storeToRefs(useCctvStore());
const { canvas: streamCanvas, streamOn, still, stillLoaded, stillFailed: fail, feed: cameraFeed, pictured: cameraPictured } = useDockedCamera({
  view,
  tick,
  cards,
  docked,
  pinned,
  activeFrame,
  cctvLive,
  cctvView,
  suspended: away,
});

// A docked flight's live position, for its cockpit view. A read that misses
// it (a feed refresh) keeps the last position, so the view is not torn down
// and rebuilt; three misses in a row (about 6 s) and it is out of feed.
const MISSES_OUT = 3;
const craft = ref(null);
let misses = 0;
watch(
  [tick, () => view.value?.key],
  ([, key], [, wasKey]) => {
    const current = view.value;
    if (key !== wasKey) {
      craft.value = null;
      misses = 0;
    }
    if (current?.kind !== 'cockpit') {
      craft.value = null;
      return;
    }
    if (layerOff.value) {
      craft.value = null;
      return;
    }
    const found = cards.describe(current.identity);
    if (Number.isFinite(found?.lat) && Number.isFinite(found?.lon)) {
      misses = 0;
      craft.value = found;
    } else if (++misses >= MISSES_OUT) craft.value = null;
  },
  { immediate: true },
);
// The mark beside the docked view's name: a flight's sprite by its class,
// read from its live card (the default airliner until that is read).
const dockMark = computed(() => markKind(view.value?.identity?.layerId, craft.value));
const cockpitFailed = ref(false);
watch(
  () => view.value?.key,
  () => (cockpitFailed.value = false),
);

// Its buttons go with it, so focus moves to Context's body rather than
// falling back to the page; while Context is folded its body is hidden, so
// focus goes to Context's fold button.
function focusContext() {
  void nextTick(() => {
    if (body?.classList.contains('mobile-shell') && body.dataset.mobileSheet !== 'context') {
      const tabs = document.getElementById('mobile-tab-bar');
      (tabs?.querySelector('button[aria-expanded="true"]') ?? tabs?.querySelector('button'))?.focus({ preventScroll: true });
      return;
    }
    const panel = document.getElementById('global-context-panel');
    const folded = panel?.classList.contains('collapsed') || panel?.classList.contains('ui-panel--collapsed');
    const target = folded
      ? panel.querySelector('.panel-collapse-btn[data-collapse-target="global-context-panel"]')
      : panel?.querySelector('.cyber-panel-body');
    target?.focus?.({ preventScroll: true });
  });
}
// ⤢ opens the view's card in Context. With its layer off it opens as a pin
// does: the card stays, with what it showed last, and the layer stays off.
// The dock closes only once the card is there; otherwise it stays and says so.
const notice = ref('');
watch(
  () => view.value?.key,
  () => (notice.value = ''),
);
async function reopen() {
  const current = view.value;
  if (!current) return;
  const opened = cards.open(current.identity, { fromPin: cards.layerOff(current.identity.layerId) });
  await nextTick();
  if (view.value?.key !== current.key) return;
  const shown = cards.card;
  const sheetHidden = body?.classList.contains('mobile-shell') && body.dataset.mobileSheet !== 'context';
  if (!opened || sheetHidden || shown?.layerId !== current.identity.layerId ||
      shown?.identity?.id !== String(current.identity.id) || !document.getElementById('entity-card')) {
    notice.value = t('Could not open this in Context');
    return;
  }
  docked.close();
  focusContext();
}
function closeDock() {
  // A docked photo whose card is not showing closes with the dock (below).
  docked.close();
  focusContext();
}
// A docked street photo stays in the dock even while its own card is
// selected; Show here returns it to that card (streetLevelViewerPlacement.js).
// While Street Level is off, or the photo has closed, the dock keeps the
// last picture it had.
const streetLevel = useStreetLevelStore();
const { view: streetView } = storeToRefs(streetLevel);
const streetLoading = computed(() => view.value?.kind === 'street' && streetView.value?.dockPhotoLoading === true);
// After a replacement failed or was cancelled the layer reloads the original
// (up to 4 s): there is nothing left to cancel, so the dock just says so.
const streetRestoring = computed(() => streetLoading.value && streetView.value?.dockPhotoRestoring === true);
const cancelOffered = computed(() => streetLoading.value && !streetRestoring.value);
const streetUnavailable = computed(() =>
  view.value?.kind === 'street' &&
  streetView.value?.dockPhotoUnavailable === true &&
  !streetLoading.value,
);
// Open and Close are disabled while a photo loads: focus on either moves to
// Cancel, and from Cancel back to Close once it ends, rather than to the page.
// While the original restores Cancel goes too, so focus waits on the frame.
const openButton = ref(null);
const closeButton = ref(null);
const cancelButton = ref(null);
const frameElement = ref(null);
const streetSlotElement = ref(null);
const elementOf = (button) => button.value?.$el ?? button.value ?? null;
watch(
  [streetLoading, cancelOffered],
  ([loading, cancellable]) => {
    const active = globalThis.document?.activeElement;
    const [open, close, cancel, frame] = [openButton, closeButton, cancelButton, frameElement].map(elementOf);
    const [from, to] = !loading
      ? [[cancel, frame], closeButton]
      : cancellable
        ? [[open, close, frame], cancelButton]
        : [[open, close, cancel], frameElement];
    const covered = loading && streetSlotElement.value?.contains(active);
    if (!active || (!from.includes(active) && !covered)) return;
    void nextTick(() => elementOf(to)?.focus?.({ preventScroll: true }));
  },
  { flush: 'pre' },
);
const streetOpen = computed(() => {
  const viewer = streetView.value?.viewer;
  return view.value?.kind === 'street' && !streetView.value?.dockPhotoUnavailable &&
    viewer?.open === true && viewer.photo?.id === view.value.identity.id;
});
const streetStill = computed(() => {
  void tick.value;
  const current = view.value;
  return current?.kind === 'street' ? cards.layerModule('street-level')?.photo?.(current.identity.id)?.still || '' : '';
});
const failedStreetStill = ref('');
watch([streetStill, streetLoading], () => (failedStreetStill.value = ''));
function onStreetStillError(event) {
  failedStreetStill.value = event.currentTarget.getAttribute('src') ?? '';
}
const streetError = computed(() =>
  streetUnavailable.value &&
  (!streetStill.value || failedStreetStill.value === streetStill.value),
);
// A replacement that did not show, or a pick refused while the original
// reloads: the layer keeps the word for a few seconds (streetLevel/index.js).
const STREET_NOTICES = { failed: msg('Could not load that photo'), restoring: msg('Still restoring the photo') };
const streetStatus = computed(() => {
  if (streetError.value) return '';
  const notice = view.value?.kind === 'street' && STREET_NOTICES[streetView.value?.dockPhotoNotice];
  if (notice) return t(notice);
  if (streetRestoring.value) return t(STREET_NOTICES.restoring);
  return streetLoading.value ? t('Loading photo...') : '';
});
// The photo stays here while docked: its own card shows a Docked bar instead
// (EntityPreview.vue), so it is never shown twice.
// Stowed, the photo goes home rather than wait in a hidden dock.
const streetSlot = computed(() => (streetOpen.value || streetLoading.value) && !stowed.value);
// A docked street photo carries its provider's credit while its picture
// shows, its card's caption being elsewhere.
const streetCredit = computed(() => {
  void tick.value;
  const current = view.value;
  if (current?.kind !== 'street' || streetError.value || !(streetSlot.value || streetStill.value)) return '';
  return streetPhotoCredit(cards.layerModule('street-level'), current.identity.id);
});
// Every docked picture is credited under it while it shows: a camera with
// its provider and a partner feed's owner, as its card's source line has
// them; a cockpit view with Esri's imagery credit.
const credit = computed(() => {
  void tick.value;
  const current = view.value;
  if (current?.kind === 'street') return streetCredit.value;
  if (current?.kind === 'camera')
    return streamOn.value || still.value ? cameraCredit(cards.cameraDetails(current.identity.id), current.source) : '';
  return current?.kind === 'cockpit' && craft.value && !cockpitFailed.value ? ESRI_IMAGERY_CREDIT : '';
});
// Before the slot goes, the photo leaves it; then it goes where it belongs.
watch(
  streetSlot,
  (shown) => {
    if (!shown) returnStreetLevelViewerHome('sl-docked-slot');
    void nextTick(placeStreetLevelViewer);
  },
  { immediate: true, flush: 'pre' },
);
// A docked photo another item replaces closes, unless its card shows it; out
// of sight (stowed, Cockpit, clean view, recording), its sequence stops.
watch(
  () => view.value,
  (current, previous) => {
    if (previous?.kind !== 'street' || current?.key === previous.key) return;
    if (streetView.value?.dockPhotoLoading) streetLevel.act('cancelDockedPhoto');
    if (cards.card?.key !== previous.key) streetLevel.act('closePhoto', previous.identity.id);
  },
);
watch(
  () => away.value && view.value?.kind === 'street',
  (hidden) => {
    if (!hidden) return;
    if (streetLoading.value) streetLevel.act('cancelDockedPhoto');
    streetLevel.act('stopPlayback');
  },
);
onBeforeUnmount(() => {
  returnStreetLevelViewerHome('sl-docked-slot');
  void nextTick(placeStreetLevelViewer);
});

// A camera stays live with its layer off; a photo or a cockpit view pauses.
const paused = computed(() => layerOff.value && view.value?.kind !== 'camera');
const live = computed(() => {
  if (paused.value) return false;
  if (view.value?.kind === 'street') return streetOpen.value;
  if (view.value?.kind === 'camera') return cameraFeed.value === 'live';
  return Boolean(craft.value) && !cockpitFailed.value;
});
// A camera says "live" only over a moving or freshly loaded picture: loading,
// stalled, paused on its last frame, or a failed frame say so instead.
const CAMERA_DOTS = { live: 'live', loading: 'loading', stalled: 'paused', paused: 'paused' };
const CAMERA_TAGS = {
  live: msg('Docked · live'),
  loading: msg('Docked · loading'),
  stalled: msg('Docked · stalled'),
  paused: msg('Docked · paused'),
  failed: msg('Docked · frame unavailable'),
};
const dotState = computed(() => {
  if (away.value) return 'paused';
  if (streetLoading.value) return 'loading';
  if (view.value?.kind === 'camera') return CAMERA_DOTS[cameraFeed.value] || 'lost';
  return live.value ? 'live' : paused.value ? 'paused' : 'lost';
});
const waitText = computed(() => {
  if (view.value?.kind === 'street') return paused.value ? t('Street Level off · last image') : t('Out of feed');
  if (paused.value) return t('Layer off');
  if (view.value?.kind === 'cockpit') return cockpitFailed.value ? t('Cockpit view unavailable') : t('Out of feed');
  if (cameraFeed.value === 'loading') return t('Acquiring frame…');
  if (cameraFeed.value === 'failed') return t('Frame unavailable');
  return t('Out of feed');
});
const OFF_REASONS = { street: msg('Street Level off · last image'), cockpit: msg('Layer off') };
const pausedReason = computed(() => t(OFF_REASONS[view.value?.kind] || OFF_REASONS.cockpit));
const tag = computed(() => {
  if (away.value) return t('Docked · paused');
  if (streetLoading.value) return t(CAMERA_TAGS.loading);
  if (view.value?.kind === 'camera') return t(CAMERA_TAGS[cameraFeed.value] || 'Docked · out of feed');
  return live.value ? t('Docked · live') : t('Docked · out of feed');
});
// What the dock shows, published for the docked item's pin and card, so
// they show the same state (stores/docked.js).
watch(
  [() => view.value?.key, dotState, () => (paused.value ? pausedReason.value : tag.value)],
  ([key, dot, text]) => key && docked.setFeed(key, dot, text),
  { immediate: true },
);
</script>

<template>
  <section v-if="view" v-show="!stowed" class="docked-view" :data-kind="view.kind" :aria-label="t('Docked: {name}', { name: view.title })">
    <header class="docked-view__head">
      <FeedDot :state="dotState" />
      <EntityMark :layer="view.identity.layerId" :kind="dockMark" :icon="view.kind === 'street' ? 'streetview' : view.kind === 'camera' ? 'videocam' : 'flight'" :size="15" />
      <strong>{{ view.title }}</strong>
      <UiButton ref="openButton" :aria-label="t('Open {name} in Context', { name: view.title })" :title="t('Open in Context')" :disabled="streetLoading" @click="reopen">
        <UiIcon name="open_in_full" :size="null" />
      </UiButton>
      <UiCloseButton ref="closeButton" glyph="icon" :label="t('Close the docked view')" :title="t('Close')" :disabled="streetLoading" @click="closeDock" />
    </header>
    <span class="docked-view__status" role="status">{{ streetStatus }}</span>
    <div ref="frameElement" class="docked-view__frame" :aria-busy="streetLoading ? 'true' : undefined" :tabindex="streetRestoring ? -1 : undefined">
      <canvas v-if="view.kind === 'camera' && streamOn" ref="streamCanvas" class="docked-view__stream" role="img" :aria-label="view.title"></canvas>
      <img v-else-if="view.kind === 'camera' && still" v-show="cameraPictured" :src="still" :alt="view.title" @load="stillLoaded" @error="fail" />
      <div v-else-if="streetSlot" id="sl-docked-slot" ref="streetSlotElement" class="docked-view__street" :inert="streetLoading"></div>
      <span v-else-if="streetError" class="docked-view__wait" role="alert">{{ t('Image could not be opened') }}</span>
      <img
        v-else-if="view.kind === 'street' && streetStill"
        :key="streetStill"
        :src="streetStill"
        :alt="view.title"
        @error.self="onStreetStillError"
      />
      <FlightCockpitView
        v-else-if="view.kind === 'cockpit' && craft && !cockpitFailed"
        class="docked-view__cockpit"
        :active="!away"
        :lat="craft.lat"
        :lon="craft.lon"
        :altitude-m="craft.altitudeM"
        :heading="craft.heading"
        :speed-mps="craft.speedMps"
        @failed="cockpitFailed = true"
      />
      <span v-else class="docked-view__wait">{{ waitText }}</span>
      <span v-if="view.kind === 'camera' && (streamOn || still) && !cameraPictured" class="docked-view__wait">{{ waitText }}</span>
      <div v-if="streetLoading" class="docked-view__loading">
        <span aria-hidden="true">{{ streetRestoring ? t(STREET_NOTICES.restoring) : t('Loading photo...') }}</span>
        <UiButton v-if="cancelOffered" ref="cancelButton" class="docked-view__cancel-photo" @click="streetLevel.act('cancelDockedPhoto')">{{ t('Cancel') }}</UiButton>
      </div>
      <PausedChip v-else-if="paused" :reason="pausedReason" />
      <span v-else class="docked-view__tag" :data-feed="view.kind === 'camera' ? cameraFeed : undefined">{{ tag }}</span>
      <p v-if="streetStatus && !streetLoading" class="docked-view__notice" aria-hidden="true">{{ streetStatus }}</p>
      <p v-else-if="notice" class="docked-view__notice" role="status">{{ notice }}</p>
    </div>
    <p v-if="credit" class="docked-view__credit">{{ credit }}</p>
  </section>
</template>
