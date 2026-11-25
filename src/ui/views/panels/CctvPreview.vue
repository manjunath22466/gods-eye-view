<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useCctvStore } from '../../stores/cctv.js';
import { CCTV_VIDEO_HOST_EVENT } from '../../cctvEvents.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { useDockedStore } from '../../stores/docked.js';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import PausedChip from './PausedChip.vue';
import { cameraSource } from '../../cameraCredit.js';

// A picked camera's top image: its latest frame, with a bigger view on click,
// or its live video. The frame comes from the camera store, which follows the
// active camera; a live video draws into the one canvas CctvControls owns,
// which moves in here from its hidden home while this camera shows.

const props = defineProps({
  /** The camera's id (the card identity's id). */
  cameraId: { type: String, default: '' },
});

const cctv = useCctvStore();
const { view, frame, sourceBadge, live, liveState } = storeToRefs(cctv);

// The live video's canvas, held once found: moved in while this camera's
// video plays, and back to its home (#cctv-frame-wrap) after.
const liveHere = computed(() => Boolean(live.value && props.cameraId && view.value?.activeCameraId === props.cameraId));
const videoHost = ref(null);
let canvas = null;
let canvasHome = null;
function placeCanvas(show) {
  canvas ??= globalThis.document?.getElementById('cctv-video') ?? null;
  // A fixed home, never wherever the canvas happens to be.
  canvasHome ??= globalThis.document?.getElementById('cctv-frame-wrap') ?? null;
  if (!canvas || !canvasHome) return;
  const target = show && videoHost.value ? videoHost.value : canvasHome;
  if (canvas.parentElement === target) return;
  target.appendChild(canvas);
  globalThis.document.dispatchEvent(new CustomEvent(CCTV_VIDEO_HOST_EVENT));
}
// The host exists only once rendered: a card that opens on a camera already
// live moves the canvas in when its host appears, not before.
watch([liveHere, videoHost], ([show]) => placeCanvas(show), { flush: 'post', immediate: true });
// Until the canvas draws its first frame it says so, rather than a black box.
const liveWaiting = computed(() => liveHere.value && liveState.value !== 'playing' && liveState.value !== 'stalled');
onBeforeUnmount(() => placeCanvas(false));

const same = computed(() => !props.cameraId || frame.value?.cameraId === props.cameraId);
const liveSrc = computed(() => (same.value ? frame.value?.src || frame.value?.currentSrc || '' : ''));
// A camera opened while Cameras is off (from a pin or the dock) has no feed:
// it shows the last still its pin or the dock kept, said to be the last
// frame, rather than a frame passed off as live or waiting forever.
const cards = useEntityCardStore();
const pinned = usePinnedStore();
const docked = useDockedStore();
const camerasOff = computed(() => cards.layerOff('cctv'));
const pinOf = (id) => pinned.pins.find((entry) => entry.kind === 'camera' && entry.identity?.id === id) || null;
const lastStill = computed(() => {
  if (!camerasOff.value || !props.cameraId) return '';
  const pin = cards.fromPin ? pinOf(props.cameraId) : null;
  return (pin && pinned.stillOf(pin.key)) || docked.lastStillOf(`cctv:${props.cameraId}`);
});
const src = computed(() => (camerasOff.value ? lastStill.value : liveSrc.value));
const params = computed(() => {
  try {
    return new URL(src.value, location.origin).searchParams;
  } catch {
    return new URLSearchParams();
  }
});
const name = computed(() => params.value.get('label') || '');
// The live video is named for its camera, as the still it replaces is.
const liveName = computed(() => {
  const id = props.cameraId;
  const option = cctv.picker?.options?.find((entry) => entry.value === id)?.label;
  const card = cards.card?.layerId === 'cctv' && String(cards.card.identity?.id) === id ? cards.card.title : '';
  return name.value || option || card || t('Camera view');
});
// The panel's meta line, e.g. "US-290 · HDG 248° · FOV 44° · RANGE 145m · … · TxDOT · …".
const facts = computed(() => {
  // The panel's line belongs to the camera it shows, which may be another.
  const parts = String(same.value ? view.value?.meta || '' : '')
    .split(' · ')
    .map((p) => p.trim())
    .filter(Boolean);
  const pick = (re) => parts.find((p) => re.test(p))?.replace(/^(HDG|FOV|RANGE)\s*/, '') || '';
  // The feed's publisher and, for a partner-supplied feed, its owner: both
  // are credited on the card, and on any picture of it shown elsewhere.
  const id = props.cameraId;
  const dockedView = docked.view?.key === `cctv:${id}` ? docked.view : null;
  const source =
    (id && (cameraSource(cards.cameraDetails(id)) || cameraSource(pinOf(id)?.source) || cameraSource(dockedView?.source))) ||
    (same.value ? view.value?.source : null);
  return [
    { label: t('Heading'), value: pick(/^HDG/) },
    { label: t('Field of view'), value: pick(/^FOV/) },
    { label: t('Range'), value: pick(/^RANGE/) },
    { label: t('Source'), value: source?.provider || '' },
    {
      label: t('Operator'),
      value: source?.credit || parts.find((p) => /DOT|Transportation|Works|City|County/i.test(p)) || '',
    },
  ].filter((f) => f.value);
});

// The bigger view: a popup over the map with the same frame, closed by its
// ×, Esc or a click outside. While it is open its Esc is its own (it is
// marked data-owns-escape): caught on the way down at the document, before
// Context, the map or a panel can act on it, and stopped there, so one Esc
// closes the popup and does nothing else.
const big = ref(false);
const onKey = (e) => {
  if (e.key !== 'Escape' || e.isComposing) return;
  e.preventDefault();
  e.stopPropagation();
  big.value = false;
};
// The cleanup also runs when the card unmounts, even if `big` turned false in
// the same tick and the watcher never saw it.
watch(big, (open, _, onCleanup) => {
  if (!open) return;
  cctv.showPreviewPopup(true);
  document.addEventListener('keydown', onKey, true);
  onCleanup(() => {
    cctv.showPreviewPopup(false);
    document.removeEventListener('keydown', onKey, true);
  });
});
onMounted(() => cctv.showPreviewCard(true));
onBeforeUnmount(() => cctv.showPreviewCard(false));

</script>

<template>
  <section class="cctv-preview">
    <div class="cctv-preview__frame" :class="{ 'is-empty': !src && !liveHere }">
      <div v-if="liveHere" ref="videoHost" class="cctv-preview__video" role="img" :aria-label="liveName"></div>
      <img v-else-if="src" :src="src" :alt="name || t('Camera frame')" />
      <span v-if="liveWaiting || (!liveHere && !src)" class="cctv-preview__wait">{{
        !liveHere && cards.layerOff('cctv') ? t('Cameras off') : t('Acquiring frame…')
      }}</span>
      <PausedChip v-if="lastStill" :reason="t('Cameras off · last frame')" />
      <span v-else-if="sourceBadge?.label" class="cctv-preview__badge">{{ sourceBadge.label }}</span>
      <UiButton v-if="src" class="cctv-preview__expand" :label="t('Show a bigger view')" @click="big = true">
        <UiIcon name="open_in_full" :size="null" />
      </UiButton>
    </div>
    <Teleport to="body">
      <div v-if="big" class="cctv-popup" role="dialog" data-owns-escape :aria-label="name || t('Camera view')" @click.self="big = false">
        <figure class="cctv-popup__card">
          <header class="cctv-popup__head">
            <UiIcon name="videocam" :size="null" />
            <strong>{{ name || t('Camera view') }}</strong>
            <span v-if="sourceBadge?.label" class="cctv-popup__badge">{{ sourceBadge.label }}</span>
            <UiCloseButton class="cctv-popup__close" glyph="icon" :label="t('Close')" @click="big = false" />
          </header>
          <img :src="src" :alt="name || t('Camera frame')" />
          <figcaption v-if="facts.length">
            <span v-for="fact in facts" :key="fact.label">{{ fact.label }} <b>{{ fact.value }}</b></span>
          </figcaption>
        </figure>
      </div>
    </Teleport>
  </section>
</template>
