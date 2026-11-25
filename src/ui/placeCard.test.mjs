// src/ui/placeCard.test.mjs — places and spots in Context: a place from
// search gets a card, an airport from the bundled pack
// gets one with the flights already loaded around it, a place near an
// airport or base links to it without opening it, a place pins as a still,
// and the view in Context pins as the camera it flies back to. Over
// happy-dom.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import ContextView from './views/ContextView.vue';
import { useEntityCardStore } from './stores/entityCard.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { usePinnedStore } from './stores/pinned.js';
import { _setAirportsFetchForTest } from '../data/airports.js';
import {
  announcePlacePick,
  installPlacePick,
  placeForSearch,
} from './placePick.js';
import { describePlace, placeIdentity, PLACE_LAYER } from './placeCard.js';
import { NavigationController } from './navigationController.js';
import { suggestLayers } from './layerSuggestions.js';
import { useLayerFinderStore } from './stores/layerFinder.js';

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));
const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await turn();
    await nextTick();
  }
};

const AIRPORTS = [
  [
    'KAUS',
    'AUS',
    'Austin–Bergstrom International Airport',
    30.1945,
    -97.6699,
    'large',
    'Austin',
    'US',
    542,
    2,
  ],
];

function useAirports(t, rows = AIRPORTS) {
  _setAirportsFetchForTest(
    async () =>
      new Response(JSON.stringify({ meta: {}, rows }), { status: 200 }),
  );
  t.after(() => _setAirportsFetchForTest(null));
}

/** Mount Context with the layers given; a fake location search to drive. */
function fixture(t, layers = [], navigation = null) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp(ContextView).use(pinia);
  app.mount(host);
  const cards = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  const rows = layers.map((layer) =>
    Object.assign(layer, {
      module: {
        getAnalystRecords: () => layer.records || [],
        ...(layer.module || {}),
      },
    }),
  );
  const dataManager = {
    layers: new Map(rows.map((row) => [row.id, row])),
    isEnabled: (id) => Boolean(rows.find((row) => row.id === id)?.enabled),
    getAll: () => rows.map((row) => ({ ...row })),
    subscribe: () => () => {},
  };
  const flown = [];
  const briefReads = [];
  cards.connect({
    dataManager: () => dataManager,
    inspectorRows: () => dataManager.getAll(),
    regionalBrief: async (...args) => (
      briefReads.push(args),
      {
        weather: {
          temperatureC: 18,
          weatherCode: 0,
          timeZone: 'America/Chicago',
        },
      }
    ),
    previews: () => null,
    canFollow: () => false,
    flyTo: (card) => flown.push(card.key),
    flyToPose: (pose) => flown.push(pose),
  });
  // The location search's state channel, as the shell offers it.
  const listeners = new Set();
  const offPick = installPlacePick({
    pinia,
    subscribeCameraHandoff: (listener) =>
      navigation?.subscribeCameraHandoff(listener),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getDataManager: () => dataManager,
  });
  // A location search on its own (a plan's step, "flights near Austin").
  const searchOnly = async (query, destination) => {
    for (const listener of listeners)
      listener({ state: { query, destination }, change: { type: 'started' } });
    for (const listener of listeners)
      listener({ state: { query, destination }, change: { type: 'found' } });
    for (const listener of listeners)
      listener({ state: { query, destination }, change: { type: 'settled' } });
    await settle();
  };
  // A place row picked in search: the search, then the pick it announces.
  const search = async (query, destination) => {
    await searchOnly(query, destination);
    announcePlacePick({ name: query, query });
    await settle();
  };
  t.after(() => {
    offPick();
    cards.connect(null);
    chrome.detach(owner);
    app.unmount();
    globalThis.fetch = realFetch;
  });
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  return {
    $: (selector) => document.querySelector(selector),
    cards,
    pinia,
    flown,
    search,
    searchOnly,
    rows,
    briefReads,
  };
}

const flightsLayer = (records, enabled = true) => ({
  id: 'flights',
  name: 'Live Flights',
  enabled,
  records,
  stats: { count: records.length },
});

test('a place found by search opens its card: close-up map on top, place line, weather and daylight, suggestions', async (t) => {
  useAirports(t, []);
  const { $, cards, search, flown, rows, pinia } = fixture(t, [
    flightsLayer([], false),
    { id: 'satellites', name: 'Satellites', enabled: false, records: [] },
    { id: 'cctv', name: 'Cameras', enabled: false, records: [] },
  ]);
  const finder = useLayerFinderStore(pinia);
  await search('Congress Ave Bridge', {
    label: 'Congress Ave Bridge',
    latitude: 30.261,
    longitude: -97.7454,
  });
  assert.equal(cards.card?.layerId, PLACE_LAYER);
  assert.equal(cards.card.title, 'Congress Ave Bridge');
  assert.deepEqual(flown, [], 'the search already flew there');
  assert.equal($('.entity-card__title').textContent, 'Congress Ave Bridge');
  assert.match($('.entity-card__kind').textContent, /Place · from search/);
  assert.ok($('.entity-hero .close-up-map'), 'a close-up map, never an icon');
  assert.match($('.place-line__meta').textContent, /30\.2610, -97\.7454/);
  assert.match($('.place-line__meta').textContent, /local, .* UTC/);
  const tiles = [
    ...document.querySelectorAll('.place-details__tiles .entity-card__tile'),
  ].map((tile) => tile.dataset.field);
  assert.deepEqual(tiles, ['weather', 'daylight']);
  assert.match($('.place-details__tiles').textContent, /18 °C/);
  assert.equal(
    $('.place-details__open'),
    null,
    'no suggestions without mounted filter controls',
  );
  t.after(finder.attachControls());
  await nextTick();
  // Suggested here: global layers that are off, never Cameras (no declared coverage).
  assert.deepEqual(
    [...document.querySelectorAll('.place-details__chip')].map((chip) =>
      chip.textContent.trim(),
    ),
    ['Live Flights', 'Satellites'],
  );
  $('.place-details__open').click();
  assert.deepEqual(finder.selection.picked, ['flights', 'satellites']);
  assert.ok(
    rows.every((row) => !row.enabled),
    'nothing switches on',
  );
  // A click on empty ground clears it: Context describes the view, with no
  // box of its own for the spot.
  cards.clear();
  await settle();
  assert.equal(cards.card, null);
  assert.equal($('.context-spot'), null);
});

test('a place leads with a street-level photo where Street Level remembers a photo a short walk away', async (t) => {
  useAirports(t, []);
  const photo = {
    id: 'mapillary:1',
    lat: 30.2612,
    lon: -97.7452,
    still: '/still/1.jpg',
    providerId: 'mapillary',
    provider: 'Mapillary',
    creator: 'walker',
    license: 'CC-BY-SA-4.0',
  };
  const { $, cards } = fixture(t, [
    {
      id: 'street-level',
      name: 'Street Level',
      enabled: true,
      records: [photo],
      module: {
        photo: (id) => (id === photo.id ? photo : null),
        providerCredit: (id) => (id === 'mapillary' ? '© Mapillary' : ''),
      },
    },
  ]);
  cards.select(
    placeIdentity({ name: 'Congress Ave Bridge', lat: 30.261, lon: -97.7454 }),
  );
  await settle();
  assert.equal(
    $('.entity-hero__place-street img').getAttribute('src'),
    '/still/1.jpg',
  );
  // Its full credit: the provider's own, who took it and its licence.
  assert.equal(
    $('.entity-hero__place-street small').textContent,
    '© Mapillary · Image by walker · CC-BY-SA-4.0',
  );
  // The button names its action; the photo inside adds no second name.
  assert.equal(
    $('.entity-hero__place-street').getAttribute('aria-label'),
    'Open street-level photo',
  );
  assert.equal($('.entity-hero__place-street img').getAttribute('alt'), '');
  assert.equal($('.entity-hero .close-up-map'), null);
  // Too far for the photo: the map.
  cards.select(placeIdentity({ name: 'Elsewhere', lat: 30.3, lon: -97.7 }));
  await settle();
  assert.ok($('.entity-hero .close-up-map'));
});

test('a place pins as a still with a map; its pin flies there and shows no Nearby of its own', async (t) => {
  useAirports(t, []);
  const { $, cards, pinia, flown } = fixture(t, [
    flightsLayer([{ id: 'abc', callsign: 'ABC1', lat: 30.262, lon: -97.745 }]),
  ]);
  const pinned = usePinnedStore(pinia);
  cards.select(
    placeIdentity({ name: 'Congress Ave Bridge', lat: 30.261, lon: -97.7454 }),
  );
  await settle();
  assert.ok($('.spot-conditions'), 'Nearby on the place card');
  $('.entity-card__action--pin').click();
  t.after(() => pinned.unpin('place:30.2610,-97.7454'));
  const [pin] = pinned.pins;
  assert.equal(pin.kind, 'place');
  assert.equal(
    pinned.stillOf(pin.key),
    'card-map:13/30.26100/-97.74540',
    'a map still: its spot and zoom',
  );
  cards.clear();
  pinned.show('pinned');
  await nextTick();
  assert.equal(
    $('.pinned-grid__frame').tagName,
    'CANVAS',
    'drawn as a card map',
  );
  assert.ok($('.pinned-grid__frame').classList.contains('card-map'));
  const { textContent: credit } = $('.pinned-grid__credit');
  assert.match(credit, /© OpenStreetMap contributors/);
  assert.match(credit, /© OpenMapTiles/);
  $('.pinned-grid__open').click();
  await settle();
  assert.equal(cards.card.key, 'place:30.2610,-97.7454');
  assert.deepEqual(
    flown,
    ['place:30.2610,-97.7454'],
    'tapping the pin flies there',
  );
  assert.equal($('.spot-conditions'), null, 'no Nearby of its own');
});

test('the place header pins the view: the camera as it is, and its tile flies back to it', async (t) => {
  useAirports(t, []);
  const { $, cards, pinia, flown } = fixture(t, []);
  const pinned = usePinnedStore(pinia);
  t.after(() =>
    pinned.pins.map((pin) => pin.key).forEach((key) => pinned.unpin(key)),
  );
  const pose = {
    lon: -98.62,
    lat: 29.46,
    height: 1800,
    heading: 1.2,
    pitch: -0.6,
    roll: 0,
  };
  cards.setView({
    center: { lat: 29.4727, lon: -98.6197 },
    rect: { west: -98.7, south: 29.4, east: -98.5, north: 29.5 },
    heightM: 1800,
    pose,
  });
  await settle();
  // One place header, with the 📌 beside its name.
  assert.equal(document.querySelectorAll('.view-context__title').length, 1);
  const pin = $('.view-context__pin');
  assert.equal(pin.getAttribute('aria-pressed'), 'false');
  pin.click();
  await nextTick();
  assert.equal(pinned.pins.length, 1);
  const [saved] = pinned.pins;
  assert.equal(saved.kind, 'view');
  assert.deepEqual(saved.pose, pose, 'the camera itself, not only the point');
  assert.equal(saved.title, $('.view-context__title span').textContent);
  assert.match(
    pinned.stillOf(saved.key),
    /^card-map:13\/29\.47270\/-98\.61970$/,
    'a still of the map',
  );
  assert.equal($('.view-context__pin').getAttribute('aria-pressed'), 'true');
  // Its tile flies back to that view, and Context describes it there.
  pinned.show('pinned');
  await nextTick();
  $('.pinned-grid__open').click();
  await settle();
  assert.deepEqual(flown.at(-1), pose);
  assert.equal(cards.card, null);
  assert.equal(pinned.tab, 'inspect');
});

test('an airport from search opens its card with the flights already loaded within 50 km, arrivals first', async (t) => {
  useAirports(t);
  const records = [
    {
      id: 'a1',
      callsign: 'SWA1123',
      lat: 30.3,
      lon: -97.7,
      routeOrigin: 'DAL',
      routeDestination: 'AUS',
    },
    {
      id: 'd1',
      callsign: 'UAL649',
      lat: 30.25,
      lon: -97.6,
      routeOrigin: 'KAUS',
      routeDestination: 'ORD',
    },
    // Cruising overhead: not this airport's, so the figures stay exact.
    {
      id: 'o1',
      callsign: 'N123',
      lat: 30.2,
      lon: -97.8,
      altitudeM: 11000,
      verticalRateMps: 0,
    },
    {
      id: 'far',
      callsign: 'FAR1',
      lat: 32.9,
      lon: -97.0,
      routeDestination: 'AUS',
    },
  ];
  const { $, cards, search, flown } = fixture(t, [flightsLayer(records)]);
  await search('AUS', {
    label: 'Austin–Bergstrom International Airport',
    latitude: 30.1945,
    longitude: -97.6699,
  });
  assert.equal(cards.card?.key, 'place:airport:KAUS');
  assert.deepEqual(flown, ['place:airport:KAUS']);
  assert.match(
    $('.entity-card__title').textContent,
    /Austin–Bergstrom International Airport \(AUS · KAUS\)/,
  );
  assert.match($('.entity-card__kind').textContent, /Place · airport/);
  const tile = (field) =>
    $(`.place-details__tiles [data-field="${field}"] strong`).textContent;
  assert.equal(tile('arriving'), '1');
  assert.equal(tile('departing'), '1');
  assert.equal(tile('runways'), '2');
  const heads = [
    ...document.querySelectorAll('.place-details .nearby-lists__layer'),
  ].map((list) => list.dataset.layer);
  assert.deepEqual(
    heads,
    ['arriving', 'departing', 'around'],
    'arrivals first',
  );
  assert.match(
    $('.place-details [data-layer="arriving"]').textContent,
    /SWA1123/,
  );
  assert.doesNotMatch(
    $('.place-details').textContent,
    /FAR1/,
    'only within 50 km',
  );
  assert.equal($('.place-line__near'), null, 'no near link to itself');
  // A row opens that flight's card.
  $('.place-details [data-layer="arriving"] button').click();
  await nextTick();
  assert.equal(cards.card.identity.id, 'a1');
});

const SFO = [
  'KSFO',
  'SFO',
  'San Francisco International Airport',
  37.6188,
  -122.375,
  'large',
  'San Francisco',
  'US',
  13,
  4,
];

/** A flight `north` and `east` km from SFO. */
const nearSfo = (north, east, fields) => ({
  lat: SFO[3] + north / 111.2,
  lon: SFO[4] + east / (111.2 * Math.cos((SFO[3] * Math.PI) / 180)),
  ...fields,
});

const airportFigure = ($, field) => {
  const tile = $(`.place-details__tiles [data-field="${field}"]`);
  const strong = tile.querySelector('strong');
  return {
    number: strong.textContent,
    reason: strong.querySelector('abbr')?.getAttribute('title') || null,
  };
};
const listNames = (field) =>
  [
    ...document.querySelectorAll(
      `.place-details [data-layer="${field}"] .nearby-lists__name`,
    ),
  ].map((name) => name.textContent);
const listCount = (field) =>
  document.querySelector(
    `.place-details [data-layer="${field}"] .nearby-lists__count`,
  )?.textContent ?? null;

test('an airport card counts flights without a route by how they move, marks those counts as estimates, and lists them under Arriving and Departing', async (t) => {
  useAirports(t, [SFO]);
  const ground = nearSfo(1, 0, {
    id: 'g1',
    callsign: 'JBU7',
    onGround: true,
    speedMps: 40,
    altitudeM: 0,
  });
  const records = [
    // Routes known: they go by them, however they move.
    nearSfo(20, 0, {
      id: 'r1',
      callsign: 'UAL1',
      altitudeM: 2000,
      verticalRateMps: -5,
      routeOrigin: 'DEN',
      routeDestination: 'SFO',
    }),
    nearSfo(-10, 0, {
      id: 'r2',
      callsign: 'UAL2',
      altitudeM: 1500,
      verticalRateMps: 0,
      routeOrigin: 'KSFO',
      routeDestination: 'LAX',
    }),
    nearSfo(0, 13, {
      id: 'r3',
      callsign: 'ASA3',
      altitudeM: 900,
      verticalRateMps: -5,
      routeOrigin: 'OAK',
      routeDestination: 'SEA',
    }),
    // No route: descending low near SFO, climbing away from it, climbing
    // towards it, cruising high overhead (even descending), on the ground,
    // no climb or descent data, and descending but 40 km out.
    nearSfo(12, 0, {
      id: 'd1',
      callsign: 'SKW5313',
      altitudeM: 1200,
      verticalRateMps: -4,
      heading: 180,
    }),
    nearSfo(8, 0, {
      id: 'c1',
      callsign: 'ACA761',
      altitudeM: 900,
      verticalRateMps: 8,
      heading: 0,
    }),
    nearSfo(-15, 0, {
      id: 'c2',
      callsign: 'SKW5503',
      altitudeM: 1500,
      verticalRateMps: 6,
      heading: 0,
    }),
    nearSfo(5, 0, {
      id: 'h1',
      callsign: 'DAL9',
      altitudeM: 11000,
      verticalRateMps: -10,
      heading: 90,
    }),
    ground,
    nearSfo(-6, 0, {
      id: 'n1',
      callsign: 'N55',
      altitudeM: 900,
      verticalRateMps: null,
    }),
    nearSfo(40, 0, {
      id: 'f1',
      callsign: 'FAR40',
      altitudeM: 1000,
      verticalRateMps: -5,
    }),
  ];
  const { $, cards, search } = fixture(t, [flightsLayer(records)]);
  await search('SFO', { label: 'SFO', latitude: SFO[3], longitude: SFO[4] });
  assert.equal(cards.card?.key, 'place:airport:KSFO');

  const arriving = airportFigure($, 'arriving');
  assert.equal(arriving.number, '~2', 'one by its route, one descending');
  assert.match(arriving.reason, /Estimated from altitude, climb or descent/);
  assert.equal(airportFigure($, 'departing').number, '~2');
  assert.match(
    $('.place-details__tiles [data-field="arriving"]').getAttribute('title'),
    /Estimated/,
  );

  assert.deepEqual(
    [...document.querySelectorAll('.place-details .nearby-lists__layer')].map(
      (list) => list.dataset.layer,
    ),
    ['arriving', 'departing', 'around'],
  );
  assert.match(
    $('.place-details .nearby-lists__title').textContent,
    /Flights at SFO/,
  );
  assert.deepEqual(listNames('arriving'), ['SKW5313', 'UAL1'], 'nearest first');
  assert.deepEqual(listNames('departing'), ['ACA761', 'UAL2']);
  assert.equal(listCount('around'), '6');
  const others = listNames('around');
  assert.deepEqual(others, ['JBU7', 'DAL9', 'N55'], 'the nearest three');
  // A route-known row names the other airport; a judged one names none.
  const viaOf = (callsign) =>
    [
      ...document.querySelectorAll('.place-details .nearby-lists__layer li'),
    ].find((row) => row.textContent.includes(callsign));
  assert.match(
    viaOf('UAL1').querySelector('.nearby-lists__via').textContent,
    /from DEN/,
  );
  assert.equal(viaOf('SKW5313').querySelector('.nearby-lists__via'), null);

  // The flight on the ground slows (it has just landed): it is arriving.
  ground.speedMps = 25;
  cards.refresh();
  await settle();
  assert.equal(airportFigure($, 'arriving').number, '~3');
  assert.deepEqual(listNames('arriving'), ['JBU7', 'SKW5313', 'UAL1']);
  assert.equal(listCount('around'), '5');
  // Read again before the next poll, it still is.
  cards.refresh();
  await settle();
  assert.equal(airportFigure($, 'arriving').number, '~3');

  // A row the card judged opens that flight's card.
  $('.place-details [data-layer="departing"] button').click();
  await nextTick();
  assert.equal(cards.card.identity.id, 'c1');
});

test('an airport card shows — rather than 0 while the flights there report no climb or descent, and 0 only when none are there', async (t) => {
  useAirports(t, [SFO]);
  const records = [
    nearSfo(5, 0, {
      id: 'n1',
      callsign: 'N1',
      altitudeM: 900,
      verticalRateMps: null,
    }),
    nearSfo(-10, 0, { id: 'n2', callsign: 'N2', altitudeM: 1200 }),
    // Level near the airport: known to be neither.
    nearSfo(0, 8, {
      id: 'l1',
      callsign: 'L1',
      altitudeM: 600,
      verticalRateMps: 0,
      heading: 90,
    }),
  ];
  const layer = flightsLayer(records);
  const { $, cards, search } = fixture(t, [layer]);
  await search('SFO', { label: 'SFO', latitude: SFO[3], longitude: SFO[4] });
  for (const field of ['arriving', 'departing']) {
    const figure = airportFigure($, field);
    assert.equal(figure.number, '—', field);
    assert.match(
      figure.reason,
      /no climb or descent data for the flights near SFO/,
    );
  }
  assert.deepEqual(
    [...document.querySelectorAll('.place-details .nearby-lists__layer')].map(
      (list) => list.dataset.layer,
    ),
    ['around'],
  );
  assert.equal(listCount('around'), '3');

  // One of them starts descending: arriving is an estimate of 1, and
  // departing, still with flights it cannot judge, stays —.
  records[0].verticalRateMps = -3;
  cards.refresh();
  await settle();
  assert.equal(airportFigure($, 'arriving').number, '~1');
  assert.equal(airportFigure($, 'departing').number, '—');

  // With no flights within 50 km, 0 is known.
  layer.records = [];
  cards.refresh();
  await settle();
  for (const field of ['arriving', 'departing']) {
    const figure = airportFigure($, field);
    assert.equal(figure.number, '0', field);
    assert.equal(figure.reason, null, `${field} is exact`);
  }
});

test('with Live Flights off, an airport card says so instead of counting 0 arrivals and departures', async (t) => {
  useAirports(t);
  const { $, search, pinia, rows } = fixture(t, [
    flightsLayer(
      [
        {
          id: 'a1',
          callsign: 'SWA1123',
          lat: 30.3,
          lon: -97.7,
          routeDestination: 'AUS',
        },
      ],
      false,
    ),
  ]);
  await search('AUS', { label: 'Austin', latitude: 30.2, longitude: -97.7 });
  const tile = (field) => $(`.place-details__tiles [data-field="${field}"]`);
  for (const field of ['arriving', 'departing']) {
    assert.equal(tile(field).querySelector('strong').textContent, '—', field);
    assert.match(
      tile(field).getAttribute('title'),
      /Live Flights off · turn it on in Data Layers/,
    );
  }
  assert.equal(tile('runways').querySelector('strong').textContent, '2');
  const hint = $('.place-details__flights-off');
  assert.match(
    hint.textContent,
    /Live Flights off · turn it on in Data Layers to count arrivals and departures/,
  );
  assert.equal(
    $('.place-details .nearby-lists__layer[data-layer="arriving"]'),
    null,
    'no flight lists while the layer is off',
  );
  const finder = useLayerFinderStore(pinia);
  hint.click();
  assert.deepEqual(
    finder.selection.picked,
    [],
    'no hidden filter without its controls',
  );
  t.after(finder.attachControls());
  hint.click();
  assert.deepEqual(
    finder.selection.picked,
    ['flights'],
    'Data Layers picks it out',
  );
  assert.equal(rows[0].enabled, false);
});

test('disabling Flights returns focus from airport traffic to the card title', async (t) => {
  useAirports(t);
  const { $, cards, search, rows } = fixture(t, [
    flightsLayer([
      {
        id: 'a1',
        callsign: 'SWA1123',
        lat: 30.3,
        lon: -97.7,
        routeDestination: 'AUS',
      },
    ]),
  ]);
  await search('AUS', { label: 'Austin', latitude: 30.2, longitude: -97.7 });

  const arrival = $(
    '.place-details .nearby-lists__layer[data-layer="arriving"] button[data-row-key]',
  );
  arrival.focus();
  assert.equal(document.activeElement, arrival);

  rows[0].enabled = false;
  cards.layerRevision++;
  await settle();

  assert.ok($('.place-details__flights-off'));
  assert.ok(document.activeElement.matches('.entity-card__title'));

  const [arriving] = rows[0].records;
  const departing = {
    id: 'd1',
    callsign: 'SWA2100',
    lat: 30.29,
    lon: -97.72,
    routeOrigin: 'AUS',
  };
  rows[0].records = [arriving, departing];
  rows[0].enabled = true;
  cards.layerRevision++;
  await settle();
  $(
    '.place-details .nearby-lists__layer[data-layer="arriving"] button[data-row-key]',
  ).focus();

  rows[0].records = [departing];
  cards.layerRevision++;
  await settle();
  assert.ok(document.activeElement.matches('.nearby-lists__title'));

  rows[0].enabled = false;
  cards.layerRevision++;
  await settle();
  assert.ok(document.activeElement.matches('.entity-card__title'));
});

test('a place card that is no airport shows no flights hint', async (t) => {
  useAirports(t, []);
  const { $, cards } = fixture(t, [flightsLayer([], false)]);
  cards.select(
    placeIdentity({ name: 'Zilker Park', lat: 30.267, lon: -97.773 }),
  );
  await settle();
  assert.equal($('.place-details__flights-off'), null);
});

test('a place near an airport or a base links to it in the place line; the card never opens by itself', async (t) => {
  useAirports(t);
  const base = { id: 'b1', name: 'Camp Mabry', lat: 30.3133, lon: -97.7617 };
  const { $, cards } = fixture(t, [
    {
      id: 'military-installations',
      name: 'Military Installations',
      enabled: true,
      records: [base],
    },
  ]);
  cards.open(placeIdentity({ name: 'Del Valle', lat: 30.205, lon: -97.68 }));
  await settle();
  assert.equal(
    cards.card?.title,
    'Del Valle',
    'the airport does not open by itself',
  );
  assert.match(
    $('.place-line__near').textContent,
    /near Austin–Bergstrom International Airport \(AUS\) · 1\.5 km/,
  );
  $('.place-line__near').click();
  await settle();
  assert.equal(cards.card?.key, 'place:airport:KAUS');
  cards.open(placeIdentity({ name: 'Tarrytown', lat: 30.32, lon: -97.76 }));
  await settle();
  assert.match($('.place-line__near').textContent, /near Camp Mabry · 0\.8 km/);
  $('.place-line__near').click();
  await settle();
  assert.equal(cards.card?.layerId, 'military-installations');
  assert.equal(cards.card?.identity.id, 'b1');
});

test('a bare code is an airport only when it is large or the search landed near it', async () => {
  const regional = {
    ident: 'KJQF',
    iata: 'USA',
    name: 'Concord-Padgett Regional Airport',
    lat: 35.388,
    lon: -80.709,
    size: 'medium',
  };
  const lookUp = async () => regional;
  const country = await placeForSearch(
    { query: 'USA', label: 'United States', lat: 39.8, lon: -98.6 },
    { findAirport: lookUp },
  );
  assert.equal(country.identity.layerId, PLACE_LAYER);
  assert.equal(
    country.identity.place.airport,
    null,
    'the country, not the regional airport',
  );
  const near = await placeForSearch(
    { query: 'USA', label: 'Concord', lat: 35.4, lon: -80.6 },
    { findAirport: lookUp },
  );
  assert.equal(near.identity.id, 'airport:KJQF');
  // A label that names an airport does not hold on its own: far from the
  // airport it is the place.
  const namedFar = await placeForSearch(
    { query: 'USA', label: 'Concord-Padgett Regional Airport', lat: 0, lon: 0 },
    { findAirport: lookUp },
  );
  assert.equal(namedFar.identity.place.airport, null);
  const named = await placeForSearch(
    {
      query: 'USA',
      label: 'Concord-Padgett Regional Airport',
      lat: 35.39,
      lon: -80.71,
    },
    { findAirport: lookUp },
  );
  assert.equal(named.identity.id, 'airport:KJQF');
  // A name holds as a code does: near where the search landed.
  const byNameFar = await placeForSearch(
    { query: 'concord airport', label: 'Concord', lat: 0, lon: 0 },
    { findAirport: lookUp },
  );
  assert.equal(
    byNameFar.identity.place.airport,
    null,
    'far from it: the place',
  );
  const byName = await placeForSearch(
    { query: 'concord airport', label: 'Concord', lat: 35.4, lon: -80.6 },
    { findAirport: lookUp },
  );
  assert.equal(byName.identity.id, 'airport:KJQF');
});

test('an AUS place search opens Australia and the Austin airport row opens its airport', async (t) => {
  useAirports(t);
  const { cards, flown, search } = fixture(t);
  await search('AUS', {
    label: 'Australia',
    latitude: -25.2744,
    longitude: 133.7751,
  });
  assert.equal(cards.card?.title, 'Australia');
  assert.equal(cards.card.lat, -25.2744);
  assert.equal(cards.card.lon, 133.7751);
  assert.equal(cards.card.identity.place.airport, null);
  assert.deepEqual(flown, [], 'the search already flew to Australia');

  // A place the place service calls "AUS", far from Austin.
  announcePlacePick({ name: 'AUS', latitude: 48.2, longitude: 16.37 });
  await settle();
  assert.equal(cards.card?.layerId, PLACE_LAYER);
  assert.equal(cards.card.title, 'AUS');
  assert.equal(cards.card.lat, 48.2);
  announcePlacePick({
    name: 'Austin–Bergstrom International Airport',
    latitude: 30.1945,
    longitude: -97.6699,
    airport: 'AUS',
  });
  await settle();
  assert.equal(cards.card?.key, 'place:airport:KAUS');
});

test('a picked spot opens what its row names: an airport only at it or named near it', async () => {
  const sfo = {
    ident: 'KSFO',
    iata: 'SFO',
    name: 'San Francisco International Airport',
    lat: 37.6198,
    lon: -122.3748,
    size: 'large',
  };
  const lookUp = async () => sfo;
  // A place called "SFO" in Denmark is that place, not the airport.
  const elsewhere = await placeForSearch(
    { query: 'SFO', label: 'SFO', lat: 55.61, lon: 11.77, picked: true },
    { findAirport: lookUp },
  );
  assert.equal(elsewhere.identity.place.airport, null);
  assert.equal(elsewhere.identity.label, 'SFO');
  assert.equal(elsewhere.identity.lat, 55.61);
  // The airport's own row, at the airport.
  const atIt = await placeForSearch(
    {
      query: 'SFO',
      label: 'San Francisco International Airport',
      lat: 37.6198,
      lon: -122.3748,
      picked: true,
    },
    { findAirport: lookUp },
  );
  assert.equal(atIt.identity.id, 'airport:KSFO');
  // A spot in the city that only shares the code is the spot.
  const city = await placeForSearch(
    { query: 'SFO', label: 'SFO', lat: 37.77, lon: -122.42, picked: true },
    { findAirport: lookUp },
  );
  assert.equal(city.identity.place.airport, null);
  // A search for the code (no row of its own) still finds the large airport.
  const searched = await placeForSearch(
    { query: 'SFO', label: 'SFO', lat: 55.61, lon: 11.77 },
    { findAirport: lookUp },
  );
  assert.equal(searched.identity.id, 'airport:KSFO');
});

test('a search naming a base that Military Installations has loaded opens the base', async (t) => {
  const base = { id: 'b1', name: 'Fort Cavazos', lat: 31.135, lon: -97.776 };
  const dataManager = {
    layers: new Map([
      [
        'military-installations',
        { module: { getAnalystRecords: () => [base] } },
      ],
    ]),
    isEnabled: () => true,
  };
  const none = async () => null;
  const found = await placeForSearch(
    {
      query: 'fort cavazos',
      label: 'Fort Cavazos, TX',
      lat: 31.14,
      lon: -97.78,
    },
    { dataManager, findAirport: none },
  );
  assert.deepEqual(found.identity, {
    layerId: 'military-installations',
    id: 'b1',
    label: 'Fort Cavazos',
    lat: 31.135,
    lon: -97.776,
  });
  const plain = await placeForSearch(
    { query: 'Killeen', label: 'Killeen, TX', lat: 31.12, lon: -97.73 },
    { dataManager, findAirport: none },
  );
  assert.equal(plain.identity.layerId, PLACE_LAYER);
  assert.equal(plain.identity.label, 'Killeen, TX');
  assert.equal(
    await placeForSearch(
      { query: 'x', lat: Number.NaN, lon: 0 },
      { findAirport: none },
    ),
    null,
  );
});

test('suggestions: global layers only, never on ones or ones whose key is missing, three at most', () => {
  const rows = [
    { id: 'cctv', name: 'Cameras', enabled: false },
    { id: 'flights', name: 'Live Flights', enabled: true },
    {
      id: 'ais-live-vessels',
      name: 'Vessels',
      enabled: false,
      stats: { keyRequired: true },
    },
    { id: 'satellites', name: 'Satellites', enabled: false },
  ];
  assert.deepEqual(suggestLayers(rows, { place: true }), ['satellites']);
  assert.deepEqual(suggestLayers([], { place: true }), []);
  assert.equal(describePlace({ layerId: 'flights' }), null);
  assert.equal(
    describePlace(placeIdentity({ name: '', lat: 1, lon: 2 })).titleWords.text,
    'Picked spot',
  );
});

test('only a place pick opens a place card: a search that is part of something else does not', async (t) => {
  useAirports(t, []);
  const { cards, searchOnly, search } = fixture(t, []);
  // "flights near Austin": the plan's search moves the view, nothing more.
  await searchOnly('Austin', {
    latitude: 30.2672,
    longitude: -97.7431,
    label: 'Austin',
  });
  assert.equal(cards.card, null, 'no card from a search alone');
  // Picking the place row opens its card.
  await search('Austin', {
    latitude: 30.2672,
    longitude: -97.7431,
    label: 'Austin',
  });
  assert.equal(cards.card?.layerId, PLACE_LAYER);
  assert.equal(cards.card.title, 'Austin');
  // A pick with its own coordinates (a chip) needs no search.
  cards.clear();
  announcePlacePick({
    name: 'Zilker Park',
    latitude: 30.2669,
    longitude: -97.7729,
  });
  await settle();
  assert.equal(cards.card?.title, 'Zilker Park');
});

test('pinning the view asks for nothing: its name and place come from the header', async (t) => {
  useAirports(t, []);
  const { $, cards, pinia } = fixture(t, []);
  const pinned = usePinnedStore(pinia);
  t.after(() =>
    pinned.pins.map((pin) => pin.key).forEach((key) => pinned.unpin(key)),
  );
  cards.setView({
    center: { lat: 12.3456, lon: 45.6789 },
    rect: { west: 45.6, south: 12.3, east: 45.7, north: 12.4 },
    heightM: 2000,
    pose: {
      lon: 45.67,
      lat: 12.33,
      height: 2000,
      heading: 0,
      pitch: -1,
      roll: 0,
    },
  });
  await settle();
  const fetched = [];
  const before = globalThis.fetch;
  globalThis.fetch = async (url) => (
    fetched.push(String(url)),
    new Response('', { status: 503 })
  );
  t.after(() => {
    globalThis.fetch = before;
  });
  $('.view-context__pin').click();
  await settle();
  assert.equal(pinned.pins.length, 1);
  assert.deepEqual(fetched, [], 'no request');
});

test('with the bundled pack, picking "SFO" or "Austin airport" opens that airport card; "Austin" opens the place', async (t) => {
  const { readFile } = await import('node:fs/promises');
  const pack = JSON.parse(
    await readFile(
      new URL('../data/local_data/ourairports/airports.json', import.meta.url),
      'utf8',
    ),
  );
  useAirports(t, pack.rows);
  const { cards, search } = fixture(t, []);
  await search('SFO', {
    latitude: 37.6213,
    longitude: -122.379,
    label: 'San Francisco International Airport',
  });
  assert.equal(cards.card?.identity.id, 'airport:KSFO');
  cards.clear();
  await search('Austin airport', {
    latitude: 30.1975,
    longitude: -97.6664,
    label: 'Austin-Bergstrom International Airport',
  });
  assert.equal(cards.card?.identity.id, 'airport:KAUS');
  cards.clear();
  await search('Austin', {
    latitude: 30.2672,
    longitude: -97.7431,
    label: 'Austin',
  });
  assert.equal(cards.card?.layerId, PLACE_LAYER);
  assert.equal(
    cards.card.identity.place?.airport ?? null,
    null,
    'a city stays a place',
  );
});

test('a place pick that resolves after a newer pick leaves the newer card', async (t) => {
  // The airport pack loads lazily; it arrives only once the test lets it.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  _setAirportsFetchForTest(async () => {
    await gate;
    return new Response(JSON.stringify({ meta: {}, rows: AIRPORTS }), {
      status: 200,
    });
  });
  t.after(() => _setAirportsFetchForTest(null));
  const { cards } = fixture(t, [
    flightsLayer([{ id: 'abc', callsign: 'ABC1', lat: 30.2, lon: -97.67 }]),
  ]);
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await settle();
  // An aircraft is clicked while the airport is still being looked up.
  cards.select({ layerId: 'flights', id: 'abc' }, { follow: false });
  await settle();
  const picked = cards.card?.key;
  assert.ok(picked && !picked.startsWith('place:'), picked);
  release();
  await settle();
  assert.equal(cards.card?.key, picked, 'the aircraft card stays');
});

test('a delayed place pick cannot reopen after a newer pick was cleared', async (t) => {
  // The airport pack loads lazily; it arrives only once the test lets it.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  _setAirportsFetchForTest(async () => {
    await gate;
    return new Response(JSON.stringify({ meta: {}, rows: AIRPORTS }), {
      status: 200,
    });
  });
  t.after(() => _setAirportsFetchForTest(null));
  const { cards } = fixture(t, [
    flightsLayer([{ id: 'abc', callsign: 'ABC1', lat: 30.2, lon: -97.67 }]),
  ]);
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await settle();
  // An aircraft is clicked while the airport is still being looked up.
  cards.select({ layerId: 'flights', id: 'abc' }, { follow: false });
  await settle();
  const picked = cards.card?.key;
  assert.ok(picked && !picked.startsWith('place:'), picked);
  cards.clear();
  assert.equal(cards.card, null);
  release();
  await settle();
  assert.equal(cards.card, null, 'the newer clear stays in effect');
});

test('a non-voice place pick yields to navigation while its airport lookup is pending', async (t) => {
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  _setAirportsFetchForTest(async () => {
    await gate;
    return new Response(JSON.stringify({ rows: AIRPORTS }), { status: 200 });
  });
  t.after(() => {
    release();
    _setAirportsFetchForTest(null);
  });
  const navigation = new NavigationController({
    viewer: {},
    tracking: {},
    clearLocation() {},
    cancelShareSelection: () => true,
    isCockpitActive: () => false,
  });
  t.after(() => navigation.stop());
  const { cards, flown } = fixture(t, [], navigation);
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await settle();
  assert.equal(cards.card, null, 'the UI pick is still resolving');
  navigation._beginDeferredNavigation('location');
  release();
  await settle();
  assert.equal(
    cards.card,
    null,
    'the UI pick must yield to the newer navigation',
  );
  assert.deepEqual(flown, [], 'the old airport cannot fly the camera back');
});

test('an airport card names its source in the page language', async () => {
  const { setLocale } = await import('../i18n/index.js');
  const airport = {
    ident: 'KSFO',
    name: 'San Francisco International Airport',
    lat: 37.62,
    lon: -122.38,
    runways: [],
  };
  assert.equal(
    describePlace(placeIdentity({ airport })).source,
    'OurAirports · bundled',
  );
  setLocale('de');
  try {
    assert.equal(
      describePlace(placeIdentity({ airport })).source,
      'OurAirports · mitgeliefert',
    );
  } finally {
    setLocale('en');
  }
  assert.equal(
    describePlace(placeIdentity({ name: 'x', lat: 1, lon: 2 })).source,
    '',
  );
});
