<script setup>
import { t } from '../../i18n/index.js';
import RailCardBlocks from '../rail/RailCardBlocks.vue';
import RailCards from '../rail/RailCards.vue';

// Active weather: a short briefing (conditions at the map center, observed
// frames, wind, alerts), then forecast and event cards, then the observed
// products with the time of the frame they show. The world timeline moves
// time; the owner computes every value shown.
defineProps({
  view: { type: Object, required: true },
  onParams: { type: Function, default: () => {} },
  onOpen: { type: Function, default: () => {} },
});
</script>

<template>
  <section
    class="weather-readout"
    :hidden="view.hidden"
    :aria-label="t('Active weather')"
    ><section
      class="weather-briefing"
      :hidden="!view.briefing?.length"
      :aria-label="t('Weather briefing')"
      ><section
        v-for="section in view.briefing || []"
        :key="section.id"
        class="weather-briefing-section"
        :data-section-id="section.id"
        ><h3 class="panel-title">{{ section.title }}</h3
        ><RailCardBlocks
          :blocks="section.blocks"
          :card-id="section.layerId"
          :on-params="onParams" /></section></section
    ><div class="weather-cards"
      ><RailCards
        :cards="view.cards"
        card-class-name="weather-card"
        badge-class-name="weather-coverage"
        :on-params="onParams"
        :on-open="onOpen" /></div
    ><section
      class="weather-observed-group"
      :hidden="!view.observed"
      :aria-label="t('Observed history')"
      ><h3 class="panel-title">{{ t('Observed history') }}</h3
      ><div class="weather-observed-scope">{{ view.scope }}</div
      ><div class="weather-frame-time" :hidden="!view.frameTime">{{
        view.frameTime
      }}</div
      ><div class="weather-cards"
        ><RailCards
          :cards="view.observedCards"
          card-class-name="weather-card"
          badge-class-name="weather-coverage"
          :on-params="onParams"
          :on-open="onOpen" /></div></section
  ></section>
</template>
