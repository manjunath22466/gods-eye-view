<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatDate, formatNumber, msg, t, translateKnown } from '../../../i18n/index.js';
import { durationText } from '../../contextTime.js';
import { factFigure, factLabel, factValue, sayWords, useEntityCardStore } from '../../stores/entityCard.js';
import EntityPreview from './EntityPreview.vue';
import AltitudeGraph from './AltitudeGraph.vue';
import RouteProfile from './RouteProfile.vue';
import AirportLink from './AirportLink.vue';
import LocalConditions from './LocalConditions.vue';
import { contextNeedle, contextSearchText, matchesContextSearch } from '../../contextSearch.js';
import { useCctvStore } from '../../stores/cctv.js';
import { useDockedStore } from '../../stores/docked.js';
import SpotConditions from './SpotConditions.vue';
import { shownLayerName } from '../../layerNames.js';
import { countryName, nearestCity } from '../../../data/wikidataCities.js';
import { flagEmoji } from '../../../data/aircraftCountry.js';
import { compassName } from '../../spotConditions.js';
import { satelliteSwath } from '../../satelliteSwath.js';
import ItemCharts from './ItemCharts.vue';
import EntityMark from './EntityMark.vue';
import { markKind } from '../../entityMark.js';
import { usePinnedStore } from '../../stores/pinned.js';
import { PLACE_LAYER, placePin } from '../../placeCard.js';
import { mapStill } from '../../mapTiles.js';
import PlaceDetails from './PlaceDetails.vue';
import { captureFrameStill } from '../../frameStill.js';
import { cameraSource } from '../../cameraCredit.js';
import UiButton from '../../kit/UiButton.vue';
import UiCloseButton from '../../kit/UiCloseButton.vue';
import UiEmpty from '../../kit/UiEmpty.vue';
import UiIcon from '../../kit/UiIcon.vue';
import { useCockpitStore } from '../../stores/cockpit.js';
import { rideFaceFor } from '../../rideFace.js';

// The Context panel's card for one thing on the map. Every card is the same
// card, in one order: its top image, then its name with one small line on
// where the data comes from and how old it is, the buttons, its key live
// numbers, how it is changing, what is nearby, and the facts folded under
// More details. It reads from the entity card store, which the globe click,
// the omnibar and the nearby lists all fill.
defineProps({ embedded: Boolean });
const store = useEntityCardStore();
const { card, lost, tick, fromPin, away, finding, located } = storeToRefs(store);
// A place or an airport: its own card parts.
const isPlace = computed(() => card.value?.layerId === PLACE_LAYER);
// Cameras carry only an id; the CCTV panel's store knows the picked one's name.
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

// How old a reading is, its number in the locale's digits.
function ago(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return t('{n} s ago', { n: formatNumber(seconds) });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('{n} min ago', { n: formatNumber(minutes) });
  const hours = Math.round(minutes / 60);
  if (hours < 48) return t('{n} h ago', { n: formatNumber(hours) });
  return t('{n} d ago', { n: formatNumber(Math.round(hours / 24)) });
}

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
  if (streetPhoto.value) {
    const text = [streetPhoto.value.provider, streetPhoto.value.captured].filter(Boolean).join(' · ');
    return text ? { tone: 'aged', text } : null;
  }
  // A camera: who runs it (with the owner a partner-supplied feed names), and
  // how old the frame on show is.
  if (camera.value) {
    const age = frameAt.value ? ago(Date.now() - frameAt.value) : '';
    const text = [camera.value.provider || source.value, camera.value.credit, age].filter(Boolean).join(' · ');
    return text ? { tone: cameraLive.value ? 'live' : 'aged', text } : null;
  }
  // Finding it again (Find it): the lookup under way, its miss, or the
  // reading it found on the item's own track and how old that is.
  if (finding.value === 'finding') return { tone: 'aged', text: [source.value, t('Finding it…')].filter(Boolean).join(' · ') };
  if (finding.value === 'none') return { tone: 'lost', text: [source.value, t('No reading at this time')].filter(Boolean).join(' · ') };
  if (lost.value && located.value) {
    const found = t('Last reading · {age}', { age: ago(Math.max(0, located.value.atMs - located.value.observedAtMs)) });
    return { tone: 'aged', text: [source.value, found].filter(Boolean).join(' · ') };
  }
  const age = Number.isFinite(current.observedAgeMs) ? ago(current.observedAgeMs) : '';
  if (lost.value) return { tone: 'lost', text: [source.value, t('out of feed · last reading')].filter(Boolean).join(' · ') };
  const fresh = current.moving && Number.isFinite(current.observedAgeMs) && current.observedAgeMs < 120_000;
  const text = [source.value, age].filter(Boolean).join(' · ');
  return text ? { tone: fresh ? 'live' : 'aged', text } : null;
});

const position = computed(() => {
  const current = card.value;
  if (!Number.isFinite(current?.lat) || !Number.isFinite(current?.lon)) return '';
  const lat = `${Math.abs(current.lat).toFixed(3)}°${current.lat >= 0 ? 'N' : 'S'}`;
  const lon = `${Math.abs(current.lon).toFixed(3)}°${current.lon >= 0 ? 'E' : 'W'}`;
  return `${lat}  ${lon}`;
});

// A satellite: its orbit as a figure, the swath it sees, and who launched
// it, when and what it is, from the layer's catalog records.
const satellite = computed(() => {
  void tick.value;
  const current = card.value;
  return current?.kind === 'satellite' && current.identity?.id ? store.satellite(current.identity.id) : null;
});
const acartiaCredit = computed(() => {
  const provider = card.value?.acartiaProvider;
  if (!provider?.name) return '';
  const { name, entity } = provider;
  return entity ? t('Reported by {name} ({entity})', { name, entity }) : t('Reported by {name}', { name });
});
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
    { label: t('Launched by'), value: found.owner ? `${flagEmoji(found.ownerCountryCode)} ${found.owner}`.trim() : '' },
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
// kept while its layer is off so a pinned photo still describes itself.
const streetPhoto = computed(() => {
  void tick.value;
  const current = card.value;
  if (current?.layerId !== 'street-level' || !current.identity?.id) return null;
  const record = store.layerModule('street-level')?.photo?.(current.identity.id);
  if (!record) return null;
  const at = record.capturedAt;
  const captured = Number.isFinite(at)
    ? formatDate(at, { year: 'numeric', month: 'short', ...(record.capturedAtPrecision === 'month' ? {} : { day: 'numeric' }), timeZone: 'UTC' })
    : '';
  return {
    provider: record.provider ? translateKnown(record.provider) : '',
    captured,
    heading: Number.isFinite(record.headingDeg) ? `${formatNumber(Math.round(((record.headingDeg % 360) + 360) % 360))}° ${t(compassName(record.headingDeg))}` : '',
    type: record.pano ? t('360° panorama') : t('Flat photo'),
  };
});
const streetFacts = computed(() => {
  const found = streetPhoto.value;
  if (!found) return [];
  return [
    { label: t('Provider'), value: found.provider },
    { label: t('Captured'), value: found.captured },
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
const cameraLive = computed(() => {
  const f = cctvFrame.value;
  return Boolean(f && f.cameraId === card.value?.identity?.id && (f.src || f.currentSrc) && !f.error);
});
// When the picked camera's frame last changed, for the source line's age.
const frameAt = ref(0);
watch(
  () => {
    const f = cctvFrame.value;
    return f && f.cameraId === card.value?.identity?.id ? f.src || f.currentSrc || '' : '';
  },
  (src) => (frameAt.value = src ? Date.now() : 0),
  { immediate: true },
);
const docked = useDockedStore();
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
  const facing = field('facing', t('Facing'), Number.isFinite(found.headingDeg) ? t(compassName(found.headingDeg)) : '');
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
const cameraFacts = computed(() => cameraFields.value.facts);
// Dock, a button on a camera's card: the camera's
// live view stays bottom right while other things are inspected. Pressed
// while this camera is docked; pressing again undocks. A flight's cockpit
// view keeps its dock icon on the image, its row being full.
// A street-level photo docks the same way: the photo itself moves into the
// dock while another card shows (streetLevelViewerPlacement.js).
const DOCK_KINDS = { cctv: 'camera', 'street-level': 'street' };
const cameraDockKey = computed(() => (DOCK_KINDS[card.value?.layerId] ? card.value.key : ''));
const cameraDocked = computed(() => Boolean(cameraDockKey.value && docked.isDocked(cameraDockKey.value)));
function toggleCameraDock() {
  const current = card.value;
  const kind = DOCK_KINDS[current?.layerId];
  if (!current?.identity?.id || !kind) return;
  const identity = { layerId: current.layerId, id: current.identity.id };
  // A photo reopens where it was taken, from the dock's ⤢; a camera keeps its
  // name and place as a pin does, so its card opens even with Cameras off.
  if (kind === 'street') Object.assign(identity, { lat: current.lat, lon: current.lon });
  if (kind === 'camera') Object.assign(identity, { label: shownTitle.value, lat: current.lat, lon: current.lon });
  // A camera's dock keeps who its feed is from, to credit it with Cameras off.
  const source = kind === 'camera' ? cameraSource(store.cameraDetails(current.identity.id)) : null;
  docked.toggle({ key: current.key, kind, title: shownTitle.value, identity, ...(source && { source }) });
}

// Pin: the item goes to the Pinned tab as a still: a camera's
// frame as it is now, a photo's picture, a place's map, or the map where a
// moving item is now. Nothing on Pinned refreshes it. The card stays on
// Inspect.
const pinned = usePinnedStore();
const isPinned = computed(() => Boolean(card.value && pinned.isPinned(card.value.key)));
function stillFor(current) {
  // A camera's still is saved from its frame once it is pinned (frameStill.js).
  if (current.layerId === 'cctv') return '';
  if (current.layerId === 'street-level') return store.layerModule('street-level')?.photo?.(current.identity?.id)?.still || '';
  return Number.isFinite(current.lat) && Number.isFinite(current.lon) ? mapStill(current.lat, current.lon) : '';
}
function togglePin() {
  const current = card.value;
  if (!current) return;
  if (pinned.isPinned(current.key)) return pinned.unpin(current.key);
  if (current.layerId === PLACE_LAYER) return pinned.pin(placePin(current.identity, shownTitle.value));
  pinned.pin({
    key: current.key,
    kind: DOCK_KINDS[current.layerId] || 'item',
    title: shownTitle.value,
    icon: current.icon,
    // The sprite its tile wears (EntityMark.vue), as the map draws it now.
    mark: markKind(current.layerId, current),
    still: stillFor(current),
    // Who a camera's feed is from, credited on its tile (cameraCredit.js).
    ...(current.layerId === 'cctv' && { source: cameraSource(store.cameraDetails(current.identity?.id)) }),
    identity: {
      layerId: current.layerId,
      id: current.identity?.id,
      label: shownTitle.value,
      lat: current.lat,
      lon: current.lon,
    },
  });
  // A camera's pin keeps the frame as it is now, saved once, small: it never
  // changes or asks the camera again. Its card's own image (or video) gives
  // it; otherwise the frame is read once.
  if (current.layerId === 'cctv') {
    const key = current.key;
    void cameraShown(key, String(current.identity?.id || '')).then((shown) =>
      captureFrameStill({ shown, url: store.cameraFrame(current.identity?.id)?.url || '' }).then((still) => {
        if (still) pinned.setStill(key, still);
      }),
    );
  }
}

// What the card's top image shows of a camera: its frame, or its live
// video's canvas once that has drawn a frame. A pin made while the video is
// still connecting waits a moment for its first frame, never saving a black
// still; past that, the camera's frame is read once instead. Another camera
// picked meanwhile draws on the same canvas, so its picture is never saved
// under this pin: the frame is read instead.
const PIN_FRAME_WAIT_MS = 6000;
const drawn = () => cctv.liveState === 'playing' || cctv.liveState === 'stalled';
const stillShowing = (key, cameraId) => card.value?.key === key && String(cctv.view?.activeCameraId || '') === cameraId;
async function cameraShown(key, cameraId) {
  const find = (selector) => globalThis.document?.querySelector?.(`#entity-card ${selector}`) || null;
  const image = find('.cctv-preview__frame img');
  if (image) return image;
  if (!find('.cctv-preview__video canvas')) return null;
  if (!drawn() && cctv.liveState === 'waiting') {
    await new Promise((resolve) => {
      let stop = null;
      const done = () => {
        clearTimeout(timer);
        stop?.();
        resolve();
      };
      const timer = setTimeout(done, PIN_FRAME_WAIT_MS);
      stop = watch(() => cctv.liveState, (next) => next !== 'waiting' && done());
    });
  }
  return drawn() && stillShowing(key, cameraId) ? find('.cctv-preview__video canvas') : null;
}

// An aircraft's flag, where its registration country can be told.
const flag = computed(() => {
  const code = card.value?.countryCode;
  if (!code) return null;
  let name = code;
  try {
    name = new Intl.DisplayNames([document.documentElement.lang || 'en'], { type: 'region' }).of(code) || code;
  } catch {
    name = code;
  }
  return { emoji: flagEmoji(code), name };
});

// The key numbers: the live figures the item's kind leads with (how high,
// how fast and which way for an aircraft; a quake's
// magnitude and depth; a fire's power), four at most, updated in place.
const tiles = computed(() => {
  const facts = card.value?.facts || [];
  const figures = (card.value?.headline || [])
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
  if (current.layerId === 'street-level')
    return Number.isFinite(current.lat) && Number.isFinite(current.lon) ? `${formatNumber(current.lat, { maximumFractionDigits: 5 })}, ${formatNumber(current.lon, { maximumFractionDigits: 5 })}` : '';
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
  if (card.value?.layerId === 'street-level') return [];
  const facts = card.value?.facts || [];
  if (contextNeedle.value) return facts.filter((fact) => matchesContextSearch(factLabel(fact), factValue(fact), fact.value));
  const shown = new Set(tiles.value.map((tile) => tile.field));
  return facts.filter(
    (fact) =>
      !shown.has(fact.field) &&
      !(card.value?.operator && fact.field === 'operator') &&
      !(card.value?.aircraftClass && fact.field === 'aircraftClass'),
  );
});
// Things that stay put also get the weather there and its local time.
// A place shows its weather and local time on top already.
const showLocal = computed(() => !isPlace.value && !card.value?.moving && Number.isFinite(card.value?.lat) && Number.isFinite(card.value?.lon));
const hasMore = computed(
  () => gridFacts.value.length || streetFacts.value.length || launchFacts.value.length || cameraFacts.value.length || showLocal.value || position.value || card.value?.links?.length,
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

// The buttons, three at most and one Ask icon. The item's own first-person
// view (Cockpit, Orbital view, Bridge view, Cab view) leads where it can be
// entered; then Follow for what can be followed (aircraft, satellites), Fly
// to otherwise. The Ask icon opens the Chat with this item attached.
const leadAction = computed(() => (store.canCockpit() ? 'cockpit' : store.canFollow() ? 'follow' : 'fly'));
// The lead names the view it enters: an aircraft's cockpit, a satellite's
// orbital view, a vessel's bridge, a subject provider's own face, or a
// train's or a bus's cab (rideFace.js).
const cockpitStore = useCockpitStore();
const rideFace = computed(() => rideFaceFor(card.value, cockpitStore.presence));
</script>


<template>
  <Transition name="entity-card">
    <section v-if="card" id="entity-card" class="entity-card" :aria-label="t('Selected on the map')" :data-layer="card.layerId" :data-kind="card.kind">
      <!-- The hero leads: what the item looks like, then what it does. -->
      <EntityPreview :card="card" :title="shownTitle" :swath-km="swath?.km ?? null">
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
              <span v-if="subtitle || flag" class="entity-card__subtitle" :title="subtitle || undefined"><span v-if="flag" class="entity-card__flag" role="img" :aria-label="flag.name" :title="flag.name">{{ flag.emoji }}</span>{{ subtitle }}</span>
              <span v-if="sourceLine" class="entity-card__source-line" :class="`entity-card__source-line--${sourceLine.tone}`">{{ sourceLine.text }}</span>
            </div>
            <UiButton v-if="away && card.moving" class="entity-card__find" data-entity-find :label="t('Find it')" :title="t('Find it')" :disabled="finding === 'finding'" @click="store.locate()"><UiIcon name="my_location" :size="null" /></UiButton>
            <UiCloseButton v-if="!embedded" class="entity-card__close" glyph="icon" :label="t('Close card')" :title="t('Close card')" @click="store.clear({ dismiss: true })" />
          </header>

          <div v-if="card.warnings?.length" class="entity-card__warning" role="alert">
            <UiIcon name="warning" :size="null" />
            <span>{{ card.warnings.map((warning, index) => sayWords(card.warningWords?.[index], warning)).join(' · ') }}</span>
          </div>

          <div class="entity-card__actions">
            <UiButton v-if="leadAction === 'cockpit'" class="entity-card__action entity-card__action--primary entity-card__action--lead" data-entity-cockpit-entry @click="store.cockpit()">
              <UiIcon :name="rideFace.icon" :size="null" />{{ t(rideFace.label) }}
            </UiButton>
            <div class="entity-card__action-row">
              <UiButton v-if="store.canFollow()" class="entity-card__action" :class="{ 'entity-card__action--primary': leadAction === 'follow' && !store.isFollowing() }" :pressed="Boolean(store.isFollowing())" pressed-class="entity-card__action--on" @click="store.follow()">
                <UiIcon name="navigation" :size="null" />{{ store.isFollowing() ? t('Following') : t('Follow') }}
              </UiButton>
              <UiButton v-else class="entity-card__action" :class="{ 'entity-card__action--primary': leadAction === 'fly' }" @click="flyTo">
                <UiIcon name="my_location" :size="null" />{{ t('Fly to') }}
              </UiButton>
              <UiButton class="entity-card__action entity-card__action--pin" :pressed="isPinned" pressed-class="entity-card__action--on" :title="isPinned ? t('Unpin from the Pinned tab') : t('Pin to the Pinned tab')" @click="togglePin">
                <UiIcon name="keep" :size="null" />{{ isPinned ? t('Pinned') : t('Pin') }}
              </UiButton>
              <UiButton v-if="cameraDockKey" class="entity-card__action entity-card__action--dock" :pressed="cameraDocked" pressed-class="entity-card__action--on" :title="t('Dock this view bottom right')" @click="toggleCameraDock">
                <UiIcon name="picture_in_picture_alt" :size="null" />{{ cameraDocked ? t('Docked') : t('Dock') }}
              </UiButton>
              <!-- The chat bubble is no Material symbol the page loads, so it stays drawn. -->
              <UiButton class="entity-card__action entity-card__action--ask-icon" :label="t('Ask GEV about {name}', { name: shownTitle })" @click="store.ask(shownTitle)">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 5h16v11H9l-5 4z" /></svg>
              </UiButton>
            </div>
          </div>
          <p class="entity-card__fly-note" role="status">{{ flyNote ? t(flyNote) : '' }}</p>

          <PlaceDetails v-if="isPlace && !contextNeedle" :key="`place:${card.key}`" :card="card" />

          <div v-if="tiles.length && !contextNeedle" class="entity-card__tiles" :style="{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }">
            <div v-for="tile in tiles" :key="tile.field" class="entity-card__tile" :title="[tile.number, tile.unit].filter(Boolean).join(' ')">
              <span>{{ tile.label }}</span>
              <strong>{{ tile.number }}<small v-if="tile.unit">{{ tile.unit }}</small></strong>
            </div>
          </div>

          <p v-if="acartiaCredit" class="entity-card__source">
            {{ acartiaCredit }} · {{ t('CC BY 4.0') }}
          </p>
          <div v-if="acartiaCredit" class="entity-card__attribution-links">
            <a href="https://acartia.io/" target="_blank" rel="noopener noreferrer">{{ t('Acartia') }} ↗</a>
            <a href="https://www.bewhalewise.org" target="_blank" rel="noopener noreferrer">{{ t('Be Whale Wise') }}</a>
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
            v-if="Number.isFinite(card.lat) && Number.isFinite(card.lon) && !(isPlace && fromPin)"
            :key="card.key"
            :lat="card.lat"
            :lon="card.lon"
            :exclude-key="card.key"
            :own-layer="card.layerId"
            :swath-km="swath?.km ?? null"
            :settle-km="card.moving ? 25 : 1"
          />

          <!-- Facts only, folded; a search opens it to show what matches.
               Keyed by the item, so every new pick starts folded. -->
          <UiEmpty v-if="contextNeedle && !gridFacts.length && !streetFacts.length" class="entity-card__no-match" :title="t('Nothing in this item’s details matches “{text}”.', { text: contextSearchText.trim() })" />
          <details v-if="contextNeedle ? gridFacts.length || streetFacts.length : hasMore" :key="`more:${card.key}`" class="entity-card__section entity-card__more" :open="!!contextNeedle">
            <summary class="entity-card__more-title">{{ contextNeedle ? t('Matching details') : t('More details') }}</summary>
            <dl class="entity-card__facts">
              <div v-for="fact in gridFacts" :key="fact.field" class="entity-card__fact">
                <dt>{{ factLabel(fact) }}</dt>
                <dd :title="factValue(fact)">{{ factValue(fact) }}</dd>
              </div>
              <div v-for="fact in streetFacts" :key="`street:${fact.label}`" class="entity-card__fact">
                <dt>{{ fact.label }}</dt>
                <dd :title="fact.value">{{ fact.value }}</dd>
              </div>
              <template v-if="!contextNeedle">
                <div v-for="fact in launchFacts" :key="`launch:${fact.label}`" class="entity-card__fact">
                  <dt>{{ fact.label }}</dt>
                  <dd :title="fact.value">{{ fact.value }}</dd>
                </div>
                <div v-for="fact in cameraFacts" :key="`camera:${fact.label}`" class="entity-card__fact">
                  <dt>{{ fact.label }}</dt>
                  <dd :title="fact.value">{{ fact.value }}</dd>
                </div>
                <LocalConditions v-if="showLocal" :lat="card.lat" :lon="card.lon" />
                <div v-if="position" class="entity-card__fact">
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
