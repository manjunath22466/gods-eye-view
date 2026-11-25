<script setup>
import { onBeforeUpdate, onUpdated, ref } from 'vue';
import { formatNumber, t } from '../../../i18n/index.js';
import { useEntityCardStore } from '../../stores/entityCard.js';
import { shownLayerName } from '../../layerNames.js';
import { contextListPresence, showContextList } from '../../contextLists.js';
import { distanceText as distance } from '../../distanceText.js';
import AirportLink from './AirportLink.vue';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';

// What's nearby: one list per layer that is on, sorted by distance, its first
// row the nearest and marked so. Hazards (fires, quakes, storms) and News are
// layers like any other here. A layer with nothing in range has no list; its
// 0 shows on its count tile. Any row opens that item's card; the item is
// followed where it can be (aircraft, satellites), flown to otherwise. Each
// row leads with its item's mark (EntityMark.vue): the sprite the map draws
// it with, or its layer's glyph.
defineProps({
  /** From the store's `nearbyByLayer`. */
  lists: { type: Array, required: true },
  /** Shown on the line above the lists. */
  title: { type: String, default: '' },
  /**
   * Whether Cameras' group ends with a link to Context's Cameras list: for
   * lists around the centre of the view, as that list is.
   */
  listLinks: { type: Boolean, default: true },
});

const store = useEntityCardStore();

// What a moving item is doing, as the layer's own display shows it (transit
// vehicles report it): an icon on its row, its words on hover.
const MOTION_STATES = {
  moving: { icon: 'play_arrow', label: () => t('Moving') },
  stopped: { icon: 'pause', label: () => t('Stopped', { context: 'vehicle motion' }) },
  waiting: { icon: 'schedule', label: () => t('Waiting for update') },
  'no-fix': { icon: 'location_off', label: () => t('No recent fix') },
};
const motionOf = (item) => MOTION_STATES[item.identity?.record?.motion] || null;

// A row may name an airport beside it (`via`: an arrival's origin, a
// departure's destination), its code a link to that airport's card. The words
// around the code come from the whole phrase, so each language keeps its own
// order ("from SDF", "SDF から").
const CODE_MARK = '\u0001';
const VIA_WORDS = {
  from: () => t('from {origin}', { origin: CODE_MARK }),
  to: () => t('to {destination}', { destination: CODE_MARK }),
};
function viaWords(via) {
  const phrase = VIA_WORDS[via.words]?.() || CODE_MARK;
  const at = phrase.indexOf(CODE_MARK);
  return at < 0 ? { before: '', after: '' } : { before: phrase.slice(0, at), after: phrase.slice(at + CODE_MARK.length) };
}

// Cameras' group ends with a link to Context's Cameras list while it has
// more than the group shows.
const showsAll = (list) => list.layerId === 'cctv' && Boolean(contextListPresence.cctv) && list.count > list.items.length;

// The lists refresh every few seconds. A focused row, or the airport named
// beside it, that drops out of them hands focus on: to the same control where
// it is drawn again, else to its row, else to the row now in its place (or its
// group's last), else to the heading, so the keyboard is never sent back to
// the page. When the last row goes and the section with it, `focus-lost` asks
// the view around it to take the focus.
const emit = defineEmits(['focus-lost']);
const root = ref(null);
let held = null;
onBeforeUpdate(() => {
  const active = globalThis.document?.activeElement;
  if (active && active === root.value?.querySelector('.nearby-lists__title')) {
    held = { heading: true };
    return;
  }
  const control = active?.closest?.('[data-row-key], [data-via-key]');
  held =
    control && root.value?.contains(control)
      ? {
          key: control.dataset.rowKey ?? control.dataset.viaKey,
          via: control.dataset.viaKey !== undefined,
          layer: control.dataset.rowLayer,
          index: Number(control.dataset.rowIndex),
        }
      : null;
});
onUpdated(() => {
  const was = held;
  held = null;
  if (!was) return;
  // Only focus that fell back to the page is moved.
  const active = globalThis.document?.activeElement;
  if (active && active !== globalThis.document.body) return;
  const section = root.value;
  if (!section) {
    emit('focus-lost');
    return;
  }
  if (was.heading) {
    section.querySelector('.nearby-lists__title')?.focus();
    return;
  }
  const rows = [...section.querySelectorAll('[data-row-key]')];
  const via = was.via ? [...section.querySelectorAll('button[data-via-key]')].find((node) => node.dataset.viaKey === was.key) : null;
  const row = rows.find((node) => node.dataset.rowKey === was.key);
  const group = rows.filter((node) => node.dataset.rowLayer === was.layer);
  const next = via || row || group[Math.min(was.index, group.length - 1)] || section.querySelector('.nearby-lists__title');
  next?.focus?.();
});
</script>

<template>
  <section v-if="lists.some((list) => list.items.length)" ref="root" class="nearby-lists" :aria-label="title || t('What’s nearby')">
    <h4 class="nearby-lists__title" tabindex="-1">{{ title || t('What’s nearby') }}</h4>
    <template v-for="list in lists" :key="list.layerId">
      <div v-if="list.items.length" class="nearby-lists__layer" :data-layer="list.layerId">
        <h5 class="nearby-lists__head">
          <UiIcon :name="list.icon" :size="null" />
          <span>{{ shownLayerName(list.layerName, list.layerId) }}</span>
          <span class="nearby-lists__count">{{ formatNumber(list.count) }}</span>
        </h5>
        <ul>
          <li v-for="(item, index) in list.items" :key="item.key" :class="{ 'nearby-lists__row--nearest': index === 0, 'nearby-lists__row--via': item.via }">
            <UiButton
              :title="t('Select it; aircraft and satellites are followed')"
              :data-row-key="item.key"
              :data-row-layer="list.layerId"
              :data-row-index="index"
              @click="store.open(item.identity)"
            >
              <UiIcon
                v-if="motionOf(item)"
                :name="motionOf(item).icon"
                :size="null"
                class="nearby-lists__motion"
                :data-motion="item.identity.record.motion"
                :title="motionOf(item).label()"
                role="img"
                :aria-label="motionOf(item).label()"
                :aria-hidden="null"
              />
              <EntityMark class="nearby-lists__mark" :layer="item.layerId" :kind="markKind(item.layerId, item.identity?.record)" :icon="list.icon" :size="16" />
              <span class="nearby-lists__name" :title="item.title">{{ item.title }}</span>
              <span v-if="index === 0" class="nearby-lists__badge">{{ t('Nearest') }}</span>
              <span class="nearby-lists__meta">{{ distance(item.distanceKm) }}</span>
            </UiButton>
            <span v-if="item.via" class="nearby-lists__via">{{ viaWords(item.via).before }}<AirportLink :code="item.via.code" :data-via-key="item.key" :data-row-layer="list.layerId" :data-row-index="index" />{{ viaWords(item.via).after }}</span>
          </li>
        </ul>
        <UiButton v-if="listLinks && showsAll(list)" class="nearby-lists__all" @click="showContextList('cctv')">
          {{ t('Show all {n}', { n: formatNumber(list.count) }) }} <span aria-hidden="true">›</span>
        </UiButton>
      </div>
    </template>
  </section>
</template>
