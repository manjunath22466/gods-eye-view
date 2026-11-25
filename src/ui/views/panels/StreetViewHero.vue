<script setup>
import { STREET_LEVEL_LAYER } from '../../streetLevelEvents.js';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { useStreetLevelStore } from '../../stores/streetLevel.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { isStreetViewerExpanded, placeStreetLevelViewer, returnStreetLevelViewerHome } from '../../streetLevelViewerPlacement.js';
import { streetPhotoCredit } from '../../streetPhotoCredit.js';

// The accepted photo uses the persistent viewer from Context's home. A
// selected Nearby row opens its photo; failures stay with the row for Retry.
const props = defineProps({
  card: { type: Object, required: true },
});

const streetLevel = useStreetLevelStore();
const { view, expanded } = storeToRefs(streetLevel);
const cards = useEntityCardStore();
const { tick } = storeToRefs(cards);
const viewerSlot = ref(null);

const photoId = computed(() => props.card.identity?.id || '');
const open = computed(() => view.value?.viewer.photo?.id === photoId.value);
const layerOn = computed(() => {
  void tick.value;
  return view.value?.enabled === true && !cards.layerOff(STREET_LEVEL_LAYER);
});
const providerOn = computed(() => {
  const id = photoId.value.replace(/^near:/, '').split(':')[0];
  const providers = view.value?.providers;
  return !providers || providers.some((provider) => provider.id === id && provider.active);
});
const brokenStill = ref('');
function rejectStill(event) {
  brokenStill.value = event.currentTarget.getAttribute('src');
}
const still = computed(() => {
  void tick.value;
  const url = cards.layerModule(STREET_LEVEL_LAYER)?.photo?.(photoId.value)?.still;
  return layerOn.value && url && url !== brokenStill.value ? url : '';
});

// The still carries the photo's credit (its provider's, who took it, its
// licence) while it shows; the open viewer's caption credits it otherwise.
const credit = computed(() => {
  void tick.value;
  return still.value ? streetPhotoCredit(cards.layerModule(STREET_LEVEL_LAYER), photoId.value) : '';
});

// Keep this card's request failure separate from a later provider message.
const request = ref('');
const failure = ref('');
let requestSeq = 0;
async function openThisPhoto() {
  const seq = ++requestSeq;
  request.value = 'loading';
  failure.value = '';
  const opened = await streetLevel.act('openPhoto', photoId.value);
  if (seq !== requestSeq) return;
  if (opened || open.value) {
    request.value = '';
    return;
  }
  request.value = 'failed';
  // A superseded request cannot use the error from the lookup that took over.
  failure.value = opened === null ? t('Photo unavailable') : view.value?.error || t('No imagery');
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

// A card picked from a list opens its photo; the photo's own announcement
// (entityContextBridge) picks the card it already shows, so nothing reopens.
watch(
  [() => props.card.key, providerOn],
  () => {
    requestSeq++;
    request.value = '';
    failure.value = '';
    brokenStill.value = '';
    if (!layerOn.value || !photoId.value) return;
    if (!providerOn.value) {
      if (cards.card?.key === props.card.key) cards.clear();
      return;
    }
    if (open.value) return;
    void openThisPhoto();
  },
  { immediate: true },
);

watch(
  open,
  (shown, wasShown) => {
    if (!shown) {
      returnStreetLevelViewerHome();
      if (wasShown && !request.value && providerOn.value && layerOn.value) {
        request.value = 'lost';
        failure.value = t('No imagery');
      }
    } else {
      request.value = '';
      failure.value = '';
    }
    void nextTick(placeStreetLevelViewer);
  },
  { immediate: true, flush: 'pre' },
);
watch(view, () => {
  if (request.value !== 'lost') return;
  const ui = cards.layerModule(STREET_LEVEL_LAYER)?.getUIState?.()?.street;
  if (ui?.error && `${ui.providerId}:${ui.imageId}` === photoId.value) {
    failure.value = view.value.error || failure.value;
    request.value = 'failed';
  }
});
// Keep the slot attached throughout fullscreen transitions, even when a
// panorama step temporarily has no accepted frame.
const keepSlot = computed(() => open.value || (expanded.value && isStreetViewerExpanded(viewerSlot.value?.firstElementChild)));
// The slot goes with the card: the viewer goes back to its home.
onBeforeUnmount(() => {
  requestSeq++;
  // The card's exit animation can leave its slot in the DOM after unmount.
  if (viewerSlot.value) viewerSlot.value.hidden = true;
  returnStreetLevelViewerHome();
  void nextTick(placeStreetLevelViewer);
});
</script>

<template>
  <div ref="hero" class="sl-hero" tabindex="-1">
    <div v-if="keepSlot" id="sl-viewer-slot" ref="viewerSlot" class="sl-hero__slot"></div>
    <div v-if="!keepSlot" class="sl-hero__still">
      <img v-if="still" :src="still" :alt="t('Street-level photo')" referrerpolicy="no-referrer" v-on="{ error: rejectStill }" />
      <UiIcon v-else class="sl-hero__glyph" name="streetview" :size="null" />
      <p v-if="layerOn && request === 'loading'" class="sl-hero__state" role="status">{{ t('Loading photo...') }}</p>
      <div v-else-if="layerOn && failure" class="sl-hero__state" role="alert">
        <span>{{ failure }}</span>
        <UiButton class="sl-hero__retry" @click="retry">{{ t('Retry') }}</UiButton>
      </div>
      <div v-if="credit" class="sl-hero__foot"><small class="sl-hero__credit">{{ credit }}</small></div>
    </div>
  </div>
</template>
