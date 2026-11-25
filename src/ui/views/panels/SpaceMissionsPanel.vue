<script setup>
import { storeToRefs } from 'pinia';
import { nextTick, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import RailPanel from '../../rail/RailPanel.vue';
import { useSpaceMissionsStore } from '../../stores/spaceMissions.js';
import MissionDetail from './MissionDetail.vue';
import MissionRoster from './MissionRoster.vue';

const props = defineProps({ listOpen: Boolean });
const { enabled, mission } = storeToRefs(useSpaceMissionsStore());
const host = ref(null);

watch(
  () => Boolean(mission.value),
  async (selected) => {
    // Keep keyboard focus in the panel when the selected mission replaces the roster.
    if (!host.value?.contains(document.activeElement)) return;
    await nextTick();
    // A keyboard close has already focused the closed mission's row
    // (MissionDetail); that row stays focused.
    if (!selected && document.activeElement?.closest?.('[data-mission-roster-id]') && host.value?.contains(document.activeElement)) return;
    const control = selected
      ? '[data-mission-close]'
      : '[data-mission-roster-id]';
    host.value?.querySelector(control)?.focus();
  },
);
</script>

<template>
  <RailPanel
    id="space-missions-panel"
    :title="t('Space Missions')"
    :hidden="!enabled"
    :glow="false"
    start-collapsed
    sideways
    scroll
    rail-scroller
  >
    <Teleport defer to="#context-live-missions" :disabled="!props.listOpen">
    <div id="space-mission-panel-host" ref="host">
      <MissionRoster />
      <MissionDetail />
    </div>
    </Teleport>
  </RailPanel>
</template>
