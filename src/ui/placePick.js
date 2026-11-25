import {
  distanceKm,
  findAirport,
  foldName,
  isAirportCountryCode,
} from '../data/airports.js';
import {
  layerRecordsNear,
  recordPosition,
  recordTitle,
} from '../data/entityContext.js';
import { BASES_LAYER, placeIdentity } from './placeCard.js';
import { useEntityCardStore } from './stores/entityCard.js';
import { PLACE_PICK_EVENT } from './contextEvents.js';

/** How far from where a search landed a base it names may be. */
const BASE_MATCH_KM = 5;
/** How near an airport a search for its bare code must land. */
const CODE_LANDED_KM = 100;
/** How near a picked spot an airport must be for the spot to be the airport. */
const AT_AIRPORT_KM = 5;

/**
 * The card a found search opens: an airport the line names (its
 * code, or its name with "airport") from the bundled pack; a base the line
 * names that Military Installations has loaded near where the search
 * landed; else the place itself, with the name the search found. A picked
 * spot (`picked`: a row that named its own place and position) opens an
 * airport only when it is at the airport, or names an airport near it, so
 * "SFO" in Tølløse opens Tølløse.
 * @param {{query: string, label?: string, lat: number, lon: number, picked?: boolean}} found
 * @param {{dataManager?: object, findAirport?: (query: string) => Promise<object|null>}} [deps]
 * @returns {Promise<{identity: object, fly: boolean}|null>}
 */
export async function placeForSearch(
  { query, label, lat, lon, picked = false },
  { dataManager = null, findAirport: lookUp = findAirport } = {},
) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const airport = await lookUp(query, { lat, lon });
  // Keep the geocoded place for a country code when its matching airport
  // is far away. Other large airports can still be found by bare code.
  // A row with its own coordinates names an airport only near it.
  const away = airport
    ? distanceKm(lat, lon, airport.lat, airport.lon)
    : Infinity;
  const named = /\b(airport|airfield|aerodrome)\b/i.test(String(label || ''));
  const codeHolds = picked
    ? away <= AT_AIRPORT_KM || (named && away <= CODE_LANDED_KM)
    : (airport?.size === 'large' && !isAirportCountryCode(query)) ||
      away <= CODE_LANDED_KM;
  if (airport && codeHolds)
    return { identity: placeIdentity({ airport }), fly: true };
  const words = foldName(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 2);
  if (words.length) {
    let bases = [];
    try {
      bases = layerRecordsNear(
        dataManager,
        BASES_LAYER,
        { lat, lon },
        BASE_MATCH_KM,
      );
    } catch {
      bases = [];
    }
    const base = bases.find(({ record }) => {
      const name = foldName(recordTitle(record));
      return words.every((word) => name.includes(word));
    });
    if (base) {
      const at = recordPosition(base.record);
      return {
        identity: {
          layerId: BASES_LAYER,
          id: base.record.id,
          label: recordTitle(base.record),
          lat: at.lat,
          lon: at.lon,
        },
        fly: false,
      };
    }
  }
  return {
    identity: placeIdentity({ name: label || query, lat, lon, from: 'search' }),
    fly: false,
  };
}

export { PLACE_PICK_EVENT };

/**
 * Announce a place pick. With no coordinates, the location search's own
 * result for the same query places it. Coordinates without a query are a
 * picked spot; `airport` is the code of the airport a row named.
 * @param {{name?: string, latitude?: number, longitude?: number, query?: string, airport?: string, isCurrent?: () => boolean}} place
 */
export function announcePlacePick(place) {
  if (typeof CustomEvent !== 'function') return;
  globalThis.document?.dispatchEvent?.(
    new CustomEvent(PLACE_PICK_EVENT, { detail: { ...place } }),
  );
}

const finiteNumber = (value) =>
  value !== null && value !== '' && Number.isFinite(Number(value))
    ? Number(value)
    : null;

/**
 * Open a place's card in Context when a place is picked (PLACE_PICK_EVENT).
 * A location search alone opens nothing; its last result places a pick that
 * named only its query. Routing stays here, outside the omnibar.
 * @param {object} options
 * @param {object} options.pinia
 * @param {(listener: Function) => (() => void)} [options.subscribe] The
 *   location search's state channel (`subscribeLocationSearch`).
 * @param {(listener: Function) => (() => void)} [options.subscribeCameraHandoff]
 *   Invalidates pending picks when a newer navigation takes the camera.
 * @param {() => object} options.getDataManager
 * @param {EventTarget} [options.target] Where picks are announced.
 * @param {() => void} [options.creditAirports] Called when an airport's card
 *   opens (the bundled OurAirports pack's courtesy credit).
 * @returns {() => void} disconnects
 */
export function installPlacePick({
  pinia,
  subscribe,
  subscribeCameraHandoff,
  getDataManager,
  target = globalThis.document,
  creditAirports = null,
}) {
  const store = useEntityCardStore(pinia);
  let generation = 0;
  let stopped = false;
  const offNavigation = subscribeCameraHandoff?.(() => {
    generation++;
  });
  // The last place a location search found, for a pick that names a query.
  let lastFound = null;
  const offSearch = subscribe?.(({ state, change }) => {
    if (change?.type === 'started') lastFound = null;
    if (change?.type === 'found')
      lastFound = {
        query: state?.query || '',
        destination: state?.destination,
      };
  });
  const onPick = async (event) => {
    const detail = event?.detail || {};
    let lat = finiteNumber(detail.latitude);
    let lon = finiteNumber(detail.longitude);
    let label = detail.name || '';
    // A row that named its own spot: what it opens is that spot.
    const picked = lat !== null && lon !== null && !detail.query;
    if (
      (lat === null || lon === null) &&
      lastFound &&
      (!detail.query || lastFound.query === detail.query)
    ) {
      lat = finiteNumber(lastFound.destination?.latitude);
      lon = finiteNumber(lastFound.destination?.longitude);
      label = lastFound.destination?.label || label;
    }
    if (lat === null || lon === null) return;
    const mine = ++generation;
    // A pick made while the place was looked up (an aircraft clicked, say)
    // is newer than this one: the place card does not replace it.
    const selectionAtPick = store.selectionGeneration();
    const found = await placeForSearch(
      {
        query: detail.airport || detail.query || label,
        label,
        lat,
        lon,
        picked,
      },
      { dataManager: getDataManager?.() },
    ).catch(() => null);
    if (stopped || mine !== generation || !found) return;
    // The caller may also have started another action while this resolved.
    if (detail.isCurrent?.() === false) return;
    if (store.selectionGeneration() !== selectionAtPick) return;
    if (found.identity.place?.airport) creditAirports?.();
    store.select(found.identity, { fly: found.fly, follow: false });
  };
  target?.addEventListener?.(PLACE_PICK_EVENT, onPick);
  return () => {
    stopped = true;
    offSearch?.();
    offNavigation?.();
    target?.removeEventListener?.(PLACE_PICK_EVENT, onPick);
  };
}
