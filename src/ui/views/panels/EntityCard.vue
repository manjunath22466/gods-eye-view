<script setup>
import { STREET_LEVEL_LAYER } from '../../streetLevelEvents.js';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatDate, formatNumber, getLocale, msg, t, translateKnown } from '../../../i18n/index.js';
import { contextAgeText, durationText } from '../../contextTime.js';
import { approximatePosition } from '../../distanceText.js';
import { factFigure, factLabel, factValue, sayWords, useEntityCardStore } from '../../stores/entityCard.js';
import EntityPreview from './EntityPreview.vue';
import AltitudeGraph from './AltitudeGraph.vue';
import RouteProfile from './RouteProfile.vue';
import AirportLink from './AirportLink.vue';
import LocalConditions from './LocalConditions.vue';
import { contextNeedle, contextSearchText, matchesContextSearch } from '../../contextSearch.js';
import { useCockpitStore } from '../../stores/cockpit.js';
import { useCctvStore } from '../../stores/cctv.js';
import SpotConditions from './SpotConditions.vue';
import ReadingHero from './ReadingHero.vue';
import { shownLayerName } from '../../layerNames.js';
import { countryName, nearestCity } from '../../../data/wikidataCities.js';
import { reportingProviderCredit } from '../../../layers/wildlifeSightings/photoText.js';
import { flagEmoji } from '../../../data/aircraftCountry.js';
import { ownerMark, preloadOwnerFlags, shownOwnerMark } from '../../ownerFlag.js';
import { compassName } from '../../spotConditions.js';
import { satelliteSwath } from '../../satelliteSwath.js';
import ItemCharts from './ItemCharts.vue';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import { roundHeadingDegrees } from '../../../data/headingDegrees.js';
import { PLACE_LAYER, spotCoordinates } from '../../placeCard.js';
import PlaceDetails from './PlaceDetails.vue';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';
import UiEmpty from '../../kit/UiEmpty.vue';
import UiIcon from '../../kit/UiIcon.vue';

// The Context panel's card for one thing on the map. Every card is the same
// card, in one order: its top image, then its name with one small line on
// where the data comes from and how old it is, the buttons, its key live
// numbers, how it is changing, what is nearby, and the facts folded under
// More details. It reads from the entity card store, which the globe click,
// the omnibar and the nearby lists all fill.
const props = defineProps({ withContacts: Boolean });
const store = useEntityCardStore();
const { card, lost, locationWithheld, tick, away, finding, located } = storeToRefs(store);
// A place or an airport: its own card parts.
const isPlace = computed(() => card.value?.layerId === PLACE_LAYER);
// A matching frame can supply a label for the camera card.
const cctv = useCctvStore();
const { frame: cctvFrame } = storeToRefs(cctv);
const shownTitle = computed(() => {
  const current = card.value;
  if (current?.titleWords) return sayWords(current.titleWords, current.title);
  if (current?.layerId !== 'cctv') return current?.title;
  const f = cctvFrame.value;
  if (!f || f.cameraId !== current.identity?.id) return current.title;
  try {
    return new URL(f.src || f.currentSrc, location.origin).searchParams.get('label') || current.title;
  } catch {
    return current.title;
  }
});

// Tracking or Cockpit can hold the camera, so Fly to on a camera does not
// move it: the card says why for a few seconds, until the next Fly to or pick.
const FLY_HELD = { 'tracking-holds-view': msg('Tracking holds the view'), 'cockpit-active': msg('Cockpit is active') };
const FLY_NOTE_MS = 4000;
const flyNote = ref('');
let flyNoteTimer = 0;
function setFlyNote(text) {
  clearTimeout(flyNoteTimer);
  flyNoteTimer = text ? setTimeout(() => setFlyNote(''), FLY_NOTE_MS) : 0;
  flyNote.value = text;
}
const flyTo = () => setFlyNote(FLY_HELD[store.flyTo()] || '');
watch(
  () => card.value?.key,
  () => setFlyNote(''),
);
onBeforeUnmount(() => clearTimeout(flyNoteTimer));

// One small line on every card: where the data comes from and how old it
// is, "ADS-B · 4 s ago". A moving item that dropped out of its feed says so.
const source = computed(() => {
  void tick.value;
  return store.sourceOf(card.value);
});
// More details names a camera's provider plainly as its source, not the
// layer's own source wording.
const shownSource = computed(() => camera.value?.provider || source.value);
const sourceLine = computed(() => {
  void tick.value;
  const current = card.value;
  if (!current) return null;
  // A street-level photo: whose imagery it is and when it was taken.
  if (current.layerId === STREET_LEVEL_LAYER && current.identity?.id.startsWith('near:'))
    return { tone: 'aged', text: translateKnown(current.title) };
  if (streetPhoto.value) {
    const text = [streetPhoto.value.provider, streetPhoto.value.captured].filter(Boolean).join(' · ');
    return text ? { tone: 'aged', text } : null;
  }
  // A decoded still can be a cached frame or a fallback without a capture time.
  if (camera.value) {
    const owner = camera.value.credit !== shownSource.value ? camera.value.credit : '';
    const text = [shownSource.value, owner].filter(Boolean).join(' · ');
    return text ? { tone: 'aged', text } : null;
  }
  // Finding it again (Find it): the lookup under way, its miss, or the
  // reading it found on the item's own track and how old that is.
  if (finding.value === 'finding') return { tone: 'aged', text: [source.value, t('Finding it…')].filter(Boolean).join(' · ') };
  if (finding.value === 'none') return { tone: 'lost', text: [source.value, t('No reading at this time')].filter(Boolean).join(' · ') };
  if (lost.value && located.value) {
    const found = t('Last reading · {age}', { age: contextAgeText(located.value.atMs - located.value.observedAtMs) });
    return { tone: 'aged', text: [source.value, found].filter(Boolean).join(' · ') };
  }
  const age = Number.isFinite(current.observedAgeMs) ? contextAgeText(current.observedAgeMs) : '';
  if (lost.value) return { tone: 'lost', text: [source.value, t('out of feed · last reading')].filter(Boolean).join(' · ') };
  const fresh = current.moving && Number.isFinite(current.observedAgeMs) && current.observedAgeMs < 120_000;
  const text = [source.value, age].filter(Boolean).join(' · ');
  return text ? { tone: fresh ? 'live' : 'aged', text } : null;
});

const position = computed(() => {
  const current = card.value;
  if (!Number.isFinite(current?.lat) || !Number.isFinite(current?.lon)) return '';
  if (current.obscured) return t('Location obscured to a 0.2° cell');
  const lat = `${Math.abs(current.lat).toFixed(3)}°${current.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(current.lon).toFixed(3)}°${current.lon >= 0 ? 'E' : 'W'}`;
  const text = `${lat}  ${lon}`;
  return approximatePosition(current) ? `${text} (${t('approximate')})` : text;
});

// A satellite: its orbit as a figure, the swath it sees, and who launched
// it, when and what it is, from the layer's catalog records.
const satellite = computed(() => {
  void tick.value;
  const current = card.value;
  return current?.kind === 'satellite' && current.identity?.id ? store.satellite(current.identity.id) : null;
});
const acartiaCredit = computed(() => reportingProviderCredit(card.value?.acartiaProvider));
// Its inclination is a tile of its own; its orbit class (LEO, GEO) goes
// under More details, so the row keeps three tiles that each fit one line.
const orbitTiles = computed(() => {
  const orbit = satellite.value;
  if (!Number.isFinite(orbit?.inclinationDeg)) return [];
  return [{ field: 'inclination', label: t('Inclination'), number: `${formatNumber(orbit.inclinationDeg, { maximumFractionDigits: 1 })}°`, unit: '' }];
});
const swath = computed(() => (card.value?.kind === 'satellite' ? satelliteSwath(satellite.value, card.value.altitudeM) : null));
const OBJECT_TYPES = { PAY: () => t('Payload'), 'R/B': () => t('Rocket body'), DEB: () => t('Debris') };
const OPS_STATUS = {
  '+': () => t('Operational'),
  P: () => t('Partly operational'),
  B: () => t('Backup'),
  S: () => t('Spare'),
  X: () => t('Extended mission'),
  '-': () => t('Not operational'),
  D: () => t('Decayed'),
};
const launchFacts = computed(() => {
  const found = satellite.value;
  if (!found) return [];
  const launched = Date.parse(found.launchDate || '');
  return [
    { label: t('Orbit'), value: found.orbitClass || '' },
    { label: t('Launched'), value: Number.isFinite(launched) ? formatDate(launched, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '' },
    {
      label: t('Launched by'),
      // A pasted flag still finds its owner. Draw the flag separately from the text.
      value: found.owner ? `${flagEmoji(found.ownerCountryCode)} ${found.owner}`.trim() : '',
      ownerLabel: found.owner?.trim(),
    },
    { label: t('Type'), value: OBJECT_TYPES[found.objectType]?.() || found.objectType || '' },
    { label: t('Operator'), value: found.operator || '' },
    { label: t('Status'), value: OPS_STATUS[found.opsStatus]?.() || '' },
    { label: t('Sensor'), value: found.sensor?.label || '' },
    { label: t('COSPAR ID'), value: found.cosparId || '' },
  ].filter((fact) => fact.value);
});

// A street-level photo: its source and capture date on the
// source line; source, date, heading and whether it is flat or 360° under
// More details. Its record is the layer's (layers/streetLevel/photos.js),
// kept while its layer is off so its card still describes it.
const streetPhoto = computed(() => {
  void tick.value;
  const current = card.value;
  if (current?.layerId !== STREET_LEVEL_LAYER || !current.identity?.id) return null;
  const record = store.layerModule(STREET_LEVEL_LAYER)?.photo?.(current.identity.id);
  if (!record) return null;
  const at = record.capturedAt;
  const captured = Number.isFinite(at)
    ? formatDate(at, { year: 'numeric', month: 'short', ...(record.capturedAtPrecision === 'month' ? {} : { day: 'numeric' }), timeZone: 'UTC' })
    : '';
  return {
    provider: record.provider ? translateKnown(record.provider) : '',
    captured,
    dateLabel: record.capturedAtSource === 'added' ? t('Added') : t('Captured'),
    heading: Number.isFinite(record.headingDeg) ? `${formatNumber(roundHeadingDegrees(record.headingDeg))}° ${t(compassName(record.headingDeg))}` : '',
    type: record.pano ? t('360° panorama') : t('Flat photo'),
  };
});
const streetFacts = computed(() => {
  const found = streetPhoto.value;
  if (!found) return [];
  return [
    { label: t('Provider'), value: found.provider },
    { label: found.dateLabel, value: found.captured },
    { label: t('Heading'), value: found.heading },
    { label: t('Image type'), value: found.type },
  ].filter((fact) => fact.value && (!contextNeedle.value || matchesContextSearch(fact.label, fact.value, fact.value)));
});

// A camera: where it is and what it sees (city, field of view, range) as
// figures; which way it faces, how often its frame refreshes and who runs it
// stand in for any of those it lacks. The rest goes under More details, with
// a way to its calibration and projection settings.
const camera = computed(() => {
  void tick.value;
  const current = card.value;
  return current?.layerId === 'cctv' && current.identity?.id ? store.cameraDetails(current.identity.id) : null;
});
// Every figure a camera can show, each either in the row of figures or under
// More details, never both. The row has city, field of view and range; a
// missing one's place goes to facing, refresh, then provider. A row of fewer
// than two figures is left out, its figure going under More details. The
// provider is More details' Data source, which a provider in the row hides.
const cameraFields = computed(() => {
  const found = camera.value;
  if (!found) return { tiles: [], facts: [] };
  const field = (key, label, value) => (value ? { field: key, label, value } : null);
  const city = field('city', t('City'), found.city);
  const fov = field('fov', t('Field of view'), Number.isFinite(found.fovDeg) ? t('{n}°', { n: formatNumber(Math.round(found.fovDeg)) }) : '');
  const range = field('range', t('Range'), Number.isFinite(found.rangeM) ? t('{n} m', { n: formatNumber(Math.round(found.rangeM)) }) : '');
  const direction = Number.isFinite(found.headingDeg) ? t(compassName(found.headingDeg)) : '';
  const facing = field('facing', t('Facing'), direction && found.headingEstimated ? t('~{n}', { n: direction }) : direction);
  const refresh = field('refresh', t('Refresh'), Number.isFinite(found.refreshMs) ? t('{n} s', { n: formatNumber(Math.round(found.refreshMs / 1000)) }) : '');
  const provider = field('provider', t('Provider'), found.provider);
  const standIns = [facing, refresh, provider].filter(Boolean);
  let row = [city, fov, range].map((slot) => slot || standIns.shift() || null).filter(Boolean);
  if (row.length < 2) row = [];
  const shown = new Set(row);
  return {
    tiles: row.map(({ field: key, label, value }) => ({ field: key, label, number: value, unit: '' })),
    facts: [field('feed', t('Feed'), found.feedType), city, fov, range, facing, refresh].filter((fact) => fact && !shown.has(fact)),
    providerInRow: shown.has(provider),
  };
});
const cameraTiles = computed(() => cameraFields.value.tiles);
const extraFacts = computed(() => {
  const facts = [...streetFacts.value, ...launchFacts.value, ...cameraFields.value.facts];
  if (!contextNeedle.value) return facts;
  for (const tile of cameraFields.value.tiles) facts.push({ label: tile.label, value: tile.number });
  return facts.filter((fact) => matchesContextSearch(fact.label, fact.value));
});
const countryMark = computed(() => ownerMark(
  { countryCode: card.value?.countryCode || satellite.value?.ownerCountryCode },
  { locale: getLocale() },
));
const flagSheetReady = ref(null);
watch(
  () => countryMark.value?.kind === 'flag' ? `${card.value.key}:${countryMark.value.code}` : null,
  async (key) => {
    if (key && !flagSheetReady.value) flagSheetReady.value = await preloadOwnerFlags();
  },
  { immediate: true },
);
const flag = computed(() => shownOwnerMark(countryMark.value, {
  ready: flagSheetReady.value === true, failed: flagSheetReady.value === false,
}));

// The key numbers: the live figures the item's kind leads with (how high,
// how fast and which way for an aircraft; a quake's
// magnitude and depth; a fire's power), four at most, updated in place.
const tiles = computed(() => {
  const facts = card.value?.facts || [];
  // A reading on its layer's scale leads instead (ReadingHero).
  const figures = (card.value?.reading ? [] : card.value?.headline || [])
    .map((field) => facts.find((fact) => fact.field === field))
    .filter(Boolean)
    .map((fact) => ({ field: fact.field, label: factLabel(fact), ...factFigure(fact) }));
  return [...figures, ...orbitTiles.value, ...cameraTiles.value].slice(0, 4);
});

// The line under the name: who runs it and what it is. The layer is already
// named on the line above the title.
const subtitle = computed(() => {
  const current = card.value;
  if (!current) return '';
  // A street-level photo: where it was taken (its road is its name).
  if (current.layerId === STREET_LEVEL_LAYER)
    return spotCoordinates(current.lat, current.lon, (n) => formatNumber(n, { maximumFractionDigits: 5 }));
  // A camera: where it is, then its position.
  if (camera.value) {
    const at = Number.isFinite(current.lat) && Number.isFinite(current.lon) ? `${formatNumber(current.lat, { maximumFractionDigits: 4 })}, ${formatNumber(current.lon, { maximumFractionDigits: 4 })}` : '';
    return [camera.value.city, at].filter(Boolean).join(' · ');
  }
  const cls = current.aircraftClass;
  const clsName = current.aircraftClassName ? t(current.aircraftClassName) : cls && cls[0].toUpperCase() + cls.slice(1);
  return [current.operator, clsName].filter(Boolean).join(' · ');
});
// More details: the facts the figures and the header do not already show.
// The Context search narrows them to the ones whose name or value holds its
// text, and looks through every fact, the figures included.
const gridFacts = computed(() => {
  // A street-level photo's record fields are its own facts (streetFacts).
  if (card.value?.layerId === STREET_LEVEL_LAYER) return [];
  const facts = card.value?.facts || [];
  if (contextNeedle.value) return facts.filter((fact) => matchesContextSearch(factLabel(fact), factValue(fact), fact.value));
  const shown = new Set([...tiles.value.map((tile) => tile.field), ...(card.value?.reading ? card.value.headline || [] : [])]);
  return facts.filter(
    (fact) =>
      !shown.has(fact.field) &&
      !(card.value?.operator && fact.field === 'operator') &&
      !(card.value?.aircraftClass && fact.field === 'aircraftClass'),
  );
});
// Things that stay put also get the weather there and its local time.
// A place shows its weather and local time on top already.
const showLocal = computed(() => !locationWithheld.value && !isPlace.value && !card.value?.moving && Number.isFinite(card.value?.lat) && Number.isFinite(card.value?.lon));
const hasMore = computed(
  () => gridFacts.value.length || extraFacts.value.length || showLocal.value || (!card.value?.obscured && position.value) || card.value?.links?.length,
);

// How far along its route the flight is, when both airports are known: the
// share flown (distance from the origin over that plus the distance still to
// go), and the time to go at its current speed.
const routeProgress = computed(() => {
  const current = card.value;
  const route = current?.route;
  if (!route?.verified || !route.fromAt || !route.toAt) return null;
  if (!Number.isFinite(current.lat) || !Number.isFinite(current.lon)) return null;
  const km = (a, b) => {
    const rad = Math.PI / 180;
    const h =
      Math.sin(((b.lat - a.lat) * rad) / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(((b.lon - a.lon) * rad) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const here = { lat: current.lat, lon: current.lon };
  const flown = km(route.fromAt, here);
  const left = km(here, route.toAt);
  const share = flown + left > 0 ? flown / (flown + left) : 0;
  const speedKmh = Number.isFinite(current.speedMps) ? current.speedMps * 3.6 : null;
  const hours = speedKmh && speedKmh > 80 ? left / speedKmh : null;
  const eta = hours === null ? '' : durationText(Math.max(1, hours * 60));
  return { share: Math.min(1, Math.max(0, share)), eta };
});

// Each airport's city and state (or country), from its position, for the
// ends of the route.
const routePlaces = ref({ from: '', to: '' });
async function airportPlace(airport) {
  if (!airport) return '';
  try {
    const found = await nearestCity(airport.lat, airport.lon);
    const city = airport.name || found?.name || '';
    const region = countryName(found?.country);
    return [city, region].filter(Boolean).join(', ');
  } catch {
    return airport.name || '';
  }
}
watch(
  () => `${card.value?.route?.fromAt?.code}|${card.value?.route?.toAt?.code}`,
  async () => {
    const route = card.value?.route;
    routePlaces.value = { from: route?.fromAt?.name || '', to: route?.toAt?.name || '' };
    if (!route?.fromAt || !route?.toAt) return;
    const [from, to] = await Promise.all([airportPlace(route.fromAt), airportPlace(route.toAt)]);
    // Only for the same route still: another flight from the same airport
    // may have taken the card meanwhile.
    const now = card.value?.route;
    if (now?.fromAt?.code === route.fromAt.code && now?.toAt?.code === route.toAt.code) routePlaces.value = { from, to };
  },
  { immediate: true },
);
// Without a route to draw along, an aircraft keeps its altitude trace.
const altitudeTrace = computed(() => card.value?.kind === 'aircraft' && Number.isFinite(card.value?.altitudeM) && !routeProgress.value);

const kindLabel = computed(() => (card.value ? t(card.value.kind) : ''));
// The mark before the kind line: the sprite the map draws the item with.
const cardMark = computed(() => (card.value ? markKind(card.value.layerId, card.value) : ''));
// What it is, then the layer it came from, unless the layer's name already
// says what it is ("fire perimeter · Fire Perimeters").
const kindLine = computed(() => {
  const current = card.value;
  if (!current) return '';
  if (current.layerId === PLACE_LAYER)
    return current.place?.airport ? t('Place · airport') : current.place?.from === 'spot' ? t('Place · spot') : t('Place · from search');
  const layer = current.layerName || '';
  const plain = (words) => words.toLowerCase().replace(/s\b/g, '');
  const shown = shownLayerName(layer, current.layerId);
  return plain(layer).includes(plain(current.kind)) ? shown : `${kindLabel.value} · ${shown}`;
});

// The buttons, two at most plus the Ask icon. The item's own first-person
// view (Cockpit, Orbital view, Bridge view, Cab view) leads where it can be
// entered; then Follow for what can be followed (aircraft, satellites), Fly
// to otherwise. The Ask icon opens the Chat with this item attached.
const leadAction = computed(() => (store.canCockpit() ? 'cockpit' : store.canFollow() ? 'follow' : 'fly'));
// The lead names the view it enters: an aircraft's cockpit, a satellite's
// orbital view, a vessel's bridge, a train's or a bus's cab.
const RIDE_FACES = {
  flights: { icon: 'flight', label: msg('Enter Cockpit') },
  military: { icon: 'flight', label: msg('Enter Cockpit') },
  satellites: { icon: 'satellite_alt', label: msg('Orbital view') },
  'ais-live-vessels': { icon: 'directions_boat', label: msg('Bridge view') },
};
const CAB_VIEW = { icon: 'train', label: msg('Cab view') };
const cockpitStore = useCockpitStore();
const rideFace = computed(() => {
  const current = card.value;
  const presence = cockpitStore.presence;
  const known = RIDE_FACES[current?.layerId];
  if (!known && presence?.entryFace?.label && presence.entryLayerId === current?.layerId && presence.entryId === String(current?.identity?.id)) return presence.entryFace;
  const face = known || CAB_VIEW;
  return { icon: face.icon, label: t(face.label) };
});

// A new item starts at the top of the panel, not wherever the last one was
// scrolled to.
const detailsKey = ref(card.value?.key);
watch(
  [() => card.value?.key, () => store.selectionGeneration()],
  async ([key, generation], [previous, priorGeneration]) => {
    if (!key || key === previous || generation === priorGeneration) return;
    detailsKey.value = key;
    await nextTick();
    document
      .getElementById('entity-card')
      ?.closest('[data-rail-scroller]')
      ?.scrollTo({ top: 0, behavior: 'smooth' });
  },
);
</script>


<template>
  <Transition name="entity-card">
    <section v-if="card" id="entity-card" class="entity-card" :aria-label="t('Selected on the map')" :data-layer="card.layerId" :data-kind="card.kind">
      <!-- The hero leads: what the item looks like, then what it does. -->
      <EntityPreview :card="card" :title="shownTitle" :swath-km="swath?.km ?? null" :position-withheld="locationWithheld">
        <template #placeholder>
          <div class="entity-hero__placeholder" :class="{ 'entity-hero__placeholder--bare': !tiles.length }">
            <UiIcon class="entity-hero__glyph" :name="card.icon" :size="null" />
            <span class="entity-hero__kind">{{ kindLabel }}</span>
          </div>
        </template>
        <template #default>
          <header class="entity-card__head">
            <div class="entity-card__name">
              <span class="entity-card__kind"><EntityMark :layer="card.layerId" :kind="cardMark" :icon="card.icon" :size="14" /> {{ kindLine }}</span>
              <h3 class="entity-card__title">{{ shownTitle }}</h3>
              <span v-if="subtitle || card.countryCode" class="entity-card__subtitle" :title="subtitle || undefined">
                <span
                  v-if="card.countryCode && flag"
                  class="entity-card__flag"
                  :class="{ 'entity-card__flag--picture': flag.kind === 'flag' }"
                  :style="flag.style"
                  role="img"
                  :aria-label="flag.title || flag.label"
                  :title="flag.title || flag.label"
                >{{ flag.kind === 'badge' ? flag.label : '' }}</span>{{ subtitle }}
              </span>
              <span v-if="sourceLine" class="entity-card__source-line" :class="`entity-card__source-line--${sourceLine.tone}`">{{ sourceLine.text }}</span>
              <span v-if="card.obscured && position" class="entity-card__source-line entity-card__where">{{ position }}</span>
            </div>
            <UiButton v-if="away && card.moving" class="entity-card__find" data-entity-find :label="t('Find it')" :title="t('Find it')" :disabled="finding === 'finding'" @click="store.locate()"><UiIcon name="my_location" :size="null" /></UiButton>
            <UiCloseButton class="entity-card__close" glyph="icon" :label="t('Close card')" :title="t('Close card')" @click="store.clear({ dismiss: true })" />
          </header>

          <div v-if="card.warnings?.length" class="entity-card__warning" role="alert">
            <UiIcon name="warning" :size="null" />
            <span>{{ card.warnings.map((warning, index) => sayWords(card.warningWords?.[index], warning)).join(' · ') }}</span>
          </div>

          <div class="entity-card__actions">
            <UiButton v-if="leadAction === 'cockpit'" class="entity-card__action entity-card__action--primary entity-card__action--lead" data-entity-cockpit-entry @click="store.cockpit()">
              <UiIcon :name="rideFace.icon" :size="null" />{{ rideFace.label }}
            </UiButton>
            <div class="entity-card__action-row">
              <UiButton v-if="store.canFollow()" class="entity-card__action" :class="{ 'entity-card__action--primary': leadAction === 'follow' && !store.isFollowing() }" :pressed="Boolean(store.isFollowing())" pressed-class="entity-card__action--on" @click="store.follow()">
                <UiIcon name="navigation" :size="null" />{{ store.isFollowing() ? t('Following') : t('Follow') }}
              </UiButton>
              <UiButton v-else class="entity-card__action" :class="{ 'entity-card__action--primary': leadAction === 'fly' }" @click="flyTo">
                <UiIcon name="my_location" :size="null" />{{ t('Fly to') }}
              </UiButton>
              <!-- The chat bubble is no Material symbol the page loads, so it stays drawn. -->
              <UiButton class="entity-card__action entity-card__action--ask-icon" :label="t('Ask GEV about {name}', { name: shownTitle })" @click="store.ask(shownTitle)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
              </UiButton>
            </div>
          </div>
          <p class="entity-card__fly-note" role="status">{{ flyNote ? t(flyNote) : '' }}</p>

          <PlaceDetails v-if="isPlace && !contextNeedle" :key="`place:${card.key}`" :card="card" />

          <ReadingHero v-if="card.reading && !contextNeedle" :reading="card.reading" />

          <div v-if="tiles.length && !contextNeedle" class="entity-card__tiles" :style="{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }">
            <div v-for="tile in tiles" :key="tile.field" class="entity-card__tile" :title="[tile.number, tile.unit].filter(Boolean).join(' ')">
              <span>{{ tile.label }}</span>
              <strong>{{ tile.number }}<small v-if="tile.unit">{{ tile.unit }}</small></strong>
            </div>
          </div>

          <p v-if="acartiaCredit" class="entity-card__source">
            {{ acartiaCredit }} · {{ t('CC BY 4.0') }}
          </p>
          <div v-if="acartiaCredit || card.observationHref || card.wildlifeViewingGuidance" class="entity-card__attribution-links">
            <a v-if="acartiaCredit" href="https://acartia.io/" target="_blank" rel="noopener noreferrer">{{ t('Acartia') }} ↗</a>
            <a v-if="card.observationHref" :href="card.observationHref" target="_blank" rel="noopener noreferrer">{{ t('iNaturalist') }} ↗</a>
            <a v-if="card.wildlifeViewingGuidance" href="https://www.bewhalewise.org" target="_blank" rel="noopener noreferrer">{{ t('Be Whale Wise') }} ↗</a>
          </div>

          <RouteProfile
            v-if="routeProgress && !contextNeedle"
            :from="card.route.from"
            :to="card.route.to"
            :from-place="routePlaces.from"
            :to-place="routePlaces.to"
            :share="routeProgress.share"
            :altitude-m="lost ? null : card.altitudeM"
            :eta="routeProgress.eta"
          />
          <template v-else-if="card.route && !contextNeedle">
            <div class="entity-card__route" :class="{ 'entity-card__route--unverified': !card.route.verified }">
              <AirportLink :code="card.route.from" class="entity-card__route-end"><strong>{{ card.route.from }}</strong></AirportLink>
              <span class="entity-card__route-line" aria-hidden="true"><UiIcon name="flight" :size="null" /></span>
              <AirportLink :code="card.route.to" class="entity-card__route-end"><strong>{{ card.route.to }}</strong></AirportLink>
            </div>
            <p
              v-if="!card.route.verified"
              class="entity-card__route-note"
              :title="t('The scheduled route for this flight number does not match where the plane is; it may be another leg of the same flight.')"
            >
              <UiIcon name="warning" :size="null" />{{ t('Scheduled · unverified: does not match where the plane is') }}
            </p>
          </template>
          <AltitudeGraph v-if="altitudeTrace && !contextNeedle" :key="`altitude:${card.key}`" :altitude-m="lost ? null : card.altitudeM" :tick="tick" compact />

          <ItemCharts v-if="!contextNeedle" :card="card" :tick="tick" />

          <!-- Nearby, on every card; a satellite lists what is inside its swath. -->
          <SpotConditions
            v-if="!locationWithheld && Number.isFinite(card.lat) && Number.isFinite(card.lon)"
            :key="card.key"
            :lat="card.lat"
            :lon="card.lon"
            :exclude-key="card.key"
            :own-layer="card.layerId"
            :approximate="approximatePosition(card)"
            :with-contacts="props.withContacts"
            :swath-km="swath?.km ?? null"
            :settle-km="card.moving ? 25 : 1"
          />

          <!-- Facts only, folded; a search opens it to show what matches.
               Keyed by the item, so every new pick starts folded. -->
          <UiEmpty v-if="contextNeedle && !gridFacts.length && !extraFacts.length" class="entity-card__no-match" :title="t('Nothing in this item’s details matches “{text}”.', { text: contextSearchText.trim() })" />
          <details v-if="contextNeedle ? gridFacts.length || extraFacts.length : hasMore" :key="`more:${detailsKey}`" class="entity-card__section entity-card__more" :open="!!contextNeedle">
            <summary class="entity-card__more-title">{{ contextNeedle ? t('Matching details') : t('More details') }}</summary>
            <dl class="entity-card__facts">
              <div v-for="fact in gridFacts" :key="fact.field" class="entity-card__fact">
                <dt>{{ factLabel(fact) }}</dt>
                <dd :title="factValue(fact)">{{ factValue(fact) }}</dd>
              </div>
              <div v-for="fact in extraFacts" :key="`extra:${fact.label}`" class="entity-card__fact">
                <dt>{{ fact.label }}</dt>
                <dd :title="fact.ownerLabel ?? fact.value">
                  <span
                    v-if="fact.ownerLabel && flag?.kind === 'flag'"
                    class="entity-card__flag entity-card__flag--picture"
                    :style="flag.style"
                    aria-hidden="true"
                  ></span>{{ fact.ownerLabel ?? fact.value }}
                </dd>
              </div>
              <template v-if="!contextNeedle">
                <LocalConditions v-if="showLocal" :lat="card.lat" :lon="card.lon" />
                <div v-if="position && !card.obscured" class="entity-card__fact">
                  <dt>{{ t('Position') }}</dt>
                  <dd :title="position">{{ position }}</dd>
                </div>
                <div v-if="shownSource && !cameraFields.providerInRow" class="entity-card__fact">
                  <dt>{{ t('Data source') }}</dt>
                  <dd :title="shownSource">{{ shownSource }}</dd>
                </div>
              </template>
            </dl>
            <div v-if="!contextNeedle && card.links.length" class="entity-card__links">
              <a v-for="link in card.links" :key="link.kind" :href="link.href" target="_blank" rel="noopener noreferrer">{{ t(link.label) }} ↗</a>
            </div>
          </details>
        </template>
      </EntityPreview>
    </section>
  </Transition>
</template>
