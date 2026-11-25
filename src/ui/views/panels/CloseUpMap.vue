<script setup>
import { computed, ref, watch } from 'vue';
import { t } from '../../../i18n/index.js';
import { nearestCity } from '../../../data/wikidataCities.js';
import { ESRI_IMAGERY_PLACES_CARD_CREDIT, ESRI_IMAGERY_PLACES_CREDIT, ESRI_PLACES_TILES } from '../../../maps/attribution.js';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import { cityCaption, closeUpPlace, closeUpZoom, tileBlock } from '../../mapTiles.js';

// The hero for an item with no photo of its own (a fire, a quake, a site): a
// close-up satellite map of where it is, with Esri's place names over it and
// the item's mark on the spot: the sprite the map draws it with, or its glyph. It is a still of Esri World Imagery, the
// app's keyless basemap, as close as suits the kind of item, read again only
// when the item moves a fair way.
const props = defineProps({
  lat: { type: Number, required: true },
  lon: { type: Number, required: true },
  /** The glyph where the item's layer has no sprite (a Material Symbols name). */
  icon: { type: String, default: 'location_on' },
  /** The item's card: its kind sets the zoom, and a place's own name captions the map. */
  card: { type: Object, default: null },
  /**
   * Whether it is the view shown. A map kept behind another view holds the
   * tiles it has and asks for no new ones; shown again, it catches up.
   */
  active: { type: Boolean, default: true },
});

const emit = defineEmits(['drawn']);
const imagery = ref([]);
const zoom = computed(() => closeUpZoom(props.card));
// A moving item is drawn where it was when the map was taken, so the map is
// taken again only once it has moved about 0.01° (about 1 km).
const spot = ref(null);
watch(
  () => [props.lat, props.lon, props.active],
  ([lat, lon, active]) => {
    if (!active) return;
    const at = spot.value;
    if (at && Math.abs(at.lat - lat) < 0.01) {
      const span = Math.abs(at.lon - lon);
      if (Math.min(span, 360 - span) < 0.01) return;
    }
    spot.value = { lat, lon };
  },
  { immediate: true },
);
const tiles = computed(() => (spot.value ? tileBlock(spot.value.lat, spot.value.lon, zoom.value) : []));
const labels = computed(() => (spot.value ? tileBlock(spot.value.lat, spot.value.lon, zoom.value, ESRI_PLACES_TILES) : []));

function reportDrawn() {
  emit('drawn', props.active && imagery.value.some((image) => image.complete && image.naturalWidth > 0));
}
watch([tiles, () => props.active], reportDrawn, { flush: 'post' });

// The caption names the place itself when the card does, else the city
// nearest the spot.
const ownPlace = computed(() => closeUpPlace(props.card));
const near = ref(null);
watch(
  [spot, ownPlace],
  async ([at, own]) => {
    near.value = null;
    if (!at || own) return;
    const city = await nearestCity(at.lat, at.lon, { radiusKm: 60, nearKm: 25 }).catch(() => null);
    if (spot.value === at && !ownPlace.value) near.value = city;
  },
  { immediate: true },
);
const place = computed(() => ownPlace.value || cityCaption(near.value));

// The same mark the item has everywhere in Context (EntityMark.vue).
const markLayer = computed(() => props.card?.layerId || '');
const mark = computed(() => (markLayer.value ? markKind(markLayer.value, props.card) : ''));
</script>

<template>
  <div class="close-up-map">
    <div class="close-up-map__map" aria-hidden="true">
      <img v-for="tile in tiles" :key="tile.key" ref="imagery" v-on="{ load: reportDrawn, error: reportDrawn }" class="close-up-map__tile" :src="tile.src" alt="" draggable="false" :style="{ transform: `translate(${tile.left}px, ${tile.top}px)` }" />
      <img v-for="tile in labels" :key="`labels-${tile.key}`" class="close-up-map__tile close-up-map__tile--labels" :src="tile.src" alt="" draggable="false" :style="{ transform: `translate(${tile.left}px, ${tile.top}px)` }" />
    </div>
    <span class="close-up-map__icon" aria-hidden="true"><EntityMark :layer="markLayer" :kind="mark" :icon="icon" /></span>
    <!-- The caption over the credit, at the map's foot. Every source of the
         imagery and the names is credited on screen, in full; its title is
         the long form. -->
    <div class="close-up-map__foot map-foot">
      <span class="close-up-map__label" :title="place || undefined">{{ place ? t('Close-up satellite map · {place}', { place }) : t('Close-up satellite map') }}</span>
      <small class="close-up-map__credit map-credit" tabindex="0" :title="ESRI_IMAGERY_PLACES_CREDIT">{{ ESRI_IMAGERY_PLACES_CARD_CREDIT }}</small>
    </div>
  </div>
</template>
