<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { useDockedStore } from '../../stores/docked.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { useStreetLevelStore } from '../../stores/streetLevel.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { placeStreetLevelViewer, returnStreetLevelViewerHome } from '../../streetLevelViewerPlacement.js';
import { streetPhotoCredit } from '../../streetPhotoCredit.js';

// A street-level photo's top image: the photo itself, moved in from the
// Street Level panel, with fit/fill and full screen on it. A card picked
// from Nearby or a pin opens its photo again, saying so while it loads and
// why when it cannot, with Retry; while Street Level is off, a pinned photo
// shows the last picture its pin kept, as a pinned camera does.
const props = defineProps({
  card: { type: Object, required: true },
});

const streetLevel = useStreetLevelStore();
const { view } = storeToRefs(streetLevel);
const cards = useEntityCardStore();
const { tick } = storeToRefs(cards);
const pinned = usePinnedStore();
const docked = useDockedStore();
const viewerSlot = ref(null);

const photoId = computed(() => props.card.identity?.id || '');
const open = computed(() =>
  !view.value?.dockPhotoUnavailable && view.value?.viewer.photo?.id === photoId.value,
);
const layerOn = computed(() => {
  void tick.value;
  return view.value?.enabled === true && !cards.layerOff('street-level');
});
const still = computed(() => {
  void tick.value;
  return pinned.stillOf(props.card.key) || cards.layerModule('street-level')?.photo?.(photoId.value)?.still || '';
});

// The still carries the photo's credit (its provider's, who took it, its
// licence) while it shows, as a pinned tile and the dock do; the open
// viewer's caption credits it otherwise.
const credit = computed(() => {
  void tick.value;
  return still.value ? streetPhotoCredit(cards.layerModule('street-level'), photoId.value) : '';
});

// This card's own request for its photo: 'loading', 'failed' or ''.
const request = ref('');
let requestSeq = 0;
async function openThisPhoto() {
  const seq = ++requestSeq;
  request.value = 'loading';
  const opened = await streetLevel.act('openPhoto', photoId.value);
  if (seq !== requestSeq) return;
  // null: a newer request took over, whose own state shows; not a failure.
  request.value = opened === false ? 'failed' : '';
}
// Retry unmounts its own button while the photo loads: focus waits on the
// hero, then goes to Retry again if the photo still cannot open.
const hero = ref(null);
async function retry() {
  hero.value?.focus({ preventScroll: true });
  await openThisPhoto();
  await nextTick();
  if (request.value !== 'failed' || !hero.value?.contains(document.activeElement)) return;
  hero.value.querySelector('.sl-hero__retry')?.focus({ preventScroll: true });
}
const failure = computed(() => (request.value === 'failed' ? view.value?.error || t('No imagery') : ''));

// A card picked from a list opens its photo; the photo's own announcement
// (entityContextBridge) picks the card it already shows, so nothing reopens.
watch(
  () => props.card.key,
  () => {
    requestSeq++;
    request.value = '';
    if (!layerOn.value || !photoId.value) return;
    if (!view.value?.dockPhotoUnavailable && view.value?.viewer.photo?.id === photoId.value) return;
    void openThisPhoto();
  },
  { immediate: true },
);

watch(
  open,
  (shown) => {
    if (!shown) returnStreetLevelViewerHome('sl-viewer-slot');
    void nextTick(placeStreetLevelViewer);
  },
  { immediate: true, flush: 'pre' },
);
// The slot goes with the card: the viewer goes home first, then to the dock
// if a photo is docked.
onBeforeUnmount(() => {
  requestSeq++;
  // The card's exit animation can leave its slot in the DOM after unmount.
  if (viewerSlot.value) viewerSlot.value.hidden = true;
  returnStreetLevelViewerHome('sl-viewer-slot');
  void nextTick(placeStreetLevelViewer);
});
</script>

<template>
  <div ref="hero" class="sl-hero" tabindex="-1">
    <div v-if="open" id="sl-viewer-slot" ref="viewerSlot" class="sl-hero__slot"></div>
    <div v-if="!open" class="sl-hero__still">
      <img v-if="still" :src="still" :alt="t('Street-level photo')" />
      <UiIcon v-else class="sl-hero__glyph" name="streetview" :size="null" />
      <p v-if="layerOn && request === 'loading'" class="sl-hero__state" role="status">{{ t('Loading photo...') }}</p>
      <div v-else-if="layerOn && failure" class="sl-hero__state" role="alert">
        <span>{{ failure }}</span>
        <UiButton class="sl-hero__retry" @click="retry">{{ t('Retry') }}</UiButton>
      </div>
      <div v-if="!layerOn || credit" class="sl-hero__foot">
        <span v-if="!layerOn" class="sl-hero__note">{{ t('Street Level off · last image') }}</span>
        <small v-if="credit" class="sl-hero__credit">{{ credit }}</small>
      </div>
    </div>
  </div>
</template>
