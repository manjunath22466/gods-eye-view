<script setup>
import { registerCctvToolsHome } from '../../cctvToolsPlacement.js';
import { storeToRefs } from 'pinia';
import { computed } from 'vue';
import { t } from '../../../i18n/index.js';
import UiButton from '../../kit/UiButton.vue';
import RailPanel from '../../rail/RailPanel.vue';
import CctvPicker from '../../cctv/CctvPicker.vue';
import CctvTools from './CctvTools.vue';
import { useCctvStore } from '../../stores/cctv.js';
import UiBadge from '../../kit/UiBadge.vue';

// The CCTV panel, rendered from what CctvControls presents and publishes;
// until it renders, the panel shows its initial markup. The controls draw
// the live video into its canvas.
const { view, frame, live, sourceBadge, summary, picker } = storeToRefs(useCctvStore());
// The live video is named for the active camera, wherever it is shown.
const liveName = computed(
  () => picker.value?.options?.find((entry) => entry.value === view.value?.activeCameraId)?.label || t('Camera view'),
);
// The frame's request state, as data attributes that read "true" or are
// empty; none until the controls first publish.
const flag = (on) => (on ? 'true' : '');
const frameData = computed(() =>
  frame.value
    ? {
        'data-camera-id': frame.value.cameraId,
        'data-current-src': frame.value.currentSrc,
        'data-loading': flag(frame.value.loading),
        'data-error': flag(frame.value.error),
      }
    : {},
);
</script>

<template>
<RailPanel id="cctv-panel" start-collapsed :title="t('CCTV')" sideways scroll rail-scroller>
    <div class="cyber-panel-body ui-scroll" data-rail-scroller>
    <div id="cctv-frame-wrap" :class="['cctv-frame-wrap', { loading: frame?.wrapLoading, 'has-frame': frame?.hasFrame }]">
      <span class="cctv-frame-caption" aria-hidden="true">{{ t('ACQUIRING FRAME') }}</span>
      <img id="cctv-frame" alt="CCTV feed frame" :class="{ active: frame?.hasFrame }" :src="frame?.src || undefined" :hidden="live" v-bind="frameData" />
      <canvas id="cctv-video" class="cctv-frame" :hidden="!live" role="img" :aria-label="liveName"></canvas>
    </div>
    <UiBadge id="cctv-source-badge" role="status" aria-live="polite" :data-frame-state="sourceBadge?.state">{{ sourceBadge?.label ?? t('SOURCE · UNKNOWN') }}</UiBadge>
    <div id="cctv-meta">{{ view?.meta ?? t('Enable CCTV to load camera intersections') }}</div>
    <div class="cctv-controls">
      <UiButton class="scene-btn" :pressed="Boolean(view?.enabled)" pressed-class="active" id="cctv-enable-btn">{{ view?.enabled ? t('CCTV ON') : t('CCTV OFF') }}</UiButton>
      <UiButton id="cctv-nearest-btn" type="button" class="gev-action-button scene-btn" :disabled="view?.navDisabled">{{ t('NEAREST') }}</UiButton>
    </div>
    <div class="cctv-controls">
      <UiButton id="cctv-prev-btn" type="button" class="gev-action-button scene-btn" :disabled="view?.navDisabled">{{ t('PREV') }}</UiButton>
      <CctvPicker class="gev-field" id="cctv-camera-select" :aria-label="t('CCTV camera')" />
      <UiButton id="cctv-next-btn" type="button" class="gev-action-button scene-btn" :disabled="view?.navDisabled">{{ t('NEXT') }}</UiButton>
    </div>
    <div class="cctv-controls">
      <UiButton id="cctv-focus-btn" type="button" class="gev-action-button scene-btn" :disabled="view?.focusDisabled">{{ t('FOCUS') }}</UiButton>
    </div>
    <!-- The camera tools: Context's Camera settings tab borrows them while
         it shows. -->
    <div :ref="registerCctvToolsHome">
      <CctvTools />
    </div>
    </div>
</RailPanel>
</template>
