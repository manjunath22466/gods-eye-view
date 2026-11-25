/**
 * The bundled airports pack (OurAirports, public domain), read from
 * `local_data/ourairports/airports.json` (built by
 * scripts/build-ourairports.mjs from OurAirports' airports.csv and
 * runways.csv). It loads on first use and every answer is offline: no
 * airport service is asked. Airports are part of picking a place, not a
 * layer.
 *
 * Rows are `[ident, iata, name, lat, lon, size, city, country, elevationFt,
 * runways]`: the ICAO-style ident (KAUS), the IATA code ('' when none), the
 * name, the position to four decimals, 'large', 'medium' or 'small', the
 * municipality, the ISO 3166-1 alpha-2 country, the elevation in feet (null
 * when unknown) and the number of open runways.
 *
 * Without the pack (a checkout that leaves it out), every lookup answers
 * "none" and nothing fails.
 */

import { createRetryableLoader } from './retryableLoad.js';

/**
 * A name as the lookups compare it: lower case, without accents on Latin
 * letters ("Zürich" reads as "zurich"); marks in other scripts (Hindi, Thai)
 * carry meaning and stay. Kept here so the airports pack does not load the
 * cities pack's module.
 */
export const foldName = (name) =>
  String(name || '')
    .normalize('NFD')
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
    .normalize('NFC')
    .toLocaleLowerCase('en')
    .trim();

/** How close a picked spot must be to an airport for the place line's link. */
export const NEAR_AIRPORT_KM = 2;

const CELL_DEG = 1;
const EARTH_KM = 6371;
const rad = (deg) => (deg * Math.PI) / 180;

/** Great-circle distance in km. */
export function distanceKm(lat1, lon1, lat2, lon2) {
  const a =
    Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

const wrapLon = (lon) => (((lon % 360) + 540) % 360) - 180;
const cellKey = (lat, lon) =>
  `${Math.floor(lat / CELL_DEG)},${Math.floor(wrapLon(lon) / CELL_DEG)}`;

/**
 * One row of the pack, read into an airport.
 * @param {Array} row
 * @returns {{ident: string, iata: string, name: string, lat: number, lon: number, size: string, city: string, country: string, elevationFt: ?number, runways: number}}
 */
export function toAirport(row) {
  const [
    ident,
    iata,
    name,
    lat,
    lon,
    size,
    city,
    country,
    elevationFt,
    runways,
  ] = row;
  return {
    ident: String(ident || ''),
    iata: String(iata || ''),
    name: String(name || ''),
    lat: Number(lat),
    lon: Number(lon),
    size: String(size || ''),
    city: String(city || ''),
    country: String(country || ''),
    elevationFt: Number.isFinite(elevationFt) ? elevationFt : null,
    runways: Number.isFinite(runways) ? runways : 0,
  };
}

/** Whether a row is usable: a code, a name and a position. */
const validRow = (row) =>
  Array.isArray(row) &&
  row[0] &&
  row[2] &&
  Number.isFinite(row[3]) &&
  Number.isFinite(row[4]);

/**
 * Index a pack's rows: by one-degree cell for "near here", and by code for
 * "AUS" or "KAUS".
 * @param {Array<Array>} rows
 */
export function indexAirports(rows) {
  const cells = new Map();
  const codes = new Map();
  const airports = [];
  for (const row of rows || []) {
    if (!validRow(row)) continue;
    const airport = toAirport(row);
    airports.push(airport);
    const key = cellKey(airport.lat, airport.lon);
    const cell = cells.get(key);
    if (cell) cell.push(airport);
    else cells.set(key, [airport]);
    for (const code of [airport.ident, airport.iata])
      if (code && !codes.has(code.toUpperCase()))
        codes.set(code.toUpperCase(), airport);
  }
  return { airports, cells, codes };
}

/**
 * Airports within `radiusKm` of a point, nearest first, each with its
 * `distanceKm`.
 * @param {{cells: Map}} index
 */
export function airportsWithin(index, lat, lon, radiusKm) {
  if (!index || !Number.isFinite(lat) || !Number.isFinite(lon)) return [];
  const latSpan = Math.ceil(radiusKm / 111 / CELL_DEG);
  const cos = Math.max(0.01, Math.cos(rad(lat)));
  const lonSpan = Math.min(180, Math.ceil(radiusKm / (111 * cos) / CELL_DEG));
  const found = [];
  const seen = new Set();
  for (let dy = -latSpan; dy <= latSpan; dy++)
    for (let dx = -lonSpan; dx <= lonSpan; dx++) {
      const key = cellKey(lat + dy * CELL_DEG, lon + dx * CELL_DEG);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const airport of index.cells.get(key) || []) {
        const km = distanceKm(lat, lon, airport.lat, airport.lon);
        if (km <= radiusKm) found.push({ ...airport, distanceKm: km });
      }
    }
  return found.sort((a, b) => a.distanceKm - b.distanceKm);
}

const SIZE_RANK = { large: 0, medium: 1, small: 2 };
/** How far from where a search landed an airport named only by words in its name may be. */
export const NAME_NEAR_KM = 100;
const AIRPORT_WORDS =
  /\b(airport|airfield|aerodrome|international|intl|regional|field)\b/g;

/**
 * The airport a typed line names: its IATA or ICAO code ("AUS", "KAUS"), or
 * its name with "airport" in the line ("Austin airport", "Heathrow
 * airport"); larger airports first. Null when the line names none.
 * @param {ReturnType<typeof indexAirports>} index
 * @param {string} query
 */
export function findAirportIn(index, query, near = null) {
  const line = String(query || '').trim();
  if (!index || !line) return null;
  // A bare code only in capitals: "sea" or "usa" typed as words are places,
  // "SEA" is Seattle's airport. Where the search landed decides the rest
  // (placePick).
  if (/^[A-Z0-9]{3,4}$/.test(line)) {
    const byCode = index.codes.get(line);
    if (byCode) return byCode;
  }
  const folded = foldName(line);
  if (!/\b(airport|airfield|aerodrome)\b/.test(folded)) return null;
  const words = folded
    .replace(AIRPORT_WORDS, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
  if (!words.length) return null;
  // Whole words, as a run: the start of the airport's city ("Columbus
  // airport"; "Paris airport" is CDG, whose city is "Paris (Roissy-en-France,
  // Val-d'Oise)"), its code, or words in a row in its name ("Heathrow
  // airport"). A name match counts only near where the search landed, so
  // "York airport" is never New York Stewart, 5,000 km from York.
  const tokens = (text) =>
    foldName(text)
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
  const phrase = words.join(' ');
  const landed = near && Number.isFinite(near.lat) && Number.isFinite(near.lon);
  const away = (airport) =>
    landed ? distanceKm(near.lat, near.lon, airport.lat, airport.lon) : 0;
  const hits = index.airports.filter((airport) => {
    if (tokens(airport.city).slice(0, words.length).join(' ') === phrase)
      return true;
    if (words.length === 1 && airport.iata.toLowerCase() === words[0])
      return true;
    if (!` ${tokens(airport.name).join(' ')} `.includes(` ${phrase} `))
      return false;
    return !landed || away(airport) <= NAME_NEAR_KM;
  });
  // The biggest first; among the same size, the nearest to where the search
  // landed ("Columbus airport" in Ohio is CMH, not Georgia's).
  hits.sort(
    (a, b) =>
      (SIZE_RANK[a.size] ?? 3) - (SIZE_RANK[b.size] ?? 3) || away(a) - away(b),
  );
  return hits[0] || null;
}

/**
 * The airport a line is exactly the code of ("SFO", "KSFO"), or null. In
 * capitals any airport's code counts; typed in lower case ("aus", "sea")
 * only a large airport's, since short words are often places too.
 * @param {ReturnType<typeof indexAirports>} index
 * @param {string} query
 */
export function airportByCodeIn(index, query) {
  const line = String(query || '').trim();
  if (!index || !/^[A-Za-z]{3,4}$/.test(line)) return null;
  const airport = index.codes.get(line.toUpperCase());
  if (!airport) return null;
  return line === line.toUpperCase() || airport.size === 'large'
    ? airport
    : null;
}

/** Alpha-3 codes from the bundled Natural Earth countries. */
const COUNTRY_CODES = new Set(
  `ABW AFG AGO AIA ALB ALD AND ARE ARG ARM ASM ATA ATC ATF ATG AUS AUT AZE
BDI BEL BEN BFA BGD BGR BHR BHS BIH BJN BLM BLR BLZ BMU BOL BRA BRB BRI
BRN BRT BTN BWA CAF CAN CHE CHL CHN CIV CLP CMR CNM COD COG COK COL COM
CPV CRI CUB CUW CYM CYN CYP CZE DEU DJI DMA DNK DOM DZA ECU EGY ENG ERI
ESB ESP EST ETH FIN FJI FLK FRA FRO FSM GAB GBR GEO GGY GHA GIB GIN GMB
GNB GNQ GRC GRD GRL GTM GUM GUY HKG HMD HND HRV HTI HUN IDN IMN IND IOA
IOT IRL IRN IRQ ISL ISR ITA JAM JEY JOR JPN KAB KAS KAZ KEN KGZ KHM KIR
KNA KOR KOS KWT LAO LBN LBR LBY LCA LIE LKA LSO LTU LUX LVA MAC MAF MAR
MCO MDA MDG MDV MEX MHL MKD MLI MLT MMR MNE MNG MNP MOZ MRT MSR MUS MWI
MYS NAM NCL NER NFK NGA NIC NIR NIU NLD NOR NPL NRU NZL OMN PAK PAN PCN
PER PGA PHL PLW PNG POL PRI PRK PRT PRY PSX PYF QAT ROU RUS RWA SAH SAU
SCR SCT SDN SDS SEN SGP SGS SHN SLB SLE SLV SMR SOL SOM SPI SPM SRB STP
SUR SVK SVN SWE SWZ SXM SYC SYR TCA TCD TGO THA TJK TKM TLS TON TTO TUN
TUR TUV TWN TZA UGA UKR UMI URY USA USG UZB VAT VCT VEN VGB VIR VNM VUT
WLF WLS WSB WSM YEM ZAF ZMB ZWE`.split(/\s+/),
);

/** Whether a typed code could name a country as well as an airport. */
export const isAirportCountryCode = (query) =>
  COUNTRY_CODES.has(
    String(query || '')
      .trim()
      .toUpperCase(),
  );

/** An airport's short code for its card and links: IATA, else its ident. */
export const airportCode = (airport) => airport?.iata || airport?.ident || '';

/**
 * Read a pack (its JSON) through `fetchImpl`. A pack that is not there
 * (404) is an empty pack, kept for the session; any other failure is
 * retried later.
 */
export async function readAirportsPack(fetchImpl, url) {
  const response = await fetchImpl(url);
  if (response.status === 404)
    return { meta: null, missing: true, ...indexAirports([]) };
  if (!response.ok) throw new Error(`airports pack: HTTP ${response.status}`);
  const pack = await response.json();
  return {
    meta: pack?.meta || null,
    missing: false,
    ...indexAirports(pack?.rows),
  };
}

let loader = null;
let fetcher = (...args) => globalThis.fetch(...args);
/** The indexed pack, loaded once; a failed load is retried after a pause. */
export function loadAirports() {
  // A literal, so the build bundles the pack once it exists.
  loader ??= createRetryableLoader(() =>
    readAirportsPack(
      fetcher,
      new URL('./local_data/ourairports/airports.json', import.meta.url),
    ),
  );
  return loader();
}

/** Tests: read the pack through `fetchImpl` from the next load on. */
export function _setAirportsFetchForTest(fetchImpl) {
  fetcher = fetchImpl || ((...args) => globalThis.fetch(...args));
  loader = null;
}

/** Airports near a point, nearest first; none without the pack. */
export async function airportsNear(lat, lon, radiusKm = NEAR_AIRPORT_KM) {
  try {
    return airportsWithin(await loadAirports(), lat, lon, radiusKm);
  } catch {
    return [];
  }
}

/** The airport a typed line names, or null (also without the pack). */
export async function findAirport(query, near = null) {
  try {
    return findAirportIn(await loadAirports(), query, near);
  } catch {
    return null;
  }
}

/** The airport a line is exactly the code of, or null (also without the pack). */
export async function findAirportByCode(query) {
  try {
    return airportByCodeIn(await loadAirports(), query);
  } catch {
    return null;
  }
}
