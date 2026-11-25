import {
  airportCode,
  airportsNear,
  NEAR_AIRPORT_KM,
} from '../data/airports.js';
import {
  layerRecordsNear,
  recordKey,
  recordPosition,
  recordTitle,
} from '../data/entityContext.js';
import { mapStill } from './mapTiles.js';
import { msg } from '../i18n/marker.js';
import { t } from '../i18n/index.js';

/**
 * Places and spots in Context. A place picked from search
 * gets a card of its own; so does an airport, from the bundled OurAirports
 * pack, which is part of picking a place rather than a layer. A spot (a
 * click on empty ground, or a place) can be pinned as a still with a map.
 * A base is the Military Installations layer's own record and opens its
 * card; it is never copied here.
 */

/** The card store's layer id for places: not a layer anyone turns on. */
export const PLACE_LAYER = 'place';
/** The Military Installations layer, whose records are the bases. */
export const BASES_LAYER = 'military-installations';
/** How far an airport card looks for the flights coming and going. */
export const AIRPORT_TRAFFIC_KM = 50;

const fixed = (n) => (Number.isFinite(n) ? n.toFixed(4) : 'x');

/**
 * A place's identity for the card store and for its pin. An airport goes by
 * its code, so finding it again (search, a near link, a pin) is the same
 * card; any other place by where it is.
 * @param {{name?: string, lat: number, lon: number, from?: 'search'|'spot', airport?: object|null}} place
 */
export function placeIdentity({
  name = '',
  lat,
  lon,
  from = 'search',
  airport = null,
}) {
  const id = airport
    ? `airport:${airport.ident}`
    : `${fixed(lat)},${fixed(lon)}`;
  return {
    layerId: PLACE_LAYER,
    id,
    label: airport?.name || name || '',
    lat: airport ? airport.lat : lat,
    lon: airport ? airport.lon : lon,
    place: { from: airport ? 'airport' : from, airport: airport || null },
  };
}

/** The card key a place's identity makes. */
export const placeKey = (identity) => `${PLACE_LAYER}:${identity?.id || ''}`;

/** "30.2610, −97.7454": a spot's coordinates as its place line shows them. */
export function spotCoordinates(lat, lon, format = (n) => n.toFixed(4)) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';
  return `${format(lat)}, ${format(lon)}`;
}

/**
 * The card for a place, in the shape `describeEntity` gives every card, so
 * the card, its pin and Nearby treat it as any other item that stays put.
 * Its facts (an airport's codes, elevation and runways) go under More
 * details; the figures on top are the card's own (EntityCard).
 * @param {ReturnType<typeof placeIdentity>} identity
 */
export function describePlace(identity) {
  if (
    identity?.layerId !== PLACE_LAYER ||
    !Number.isFinite(identity.lat) ||
    !Number.isFinite(identity.lon)
  )
    return null;
  const place = identity.place || { from: 'search', airport: null };
  const airport = place.airport || null;
  const facts = [];
  if (airport) {
    const codes = [airport.iata, airport.ident].filter(Boolean).join(' · ');
    if (codes)
      facts.push({ field: 'codes', label: msg('Codes'), value: codes });
    if (airport.city)
      facts.push({ field: 'city', label: msg('City'), value: airport.city });
    if (Number.isFinite(airport.elevationFt))
      facts.push({
        field: 'elevation',
        label: msg('Elevation'),
        value: `${Math.round(airport.elevationFt * 0.3048)} m`,
        words: {
          text: '{n} m',
          values: { n: Math.round(airport.elevationFt * 0.3048) },
        },
      });
    if (airport.runways)
      facts.push({
        field: 'runways',
        label: msg('Runways'),
        value: String(airport.runways),
      });
  }
  const title = airport
    ? `${airport.name}${airportCode(airport) ? ` (${[airport.iata, airport.ident].filter(Boolean).join(' · ')})` : ''}`
    : identity.label || '';
  return {
    key: placeKey(identity),
    layerId: PLACE_LAYER,
    layerName: 'Places',
    kind: airport ? 'airport' : 'place',
    icon: airport ? 'local_airport' : 'location_on',
    moving: false,
    headline: [],
    title,
    // A spot without a name goes by what it is.
    titleWords: title ? null : { text: msg('Picked spot') },
    lat: identity.lat,
    lon: identity.lon,
    altitudeM: null,
    facts,
    warnings: [],
    warningWords: [],
    aircraftClass: null,
    modelSubject: null,
    photo: null,
    aircraftClassName: null,
    countryCode: null,
    insights: [],
    operator: null,
    heading: null,
    speedMps: null,
    route: null,
    links: [],
    source: airport ? t('OurAirports · bundled') : '',
    basis: 'place',
    identity: {
      layerId: PLACE_LAYER,
      id: identity.id,
      label: identity.label,
      lat: identity.lat,
      lon: identity.lon,
      place,
    },
    place,
  };
}

/**
 * What the flights layer has loaded around an airport (no new requests):
 * arriving, departing, and the other flights within AIRPORT_TRAFFIC_KM, each
 * nearest first. A flight whose route is known goes by it (bound for the
 * airport: arriving; from it: departing). Most loaded flights have no route
 * until they are picked, so one without is judged by how it moves, when it
 * is near enough to be this airport's (AIRPORT_GUESS_KM, below 10,000 ft
 * above the field, or on the ground within AIRPORT_GROUND_KM): descending,
 * or on the ground and slowing, is arriving; climbing away is departing;
 * anything else stays with the others. `guessed` counts those judged so,
 * and `unknown` those that report no altitude or climb or descent to judge
 * by, so a figure can be marked as an estimate, or left unsaid, rather than
 * read as exact.
 * @param {Array<{record: object, km: number}>} near From `recordsNear`.
 * @param {object} airport
 * @param {{slowing?: (record: object) => boolean}} [options] Whether a
 *   flight on the ground has slowed since it was last read (see
 *   `groundSpeedTrend`); never, without it.
 * @returns {{arriving: Array<{record: object, km: number, guessed?: boolean}>,
 *   departing: Array<{record: object, km: number, guessed?: boolean}>,
 *   other: Array<{record: object, km: number}>, guessed: number, unknown: number}}
 */
export function airportTraffic(near, airport, { slowing = () => false } = {}) {
  const codes = new Set(
    [airport?.iata, airport?.ident]
      .filter(Boolean)
      .map((code) => code.toUpperCase()),
  );
  const same = (code) => Boolean(code) && codes.has(String(code).toUpperCase());
  const arriving = [];
  const departing = [];
  const other = [];
  let guessed = 0;
  let unknown = 0;
  for (const entry of near || []) {
    const { record } = entry;
    if (same(record?.routeDestination)) arriving.push(entry);
    else if (same(record?.routeOrigin)) departing.push(entry);
    else if (record?.routeOrigin || record?.routeDestination) other.push(entry);
    else {
      const guess = guessTraffic(entry, airport, slowing);
      if (guess) guessed++;
      if (guess === 'unknown') unknown++;
      if (guess === 'arriving') arriving.push({ ...entry, guessed: true });
      else if (guess === 'departing')
        departing.push({ ...entry, guessed: true });
      else other.push(entry);
    }
  }
  return { arriving, departing, other, guessed, unknown };
}

/** How near an airport a flight without a route is judged as its traffic. */
export const AIRPORT_GUESS_KM = 30;
/** How near a flight on the ground is taken to be at this airport. */
export const AIRPORT_GROUND_KM = 5;
/** How high above the field a flight is still taken to be coming or going: 10,000 ft. */
const GUESS_CEILING_M = 3048;
/** A climb or descent this fast or faster counts: about 300 ft a minute. */
const CLIMB_MPS = 1.5;
/** Within this of the airport's point a climb is away from it whatever the heading. */
const LIFT_OFF_KM = 3;
/** A change in ground speed this large or larger counts as slowing or speeding up. */
const SPEED_STEP_MPS = 1;

/**
 * A routeless flight near an airport: 'arriving', 'departing', 'nearby'
 * (it moves, but neither way), 'unknown' (no altitude or climb or descent
 * to judge by), or null when it is too far or too high to be this
 * airport's.
 */
function guessTraffic({ record, km }, airport, slowing) {
  if (record?.onGround === true) {
    if (!(km <= AIRPORT_GROUND_KM)) return null;
    return slowing(record) ? 'arriving' : 'nearby';
  }
  if (!(km <= AIRPORT_GUESS_KM)) return null;
  const altitude = record?.altitudeM;
  const rate = record?.verticalRateMps;
  const fieldM = Number.isFinite(airport?.elevationFt)
    ? airport.elevationFt * 0.3048
    : 0;
  if (Number.isFinite(altitude) && altitude - fieldM > GUESS_CEILING_M)
    return null;
  if (!Number.isFinite(altitude) || !Number.isFinite(rate)) return 'unknown';
  if (rate <= -CLIMB_MPS) return 'arriving';
  if (rate >= CLIMB_MPS && movingAway(record, airport, km)) return 'departing';
  return 'nearby';
}

/** Whether a flight's heading takes it farther from the airport. */
function movingAway(record, airport, km) {
  if (km <= LIFT_OFF_KM) return true;
  const heading = record?.heading;
  const at = recordPosition(record);
  if (
    !Number.isFinite(heading) ||
    !Number.isFinite(at?.lat) ||
    !Number.isFinite(at?.lon) ||
    !Number.isFinite(airport?.lat) ||
    !Number.isFinite(airport?.lon)
  )
    return false;
  const rad = Math.PI / 180;
  const dLon = (at.lon - airport.lon) * rad;
  const y = Math.sin(dLon) * Math.cos(at.lat * rad);
  const x =
    Math.cos(airport.lat * rad) * Math.sin(at.lat * rad) -
    Math.sin(airport.lat * rad) * Math.cos(at.lat * rad) * Math.cos(dLon);
  const outward = Math.atan2(y, x) / rad;
  const off = Math.abs(((heading - outward + 540) % 360) - 180);
  return off < 90;
}

/**
 * Remembers each flight's ground speed between reads, so an airport card can
 * tell one on the ground that is slowing (just landed) from one taxiing or
 * parked. A flight keeps its trend until its speed moves by SPEED_STEP_MPS,
 * so reads between two polls of the same speed do not lose it.
 */
export function groundSpeedTrend() {
  const seen = new Map();
  const keyOf = (record) => String(record?.icao24 || record?.id || '');
  return {
    /** Note the speeds of the flights on the ground in `near`. */
    note(near) {
      const now = new Set();
      for (const { record } of near || []) {
        const key = keyOf(record);
        const speed = record?.speedMps;
        if (!key || record?.onGround !== true || !Number.isFinite(speed))
          continue;
        now.add(key);
        const was = seen.get(key);
        if (!was) seen.set(key, { speed, slowing: false });
        else if (Math.abs(speed - was.speed) >= SPEED_STEP_MPS)
          seen.set(key, { speed, slowing: speed < was.speed });
      }
      for (const key of seen.keys()) if (!now.has(key)) seen.delete(key);
    },
    /** Whether that flight's ground speed last moved down. */
    slowing(record) {
      return seen.get(keyOf(record))?.slowing === true;
    },
    clear() {
      seen.clear();
    },
  };
}

/**
 * The airport or base a spot is near (within NEAR_AIRPORT_KM), for the place
 * line's "near" link; the nearest of the two, or null. Airports come from
 * the bundled pack; bases only from what Military Installations has loaded,
 * so nothing is asked for.
 * @param {number} lat
 * @param {number} lon
 * @param {{recordsNear?: (layerId: string, lat: number, lon: number, km: number) => Array<{record: object, km: number}>, dataManager?: object}} [sources]
 *   The card store's `recordsNear`, or a data manager.
 * @returns {Promise<null|{kind: 'airport', airport: object, km: number}|{kind: 'base', identity: object, name: string, km: number}>}
 */
export async function nearSite(
  lat,
  lon,
  { recordsNear = null, dataManager = null } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const [airport] = await airportsNear(lat, lon, NEAR_AIRPORT_KM);
  let base = null;
  try {
    const [found] = recordsNear
      ? recordsNear(BASES_LAYER, lat, lon, NEAR_AIRPORT_KM)
      : layerRecordsNear(
          dataManager,
          BASES_LAYER,
          { lat, lon },
          NEAR_AIRPORT_KM,
        );
    if (found) base = found;
  } catch {
    base = null;
  }
  const baseName = base ? recordTitle(base.record) : '';
  if (base && baseName && (!airport || base.km < airport.distanceKm)) {
    const at = recordPosition(base.record);
    return {
      kind: 'base',
      name: baseName,
      km: base.km,
      identity: {
        layerId: BASES_LAYER,
        id: base.record.id,
        label: baseName,
        lat: at.lat,
        lon: at.lon,
      },
    };
  }
  return airport ? { kind: 'airport', airport, km: airport.distanceKm } : null;
}

/**
 * A pin for a place: a still with a map, its name and where it is. Tapping
 * it flies there (the card store's `open`).
 * @param {ReturnType<typeof placeIdentity>} identity
 * @param {string} title
 */
export function placePin(identity, title) {
  return {
    key: placeKey(identity),
    kind: 'place',
    title,
    icon: identity.place?.airport ? 'local_airport' : 'location_on',
    identity,
    still: mapStill(identity.lat, identity.lon),
  };
}

/**
 * The view itself as a pin, from Context's place header: the camera as it
 * is (position, heading, pitch, roll) and the place's name, so its tile
 * flies back to the same view. Made from what the header already has: no
 * request.
 * @param {{center: {lat: number, lon: number}, pose: object}} view
 * @param {string} name The place header's name.
 */
export function viewPin(view, name) {
  const { center, pose } = view || {};
  if (!center || ![pose?.lat, pose?.lon, pose?.height].every(Number.isFinite))
    return null;
  const at = `${fixed(center.lat)},${fixed(center.lon)}`;
  return {
    key: `view:${at}@${Math.round(pose.height)}`,
    kind: 'view',
    title: name,
    icon: 'location_on',
    identity: {
      layerId: 'view',
      id: at,
      label: name,
      lat: center.lat,
      lon: center.lon,
    },
    pose: {
      lon: pose.lon,
      lat: pose.lat,
      height: pose.height,
      heading: pose.heading,
      pitch: pose.pitch,
      roll: pose.roll,
    },
    still: mapStill(center.lat, center.lon),
  };
}

/**
 * A loaded flight as a Nearby row (NearbyLists' shape), so a tap opens its
 * card like any other row.
 * @param {string} layerId
 * @param {{record: object, km: number}} entry
 */
export function nearbyRow(layerId, { record, km }) {
  const key = recordKey(layerId, record);
  return {
    key,
    layerId,
    title: recordTitle(record) || key,
    distanceKm: km,
    identity: {
      layerId,
      id: key.slice(layerId.length + 1),
      label: recordTitle(record),
      ...recordPosition(record),
      record,
    },
  };
}
