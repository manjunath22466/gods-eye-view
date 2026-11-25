<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
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
  shown: { type: Boolean, default: true },
});

const cctv = useCctvStore();
const { view, frame, sourceBadge, live, liveState } = storeToRefs(cctv);

const matchesActive = computed(() => !props.cameraId || view.value?.activeCameraId === props.cameraId);
const same = computed(() => matchesActive.value && (!props.cameraId || frame.value?.cameraId === props.cameraId));
const liveSrc = computed(() => (same.value ? frame.value?.src || (!live.value && frame.value?.currentSrc) || '' : ''));
const credit = computed(() => (same.value ? view.value?.activeCredit || '' : ''));
const unavailable = computed(() => {
  if (!view.value?.enabled || camerasOff.value) return false;
  if (!matchesActive.value || view.value.stillSuppressed) return true;
  return live.value && (!view.value.hasLiveSnapshot || (same.value && frame.value?.error));
});
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

const wantsCanvas = computed(() => Boolean(props.shown && live.value && props.cameraId && matchesActive.value && !camerasOff.value));
const videoHost = ref(null);
const hasCanvas = ref(false);
let borrowedHost = null;
function placeCanvas(show) {
  const doc = videoHost.value?.ownerDocument ?? borrowedHost?.ownerDocument;
  const canvas = doc?.getElementById('cctv-video') ?? borrowedHost?.querySelector('#cctv-video');
  const home = doc?.getElementById('cctv-frame-wrap');
  const next = show ? videoHost.value : null;
  if (!canvas || !home) {
    borrowedHost = null;
    hasCanvas.value = false;
    return;
  }
  const target = next || (borrowedHost && canvas.parentElement === borrowedHost ? home : null);
  if (target && canvas.parentElement !== target) {
    target.appendChild(canvas);
    doc.dispatchEvent(new CustomEvent(CCTV_VIDEO_HOST_EVENT));
  }
  borrowedHost = next;
  hasCanvas.value = Boolean(next && canvas.parentElement === next);
}
watch([wantsCanvas, videoHost], ([show]) => placeCanvas(show), { flush: 'post', immediate: true });
onBeforeUnmount(() => placeCanvas(false));

const liveWaiting = computed(() => hasCanvas.value && liveState.value !== 'playing' && liveState.value !== 'stalled');
const stillBadge = computed(() => {
  if (camerasOff.value) return lastStill.value ? t('Cameras off · last frame') : '';
  if (!matchesActive.value) return '';
  return live.value ? (src.value ? t('SNAPSHOT') : '') : sourceBadge.value?.label;
});
const inlineBadge = computed(() => hasCanvas.value ? sourceBadge.value?.label : stillBadge.value);
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
  const heading = pick(/^HDG/);
  // The feed's publisher and, for a partner-supplied feed, its owner: both
  // are credited on the card, and on any picture of it shown elsewhere.
  const id = props.cameraId;
  const dockedView = docked.view?.key === `cctv:${id}` ? docked.view : null;
  const source =
    (id && (cameraSource(cards.cameraDetails(id)) || cameraSource(pinOf(id)?.source) || cameraSource(dockedView?.source))) ||
    (same.value ? view.value?.source : null);
  return [
    { label: t('Heading'), value: heading && view.value?.activeHeadingEstimated ? t('~{n}', { n: heading }) : heading },
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
watch([big, () => props.cameraId], ([open, cameraId], _, onCleanup) => {
  if (!open) return;
  cctv.showPreviewPopup(cameraId, true);
  document.addEventListener('keydown', onKey, true);
  onCleanup(() => {
    cctv.showPreviewPopup(cameraId, false);
    document.removeEventListener('keydown', onKey, true);
  });
});
watch(() => props.shown ? props.cameraId : '', (cameraId, _, onCleanup) => {
  if (!cameraId) return;
  cctv.showPreviewCard(cameraId, true);
  onCleanup(() => cctv.showPreviewCard(cameraId, false));
}, { immediate: true });

</script>

<template>
  <section class="cctv-preview">
    <div class="cctv-preview__frame" :class="{ 'is-empty': !src && !hasCanvas }">
      <div v-if="wantsCanvas" v-show="hasCanvas" ref="videoHost" class="cctv-preview__video" role="img" :aria-label="liveName"></div>
      <img v-if="src && !hasCanvas" :src="src" :alt="name || t('Camera frame')" />
      <span v-if="liveWaiting || (!hasCanvas && !src)" class="cctv-preview__wait">{{
        camerasOff ? t('Cameras off') : unavailable && !hasCanvas ? t('FRAME · UNAVAILABLE') : t('Acquiring frame…')
      }}</span>
      <PausedChip v-if="lastStill" :reason="stillBadge" />
      <span v-else-if="inlineBadge" class="cctv-preview__badge">{{ inlineBadge }}</span>
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
            <span v-if="stillBadge" class="cctv-popup__badge">{{ stillBadge }}</span>
            <UiCloseButton class="cctv-popup__close" glyph="icon" :label="t('Close')" @click="big = false" />
          </header>
          <img v-if="src" :src="src" :alt="name || t('Camera frame')" />
          <small v-if="credit" class="cctv-popup__credit">{{ credit }}</small>
          <figcaption v-if="unavailable && !src">{{ t('FRAME · UNAVAILABLE') }}</figcaption>
          <figcaption v-else-if="facts.length">
            <span v-for="fact in facts" :key="fact.label">{{ fact.label }} <b>{{ fact.value }}</b></span>
          </figcaption>
        </figure>
      </div>
    </Teleport>
  </section>
</template>
