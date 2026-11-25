<script setup>
import { storeToRefs } from 'pinia';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { useSpaceMissionsStore } from '../../stores/spaceMissions.js';
import { contextNeedle, contextSearchText, matchesContextSearch } from '../../contextSearch.js';
import { missionsByTime } from '../../missionsByTime.js';
import ContextListCard from '../../kit/ContextListCard.vue';
import UiBadge from '../../kit/UiBadge.vue';
import EntityMark from './EntityMark.vue';
import MissionDetail from './MissionDetail.vue';

// Space Missions in Context's Inspect view while it is on and nothing is
// picked: its roster as a list card (ContextListCard.vue), by launch time
// rather than distance, since missions are not near anything (upcoming
// soonest first, then the most recent, missionsByTime.js), split by launch
// provider, narrowed by the Context search. A row selects its mission as
// the globe does, and the mission's card shows in the list's place. The header close button
// returns to the roster. Hovering or focusing a row previews the mission on the globe
// through the layer's roster preview.
const props = defineProps({ feed: { type: Object, default: null } });
const cards = useEntityCardStore();
const { enabled, roster, mission, layer } = storeToRefs(useSpaceMissionsStore());

const entries = computed(() => (enabled.value && roster.value?.entries) || []);
const troubled = computed(() => props.feed && !['nominal', 'loading'].includes(props.feed.tone));
const state = computed(() => {
  if (entries.value.length) return 'ready';
  if (troubled.value) return 'failed';
  return roster.value ? 'empty' : 'loading';
});

// What counts as upcoming moves on with the clock, read every minute while
// there are missions to list. This component is in the page only while
// nothing is picked.
const now = ref(Date.now());
let timer = 0;
watch(
  () => entries.value.length > 0,
  (listing) => {
    clearInterval(timer);
    timer = 0;
    if (!listing) return;
    now.value = Date.now();
    timer = setInterval(() => (now.value = Date.now()), 60_000);
  },
  { immediate: true },
);
onBeforeUnmount(() => clearInterval(timer));

// A new roster drops the layer's preview. A row that kept focus through the
// refresh gets no new focus event, so its preview is asked for again here.
watch(
  roster,
  () => {
    const row = globalThis.document?.activeElement?.closest?.('.nearby-missions [data-list-key]');
    if (!row) return;
    const entry = entries.value.find((item) => String(item.id) === row.dataset.listKey);
    if (entry) layer.value?.rosterFocus(entry.index);
  },
  { flush: 'post' },
);

const byTime = (items) => missionsByTime(items, now.value).map(({ entry }) => entry);
const matches = (entry) => matchesContextSearch(entry.label, entry.provider);
const provider = (entry) => entry.provider || t('UNSPECIFIED OPERATOR');
const upcoming = (entry) => Number.isFinite(entry.launchAt) && entry.launchAt >= now.value;
</script>

<template>
  <ContextListCard
    v-if="enabled"
    id="space-missions"
    header-close
    class="nearby-missions"
    :title="t('Space Missions')"
    icon="rocket_launch"
    :tone="troubled ? feed.tone : state === 'loading' ? 'loading' : 'nominal'"
    :tone-text="troubled ? feed.toneText : state === 'loading' ? t('Loading') : t('Live')"
    :items="entries"
    :item-key="(entry) => entry.id"
    :sort="byTime"
    :filter="matches"
    :query="contextNeedle"
    :return-revision="`${cards.view?.manualInputCount ?? 0}:${cards.viewCommandRevision}`"
    :group-by="provider"
    :selected="mission?.id ?? null"
    :state="state"
    :back-title="t('Show all missions')"
    @select="(entry) => layer?.selectMissionAt(entry.index, { keepFollow: true })"
    @back="layer?.deselectMission()"
    @row-pointer="(entry) => (entry ? layer?.rosterPointerEnter(entry.index) : layer?.rosterPointerLeave())"
    @row-focus="(entry) => layer?.rosterFocus(entry.index)"
    @row-blur="(entry) => layer?.rosterBlur(entry ? entry.index : null)"
  >
    <template #row="{ item }">
      <EntityMark class="nearby-lists__mark" layer="rocket-launches" icon="rocket_launch" :size="16" />
      <span class="nearby-lists__name" :title="item.label">{{ item.label }}</span>
      <UiBadge v-if="upcoming(item)" class="nearby-lists__badge">{{ t('Upcoming') }}</UiBadge>
      <span class="nearby-lists__meta" dir="ltr">{{ item.date }}</span>
    </template>
    <template #detail><MissionDetail /></template>
    <template #loading>{{ t('LOADING 30-DAY MISSION INDEX') }}</template>
    <template #empty>{{ roster?.empty }}</template>
    <template #no-matches>{{ t('Nothing matches “{text}”.', { text: contextSearchText.trim() }) }}</template>
  </ContextListCard>
</template>
