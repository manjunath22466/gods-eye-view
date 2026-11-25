<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { nearestCity } from '../../../data/wikidataCities.js';
import { OPENFREEMAP_CARD_CREDIT, OPENFREEMAP_CARD_CREDIT_FULL } from '../../../maps/attribution.js';
import CardMapCanvas from './CardMapCanvas.vue';
import UiButton from '../../kit/UiButton.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { cardMapTheme, toggleCardMapTheme } from '../../cardMap.js';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import { cityCaption, closeUpPlace, closeUpZoom } from '../../mapTiles.js';

// The hero for an item with no photo of its own (a fire, a quake, a site): a
// close-up map of where it is, drawn from OpenStreetMap's vector tiles
// (OpenFreeMap) in the card map's style, with the item's mark glowing on the
// spot: the sprite the map draws it with, or its glyph. It is as close as
// suits the kind of item, and drawn again only when the item moves a fair
// way.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  /** The glyph where the item's layer has no sprite (a Material Symbols name). */
  icon: { type: String, default: 'location_on' },
  /** The item's card: its kind sets the zoom, and a place's own name captions the map. */
  card: { type: Object, default: null },
  /**
   * Whether it is the view shown. A finished map kept behind another view
   * stays as it is; one still loading stops its requests, and draws again
   * when shown.
   */
  active: { type: Boolean, default: true },
});

const emit = defineEmits(['state', 'entered']);
const zoom = computed(() => closeUpZoom(props.card));
// A moving item is drawn where it was when the map was taken, so the map is
// taken again only once it has moved about 0.01° (about 1 km).
const spot = ref(null);
watch(
  () => [props.lat, props.lon, props.active],
  ([lat, lon, active]) => {
    if (!active && spot.value) return;
    const at = spot.value;
    if (at && Math.abs(at.lat - lat) < 0.01 && Math.abs(at.lon - lon) < 0.01) return;
    spot.value = { lat, lon };
  },
  { immediate: true },
);

// The caption names the place itself when the card does, else the city
// nearest the spot.
const ownPlace = computed(() => closeUpPlace(props.card));
const near = ref('');
watch(
  [spot, ownPlace],
  async ([at, own]) => {
    near.value = '';
    if (!at || own) return;
    try {
      const city = await nearestCity(at.lat, at.lon, { radiusKm: 60, nearKm: 25 });
      if (spot.value === at && !ownPlace.value) near.value = cityCaption(city);
    } catch {
      near.value = '';
    }
  },
  { immediate: true },
);
const place = computed(() => ownPlace.value || near.value);

// The same mark the item has everywhere in Context (EntityMark.vue).
// What of the map shows, measured when it draws: the hero round the spot,
// its foot (the caption and the credit) kept free of names.
const root = ref(null);
const foot = ref(null);
function measure() {
  const box = root.value?.getBoundingClientRect?.();
  if (!box?.width || !box?.height) return null;
  const top = foot.value?.getBoundingClientRect?.().top;
  const clearBottom = Number.isFinite(top) && top > box.top ? box.bottom - top : 0;
  return { width: box.width, height: box.height, clearBottom };
}

const markLayer = computed(() => props.card?.layerId || '');
const mark = computed(() => (markLayer.value ? markKind(markLayer.value, props.card) : ''));
</script>

<template>
  <div ref="root" class="close-up-map">
    <div class="close-up-map__map" aria-hidden="true">
      <CardMapCanvas
        v-if="spot"
        class="close-up-map__canvas"
        :lat="spot.lat"
        :lon="spot.lon"
        :zoom="zoom"
        :active="active"
        :measure="measure"
        :resize-targets="[root, foot]"
        @state="emit('state', $event)"
        @entered="emit('entered', $event)"
      />
    </div>
    <UiButton
      class="close-up-map__theme"
      :label="t('Light map')"
      :pressed="cardMapTheme === 'toner'"
      @click.stop="toggleCardMapTheme"
    >
      <UiIcon name="light_mode" :size="null" />
    </UiButton>
    <span class="close-up-map__icon" aria-hidden="true"><EntityMark :layer="markLayer" :kind="mark" :icon="icon" /></span>
    <!-- The caption over the credit, at the map's foot. The map's sources are
         credited on screen whenever it shows, even before its tiles load or
         when they fail; its title is the long form. The credit is set left to
         right in either direction, so its © stays in front. -->
    <div ref="foot" class="close-up-map__foot map-foot">
      <span class="close-up-map__label" :title="place || undefined">{{ place ? t('Close-up map · {place}', { place }) : t('Close-up map') }}</span>
      <small class="close-up-map__credit map-credit" tabindex="0" :title="OPENFREEMAP_CARD_CREDIT_FULL"><bdi dir="ltr">{{ OPENFREEMAP_CARD_CREDIT }}</bdi></small>
    </div>
  </div>
</template>
