<script setup>
import { storeToRefs } from 'pinia';
import { computed, shallowRef, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import UiSegmented from '../../kit/UiSegmented.vue';
import { useStreetLevelStore } from '../../stores/streetLevel.js';

// The street-level photo: the top image of its card in Context. The
// standalone Street Level panel is retired: a picked photo's
// card is its only view, and its filters are in its Data Layers row. Fit and
// fill and full screen stay on the image; Esc leaves full screen. The viewer
// element belongs to the layer (a provider mounts into it), so it is always
// in the page: Context keeps it in a hidden home and moves it onto the card
// of the open photo, or into the dock (streetLevelViewerPlacement.js).
const store = useStreetLevelStore();
const { view, expanded, expandAvailable } = storeToRefs(store);

const viewer = computed(
  () =>
    view.value?.viewer ?? {
      open: false,
      loading: false,
      renderMode: 'letterbox',
      renderModes: true,
    },
);

const renderModeOptions = computed(() => [
  {
    value: 'letterbox',
    label: t('FIT'),
    attrs: {
      'data-sl-render': 'letterbox',
      title: t('Fit: show the whole photo, with dark bars where its shape differs from the frame'),
    },
  },
  {
    value: 'fill',
    label: t('FILL'),
    attrs: {
      'data-sl-render': 'fill',
      title: t('Fill: fill the frame edge to edge, cropping the photo'),
    },
  },
]);

// The image line keeps what it last showed while hidden.
const image = shallowRef({ captionLeft: '', captionRight: '', link: null, href: '#', linkLabel: '' });
watch(
  view,
  (next) => {
    if (!next?.viewer.open) return;
    const { captionLeft, captionRight, link, linkLabel } = next.viewer;
    image.value = {
      captionLeft,
      captionRight,
      link,
      href: link || image.value.href,
      linkLabel: linkLabel || image.value.linkLabel,
    };
  },
  { flush: 'sync' },
);
</script>

<template>
  <div id="sl-viewer-root" class="sl-viewer-root">
    <div id="sl-viewer-wrap" class="sl-viewer-wrap" :hidden="!viewer.open">
      <div class="sl-viewer-bar">
        <div class="sl-viewer-tools">
          <UiButton id="sl-viewer-expand" class="scene-btn" :hidden="!expandAvailable" :pressed="Boolean(expanded)" :aria-label="expanded === null ? undefined : expanded ? t('Shrink') : t('Expand')" :title="t('Show the street-level view full screen (Esc shrinks it)')"><span class="sl-btn-icon" aria-hidden="true">{{ expanded ? '⤡' : '⤢' }}</span><span class="sl-btn-text">{{ expanded ? t('SHRINK') : t('EXPAND') }}</span></UiButton>
          <UiSegmented class="sl-seg" item-class="sl-seg-btn" active-class="is-active" keyboard="radio" :hidden="!viewer.renderModes" :label="t('Image fit')" :options="renderModeOptions" :model-value="viewer.renderMode" @update:model-value="store.act('setRenderMode', $event)" />
        </div>
      </div>
      <div id="sl-viewer-error" class="sl-error" role="alert" :hidden="!view?.error"><span aria-hidden="true">⚠</span> {{ view?.error || '' }}</div>
      <div class="sl-viewer-stage">
        <div id="sl-viewer-placeholder" class="sl-viewer-placeholder" :hidden="!viewer.loading"></div>
        <div id="sl-viewer" class="sl-viewer" :aria-label="t('Street-level viewer')"></div>
      </div>
      <!-- Who took it and under what licence stay on the image itself. -->
      <div id="sl-image-meta" class="sl-image-meta">
        <span id="sl-image-by" class="sl-image-by">{{ image.captionLeft }}</span>
        <span class="sl-image-right">
          <span id="sl-image-when" class="sl-image-when">{{ image.captionRight }}</span>
          <a id="sl-image-link" class="sl-image-link" :href="image.href" target="_blank" rel="noopener noreferrer" :title="t('Open this image on the provider\'s site')" :hidden="!image.link">{{ image.linkLabel }}</a>
        </span>
      </div>
    </div>
  </div>
</template>
