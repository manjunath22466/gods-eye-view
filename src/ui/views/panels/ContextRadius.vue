<script setup>
import { computed } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { CONTEXT_RADIUS_STEPS, contextRadiusKm, setContextRadiusKm } from '../../contextRadius.js';
import UiSlider from '../../kit/UiSlider.js';

defineProps({ label: { type: String, required: true } });

const radiusText = computed(() => t('{n} km', { n: formatNumber(contextRadiusKm.value) }));
const radiusIndex = computed(() => CONTEXT_RADIUS_STEPS.indexOf(contextRadiusKm.value));
const pickRadius = (index) => setContextRadiusKm(CONTEXT_RADIUS_STEPS[index]);
</script>

<template>
  <div class="view-context__radius">
    <span class="view-context__radius-label">{{ label }}</span>
    <UiSlider class="view-context__radius-slider" min="0" :max="CONTEXT_RADIUS_STEPS.length - 1" step="1" :model-value="radiusIndex" :aria-label="label" :aria-valuetext="radiusText" :title="label" @update:model-value="pickRadius" />
    <output class="view-context__radius-value">{{ radiusText }}</output>
    <div class="view-context__radius-steps" aria-hidden="true">
      <span v-for="step in CONTEXT_RADIUS_STEPS" :key="step" :class="{ 'is-on': step === contextRadiusKm }">{{ formatNumber(step) }}</span>
    </div>
  </div>
</template>
