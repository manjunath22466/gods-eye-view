// src/ui/contextPanel.test.mjs — the Context panel: what is picked, led by
// its hero, or situational awareness of the layers that are on, over
// happy-dom.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia, setActivePinia } from 'pinia';
import { computed, createApp, h, nextTick } from 'vue';
import ContextView from './views/ContextView.vue';
import EntityPreview from './views/panels/EntityPreview.vue';
import { LayerPanel } from './layerPanel.js';
import { useLayerFinderStore } from './stores/layerFinder.js';
import {
  createContextCardOpener,
  useEntityCardStore,
} from './stores/entityCard.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { useStreetLevelStore } from './stores/streetLevel.js';
import { _setFrameStillCaptureForTest } from './frameStill.js';
import {
  CAMERA_SETTINGS_EVENT,
  CONTEXT_NEARBY_EVENT,
} from './contextEvents.js';
import { placeIdentity, placePin } from './placeCard.js';
import { usePinnedStore } from './stores/pinned.js';
import { useDockedStore } from './stores/docked.js';
import { useCctvStore } from './stores/cctv.js';
import { useSpaceMissionsStore } from './stores/spaceMissions.js';
import { useLayerCountsStore } from './stores/layerCounts.js';
import { createLayerCounts } from './layerCounts.js';
import { getConfiguredLayerCounts } from '../services/application.js';
import { installEntityContext } from './entityContextBridge.js';
import { bindRenderer } from '../render/rendererOf.js';
import { fakeInput } from '../input/testDoubles.mjs';
import { fakeCameraPort } from '../testSupport/fakeCameraPort.mjs';
import { useOmnibarStore } from './stores/omnibar.js';
import { useRadioStore } from './stores/radio.js';
import { createRadioLayer } from '../layers/radio/index.js';
import { _resetPinnedStationForTest } from './pinnedStation.js';
import { useRadioLayer } from './radioContext.js';
import { presentCctvPanel } from './cctvPresentation.js';
import { contextRadiusKm, setContextRadiusKm } from './contextRadius.js';
import {
  closeContextSearch,
  contextSearchOpen,
  contextSearchText,
} from './contextSearch.js';
import { loadFleetModelSet, resetFleetModelSet } from '../data/fleetModels.js';
import fs from 'node:fs';
import { HERO_AUTOPLAY_MS } from './entityHeroViews.js';
import { useBhoteKoshiPanelStore } from './stores/bhoteKoshiPanel.js';
import { useDisplayStore } from './stores/display.js';
import { useCockpitStore } from './stores/cockpit.js';
import { createControls as createWildlifeControls } from '../layers/wildlifeSightings/controls.js';
import { firePerimeterSnapshot } from '../layers/perimeters/records.js';
import { setLocale } from '../i18n/index.js';
import { CockpitCoordinator } from './cockpitCoordinator.js';
import {
  resetContextLists,
  setContextListPresence,
  showContextList,
} from './contextLists.js';
import { createRecentImageryPanel } from './recentImagery.js';
import {
  bindPanelDisclosure,
  collapsePanelOnEscape,
} from './panelDisclosure.js';
import { createRecentImageryLayer } from '../layers/recentImagery/index.js';
import {
  BOX,
  fakeCatalog,
  fakeController,
  fakeRenderer,
  fakeThumbnails,
  manualTimers,
  settle as settleImagery,
} from '../layers/recentImagery/testDoubles.mjs';
import { bindFakeCesiumCamera } from '../testSupport/fakeCameraPort.mjs';
import { fakeGlobePort } from '../testSupport/fakeGlobePort.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('ViewContext leaves service reads and request lifetimes to the bridge', () => {
  const source = fs.readFileSync(
    new URL('./views/panels/ViewContext.vue', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /\b(?:setTimeout|AbortController|readWeather|ensureLayerCounts|noteLiveCount)\b/,
  );
});

// Austin, Texas: a zoomed-in view, well below globe scale.
const HERE = { lat: 30.27, lon: -97.74 };
const flight = (id, lat, lon) => ({
  id,
  icao24: id,
  callsign: id.toUpperCase(),
  lat,
  lon,
  altitudeM: 2500,
});

/**
 * Mount Context with a data manager whose layers are given as
 * `{id, name, enabled, records, stats}`. Returns what the tests read.
 */
// The renderer's previews, as stubs: each draws nothing and never fails.
const stubPreview = () => ({ setActive() {}, update() {}, destroy() {} });
const STUB_PREVIEWS = {
  model: stubPreview,
  route: stubPreview,
  cockpit: stubPreview,
};

/** The fleet's catalog and type map loaded as the layers load them, each model a stand-in byte. */
async function withFleet(t) {
  const file = (name) =>
    fs.readFileSync(
      new URL(`../../public/models/fleet/${name}`, import.meta.url),
      'utf8',
    );
  const info = console.info;
  console.info = () => {};
  t.after(() => {
    console.info = info;
    resetFleetModelSet();
  });
  await loadFleetModelSet({
    fetchImpl: async (url) =>
      url.endsWith('.json')
        ? new Response(file(url.slice(url.lastIndexOf('/') + 1)))
        : new Response(new Uint8Array(1)),
  });
}

function fixture(
  t,
  layers,
  {
    previews = null,
    fetchImpl = null,
    brief = null,
    getCounts = getConfiguredLayerCounts,
    openPanel = null,
    useInspector = Boolean(fetchImpl || brief),
    weatherClock,
    startOpen = true,
    finderControls = true,
  } = {},
) {
  // Weather and hazard reads stay off the network: every feed answers 503.
  const realFetch = globalThis.fetch;
  globalThis.fetch =
    fetchImpl || (async () => new Response('', { status: 503 }));
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  if (finderControls) t.after(useLayerFinderStore(pinia).attachControls());
  const app = createApp(ContextView).use(pinia);
  const cards = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const radius = contextRadiusKm.value;
  let owner = null;
  let disconnect = () => cards.connect(null);
  let mounted = false;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    app.unmount();
  };
  // Cleanup is registered before anything can throw: a fixture that fails
  // part way must not leave the app mounted, its timers running and the
  // fetch stub in place, or the test file never exits.
  t.after(() => {
    disconnect();
    if (owner) chrome.detach(owner);
    unmount();
    setContextRadiusKm(radius);
    closeContextSearch();
    contextSearchText.value = '';
    globalThis.fetch = realFetch;
  });
  app.mount(host);
  mounted = true;
  owner = chrome.connect({});
  // The layers given, kept live: a test can turn one off or empty it.
  const rows = layers.map((layer) =>
    Object.assign(layer, {
      module: {
        getAnalystRecords: () => layer.records || [],
        ...(layer.module || {}),
      },
    }),
  );
  const followed = [];
  const flown = [];
  const asked = [];
  // The data manager's change listeners: a test announces a layer change.
  const layerListeners = new Set();
  const notifyLayers = (change = { type: 'enabled' }) =>
    layerListeners.forEach((listener) => listener(change));
  let manager = {
    layers: new Map(rows.map((row) => [row.id, row])),
    isEnabled: (id) => Boolean(rows.find((row) => row.id === id)?.enabled),
    getAll: () => rows.slice(),
    subscribe(listener) {
      layerListeners.add(listener);
      return () => layerListeners.delete(listener);
    },
  };
  const dataManager = () => manager;
  let point;
  if (useInspector) {
    const viewer = { scene: {} };
    const input = fakeInput(viewer);
    const listeners = new Map();
    let pose = {};
    const unbind = bindRenderer(viewer, {
      camera: {
        pose: () => pose,
        viewRectangle: () => null,
        on(event, listener) {
          listeners.set(event, listener);
          return () => listeners.delete(event);
        },
      },
    });
    point = (center, height = 40_000) => {
      pose = { ...center, height };
      listeners.get('moveEnd')();
    };
    const counts = useLayerCountsStore(pinia);
    const dispose = installEntityContext({
      viewer,
      pinia,
      getDataManager: dataManager,
      regionalBrief: brief,
      inspector: {
        counts: createLayerCounts({
          getCounts,
          readState: () => counts.state,
          writeState: counts.publish,
          readShown: cards.readViewContextShown,
        }),
        weatherClock,
      },
    });
    disconnect = () => {
      dispose();
      unbind();
      input.destroy();
    };
  } else {
    cards.connect({
      dataManager,
      inspectorRows: () => {
        void cards.layerRevision;
        return manager.getAll();
      },
      previews: () => previews,
      openPanel,
      // As the app answers it: aircraft and satellites can be followed.
      canFollow: (card) =>
        ['flights', 'military', 'satellites'].includes(card?.layerId),
      follow: (card) => followed.push(card.key),
      flyTo: (card) => flown.push(card.key),
      ask: (card, title) => asked.push({ key: card.key, title }),
    });
  }
  chrome.publish(owner, 'global-context-panel', { collapsed: !startOpen });
  chrome.publish(owner, 'data-panel', { collapsed: true });
  const $ = (selector) => document.querySelector(selector);
  const close = () =>
    chrome.publish(owner, 'global-context-panel', { collapsed: true });
  return {
    $,
    cards,
    pinia,
    followed,
    flown,
    asked,
    close,
    notifyLayers,
    point,
    open: () =>
      chrome.publish(owner, 'global-context-panel', { collapsed: false }),
    unmount,
    replaceManager: (next) => {
      manager = next;
    },
    dataManager,
  };
}

const flightsOn = (records, stats = {}) => ({
  id: 'flights',
  name: 'Live Flights',
  enabled: true,
  records,
  stats: { count: records.length, lastUpdate: Date.now(), ...stats },
});

test('Context has no tabs and no Contacts controls; Radio has no rail panel of its own', async (t) => {
  const { $ } = fixture(t, [flightsOn([])]);
  await nextTick();
  const panel = $('#global-context-panel');
  assert.equal(panel.parentElement.id, 'right-context-rail');
  // Radio's own controls stay in the page, folded away until its stations show.
  assert.equal($('#radio-panel').tagName, 'DETAILS');
  assert.equal($('#radio-panel').closest('#right-context-rail'), null);
  assert.ok($('#radio-panel').closest('.radio-fold-home[hidden]'));
  for (const gone of [
    '.context-tabs',
    '#context-tab-btn-props',
    '#global-context-flights-btn',
    '#context-flights-view',
    '#installations-search-btn',
    '#cockpit-entry',
    '#tr3b-toggle',
  ])
    assert.equal(Boolean($(gone)), false, `${gone} is gone`);
  assert.ok($('#context-body'));
});

const NEAREST = '.nearby-lists__row--nearest button';

test('nothing picked: one list per layer that is on, nearest first; its first row selects and follows', async (t) => {
  const { $, cards, followed } = fixture(t, [
    flightsOn([flight('far01', 30.9, -97.74), flight('near01', 30.31, -97.74)]),
    // A closer vessel on a layer that is off never counts.
    {
      id: 'ais-live-vessels',
      name: 'Live Vessels',
      enabled: false,
      records: [
        {
          id: 'boat01',
          mmsi: 'boat01',
          name: 'BOAT',
          lat: 30.271,
          lon: -97.741,
        },
      ],
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const lists = [...document.querySelectorAll('.nearby-lists__layer')];
  assert.deepEqual(
    lists.map((list) => list.dataset.layer),
    ['flights'],
    'only layers that are on',
  );
  const rows = [...lists[0].querySelectorAll('li')].map(
    (row) => row.textContent,
  );
  assert.match(rows[0], /NEAR01/, 'sorted by distance');
  assert.match(rows[1], /FAR01/);
  // Every row selects its item the same way, and each says so.
  for (const button of lists[0].querySelectorAll('li button'))
    assert.equal(
      button.title,
      'Select it; aircraft and satellites are followed',
    );
  const nearest = $(NEAREST);
  assert.ok(nearest, 'the first row is marked nearest');
  assert.match(nearest.textContent, /NEAR01.*Nearest/);
  assert.doesNotMatch(
    document.querySelector('.view-context').textContent,
    /BOAT/,
  );
  nearest.click();
  await nextTick();
  assert.equal(cards.card?.identity.id, 'near01');
  assert.deepEqual(followed, [cards.card.key], 'one tap selects and follows');
});

test('Nearby fire cards localize the last growth fact', async (t) => {
  t.after(() => setLocale('en'));
  setLocale('fr');
  const growth = Date.UTC(2026, 6, 15);
  const {
    fires: [fire],
  } = firePerimeterSnapshot(
    [
      {
        stableId: 'fixture-fire',
        name: 'Fixture Fire',
        polygonTime: growth,
        polygons: [
          [
            [
              [-97.75, 30.26],
              [-97.73, 30.26],
              [-97.73, 30.28],
              [-97.75, 30.26],
            ],
          ],
        ],
      },
    ],
    { now: growth + 60_000 },
  );
  const { anchor, ...record } = fire;
  const { $, cards } = fixture(t, [
    {
      id: 'fire-perimeters',
      name: 'Fire Perimeters',
      enabled: true,
      records: [{ ...record, ...anchor }],
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  $('.nearby-lists [data-row-layer="fire-perimeters"]').click();
  await nextTick();

  const facts = $('.entity-card__facts');
  assert.ok(facts);
  const labels = [...facts.querySelectorAll('dt')].map(
    (part) => part.textContent,
  );
  assert.ok(labels.includes('Dernière progression'), labels.join(', '));
});

test('filtered Nearby keeps Acartia attribution visible on selection', async (t) => {
  contextSearchStyles(t);
  const center = { lat: 48.5, lon: -123.1 };
  const sighting = {
    ...center,
    stableId: 'acartia:9',
    origin: 'acartia',
    commonName: 'Orca',
    observedAt: Date.now(),
    provider: { name: 'Synthetic Whale Network', entity: 'Partner' },
    link: 'https://acartia.io/',
  };
  const { methods } = createWildlifeControls({
    state: { enabled: true, rows: new Map([[sighting.stableId, sighting]]) },
    services: { now: Date.now },
    parts: {},
  });
  const { $, cards, flown } = fixture(t, [
    {
      id: 'wildlife-sightings',
      name: 'Wildlife Sightings',
      enabled: true,
      module: {
        getAnalystRecords: (...args) =>
          methods.getAnalystRecords(...args).map((record) => ({
            ...record,
            website: 'https://example.com/',
          })),
      },
    },
  ]);
  cards.setView({ center, heightM: 40_000 });
  contextSearchOpen.value = true;
  contextSearchText.value = 'orca';
  await nextTick();
  assert.ok($('#context-body').classList.contains('context-searching'));

  const button = $('.nearby-lists [data-row-layer="wildlife-sightings"]');
  assert.match(button.textContent, /Orca/);
  button.click();
  await nextTick();

  assert.equal(cards.card.identity.id, sighting.stableId);
  assert.deepEqual(flown, [cards.card.key]);
  const card = $('.entity-card');
  const credit = [...card.querySelectorAll('p')].find((paragraph) =>
    paragraph.textContent.includes(
      'Reported by Synthetic Whale Network (Partner)',
    ),
  );
  assert.match(credit.textContent, /CC BY 4\.0/);
  assert.notEqual(getComputedStyle(credit).display, 'none');
  const source = card.querySelector('a[href="https://acartia.io/"]');
  const guidance = card.querySelector('a[href="https://www.bewhalewise.org"]');
  assert.match(source.textContent, /Acartia/);
  assert.equal(guidance.textContent, 'Be Whale Wise');
  for (const link of [source, guidance]) {
    for (let node = link; node !== card; node = node.parentElement) {
      assert.notEqual(getComputedStyle(node).display, 'none', link.textContent);
    }
  }
  const website = 'a[href="https://example.com/"]';
  assert.equal(card.querySelector(website), null);
  contextSearchText.value = '';
  await nextTick();
  assert.ok(card.querySelector(website));
  contextSearchText.value = 'orca';
  await nextTick();
  card.querySelector('button[aria-label="Close card"]').click();
  await nextTick();
  assert.equal(contextSearchText.value, 'orca');
  assert.ok($('.nearby-lists [data-row-layer="wildlife-sightings"]'));
});

test('the radius sits above the counts it sets; a layer with nothing in range shows only its 0', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('far01', 30.65, -97.74)]),
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const radius = $('.view-context__radius');
  const tiles = $('.view-context__tiles');
  assert.ok(radius && tiles);
  assert.ok(
    radius.compareDocumentPosition(tiles) & Node.DOCUMENT_POSITION_FOLLOWING,
    'radius first',
  );
  assert.match($('.view-context__tile[data-layer="flights"]').textContent, /1/);
  assert.match($(NEAREST).textContent, /FAR01/);
  // About 42 km away: outside a 25 km radius.
  setContextRadiusKm(25);
  await nextTick();
  assert.equal(Boolean($(NEAREST)), false);
  assert.match(
    $('.view-context__tile[data-layer="flights"] strong').textContent,
    /^0$/,
  );
  assert.match($('.view-context__label').textContent, /25/);
});

test('a picked item leads with its hero, then its actions; its full details fold away', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)])]);
  assert.equal(
    cards.select({ layerId: 'flights', id: 'test01' }, { follow: false }),
    true,
  );
  await nextTick();
  const card = $('#entity-card');
  const order = [
    '.entity-hero',
    '.entity-card__head',
    '.entity-card__actions',
  ].map((selector) => {
    const node = card.querySelector(selector);
    assert.ok(node, selector);
    return node;
  });
  for (let index = 1; index < order.length; index++)
    assert.ok(
      order[index - 1].compareDocumentPosition(order[index]) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'the hero, its name and its actions come first, in that order',
    );
  const more = card.querySelector('.entity-card__more');
  assert.ok(more, 'the full details are there');
  assert.equal(more.open, false, 'the full details start folded');
  assert.ok(
    order[2].compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the details come after the actions',
  );
  assert.equal(
    Boolean($('.view-context')),
    false,
    'awareness gives way to the card',
  );
});

// The corner icon itself needs the fleet model set to draw the 3D view; it
// was checked in the browser. Here: it never sits in the button row, and it
// stays off every view but the model, even on a followed aircraft.
test('TR-3B is never a button, and stays off the views that are not the 3D model', async (t) => {
  await withFleet(t);
  const { $, cards, pinia } = fixture(
    t,
    [flightsOn([flight('test01', 30.3, -97.7)])],
    { previews: STUB_PREVIEWS },
  );
  const cockpit = useCockpitStore(pinia);
  cockpit.publishPresence({ entryAvailable: true, tr3b: { converted: false } });
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  cards.following = cards.card.key;
  await nextTick();
  assert.equal(
    Boolean($('.entity-card__action--tr3b')),
    false,
    'no TR-3B button in the row',
  );
  const cockpitView = [
    ...document.querySelectorAll(
      '#entity-card .entity-card__preview-switch button',
    ),
  ].find((button) => button.title === 'Cockpit view');
  assert.ok(cockpitView);
  cockpitView.click();
  await nextTick();
  assert.equal(
    Boolean($('.entity-hero__ufo')),
    false,
    'not on the cockpit view',
  );
});

test('a model preview converts and restores the aircraft through its own Cockpit owner', async (t) => {
  await withFleet(t);
  const { $, cards, pinia } = fixture(
    t,
    [flightsOn([flight('test01', 30.3, -97.7)])],
    { previews: STUB_PREVIEWS },
  );
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  cards.following = cards.card.key;

  const otherPinia = createPinia();
  const otherCards = useEntityCardStore(otherPinia);
  otherCards.connect({ previews: () => STUB_PREVIEWS });
  otherCards.card = cards.card;
  otherCards.following = cards.card.key;
  const host = document.body.appendChild(document.createElement('div'));
  const otherApp = createApp(EntityPreview, {
    card: otherCards.card,
    title: 'Other preview',
  }).use(otherPinia);
  otherApp.mount(host);
  t.after(() => {
    otherApp.unmount();
    otherCards.connect(null);
    host.remove();
  });

  const receiveToggle = (appPinia) => {
    const cockpitStore = useCockpitStore(appPinia);
    const viewer = { scene: {} };
    const { port } = fakeCameraPort();
    const unbind = bindRenderer(viewer, {
      camera: port,
      frame: { on: () => () => {} },
    });
    const coordinator = new CockpitCoordinator({
      viewer,
      cockpitStore,
      services: {},
      readDataManager: () => null,
      readContext: () => null,
    });
    t.after(() => {
      coordinator.stop();
      unbind();
    });
    let converted = false;
    const publish = () => cockpitStore.publishPresence({ tr3b: { converted } });
    publish();
    // Observe the controller before its own eligibility can mask a cross-app call.
    return t.mock.method(coordinator.cockpitView, 'toggleTrackedTr3b', () => {
      converted = !converted;
      publish();
    });
  };
  const origin = receiveToggle(pinia);
  const other = receiveToggle(otherPinia);
  await nextTick();
  $('#entity-card button[title="3D model"]').click();
  await nextTick();
  const button = () => $('#entity-card .entity-hero__ufo');
  assert.equal(button().title, 'Reclassify as TR-3B');
  setActivePinia(otherPinia);
  button().click();
  await nextTick();
  assert.equal(button().title, 'Restore real aircraft');
  setActivePinia(otherPinia);
  button().click();
  await nextTick();
  assert.equal(button().title, 'Reclassify as TR-3B');
  assert.equal(origin.mock.callCount(), 2);
  assert.equal(other.mock.callCount(), 0);
});

test('globe view: a count per layer that is on, with its feed state, and no Layers on rows', async (t) => {
  const { $, cards } = fixture(t, [
    {
      id: 'ais-live-vessels',
      name: 'Live Vessels',
      enabled: true,
      records: [],
      stats: { count: 2, scope: 'area' },
    },
    { id: 'earthquakes', name: 'Earthquakes', enabled: false, records: [] },
  ]);
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  const tiles = [
    ...document.querySelectorAll(
      '.view-context__block:not(.context-list-card)',
    ),
  ];
  assert.equal(tiles.length, 1, 'each layer that is on, once');
  assert.equal(
    $('.view-context__label').textContent,
    'Layers on',
    'an area count is not labeled worldwide',
  );
  assert.match(tiles[0].textContent, /2/);
  assert.ok(
    tiles[0].querySelector('.view-context__dot--nominal'),
    'a live feed shows a live dot',
  );
  assert.equal(
    document.querySelector('.view-context__blocks button'),
    null,
    'no switches',
  );
  assert.equal(Boolean($('.view-context__live')), false, 'no Layers on rows');
  assert.equal(Boolean($(NEAREST)), false, 'no nearest at globe scale');
  assert.match($('.view-context__region').textContent, /UTC/);
});

test('globe incident scenes show their state alongside their evidence and place rows', async (t) => {
  const incidents = ['bhote-koshi-2026', 'bhote-koshi-locator'].map((id) => ({
    id,
    name: 'Bhote Koshi',
    enabled: true,
    stats: { count: 1 },
    records: [
      { id: 'story', name: 'Site', lat: 28.01, lon: 86 },
      { id: 'evidence', name: 'Evidence', lat: 28.02, lon: 86 },
    ],
  }));
  const { $, cards } = fixture(t, incidents);
  cards.setView({ center: { lat: 28, lon: 86 }, heightM: 20_000_000 });
  await nextTick();
  for (const incident of incidents) {
    const block = $(`.view-context__block[data-layer="${incident.id}"]`);
    assert.equal(block.querySelector('strong').textContent, 'Live');
    assert.equal(block.querySelectorAll('[data-row-key]').length, 2);
  }
});

test('a layer refreshing items it holds keeps its state; a feed in trouble adds a line under the tiles', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('a', 30.3, -97.7)], {
      loading: true,
      source: 'OpenSky',
      statusMessage: 'Refreshing',
    }),
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: true,
      records: [],
      stats: { loading: true },
    },
    {
      id: 'ais-live-vessels',
      name: 'Live Vessels',
      enabled: true,
      records: [],
      stats: { count: 0, error: 'socket closed', source: 'AISStream' },
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const dots = [...document.querySelectorAll('.view-context__dot')].map(
    (node) => node.getAttribute('aria-label'),
  );
  assert.equal(dots[0], 'Live', 'a refresh keeps the live state');
  assert.equal(dots[1], 'Loading');
  const problems = [...document.querySelectorAll('.view-context__problem')].map(
    (node) => node.textContent,
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /AISStream/);
});

test('with nothing on, Context shows a few facts and points to Data Layers', async (t) => {
  const { $, cards } = fixture(t, [
    { id: 'flights', name: 'Live Flights', enabled: false, records: [] },
  ]);
  cards.setView({ center: HERE, heightM: 40_000, groundM: 149 });
  await nextTick();
  const facts = [...document.querySelectorAll('.view-context__tile')].map(
    (node) => node.textContent,
  );
  assert.ok(facts.some((fact) => /Daylight/.test(fact)));
  // Day length is short on the tile and in full in its title.
  const daylight = [
    ...document.querySelectorAll(
      '.view-context__tiles--facts .view-context__tile',
    ),
  ].find((tile) => /Daylight/.test(tile.textContent));
  assert.match(daylight.querySelector('strong').textContent, /^(\d+h )?\d+m$/);
  assert.match(daylight.getAttribute('title'), /minutes?$/);
  assert.ok(facts.some((fact) => /Elevation.*149/.test(fact)));
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.doesNotMatch(
    $('.view-context__tiles--facts').textContent,
    /Elevation/,
  );
  assert.match(
    $('.view-context__pointer').textContent,
    /Turn on layers to see what is around/,
  );
  assert.equal(
    Boolean($('.view-context__radius')),
    false,
    'no radius with nothing to count',
  );
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  // At globe view Flights is suggested: its Open takes the pointer's place.
  assert.equal($('.view-context__suggest-item')?.dataset.layer, 'flights');
  assert.match(
    $('.view-context__pointer').textContent,
    /See them in Data Layers/,
  );
  assert.match($('.view-context__region').textContent, /No layers on/);
});

function contextSearchStyles(t) {
  const style = document.createElement('style');
  // Happy DOM drops the multiline :is() rule. Chromium checks the original.
  style.textContent = fs
    .readFileSync(new URL('./styles/context-dock.css', import.meta.url), 'utf8')
    .replace(/\s+/g, ' ');
  document.head.append(style);
  t.after(() => style.remove());
}

test('Context search hides the empty globe controls once the query is typed', async (t) => {
  contextSearchStyles(t);
  const { $, cards } = fixture(t, [{ ...flightsOn([]), enabled: false }]);
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  const selectors = [
    '.view-context__tiles--facts',
    '.sun-dial',
    '.view-context__camera',
    '.view-context__suggest',
  ];
  contextSearchOpen.value = true;
  contextSearchText.value = 'paris';
  await nextTick();
  assert.ok($('#context-body').classList.contains('context-searching'));
  for (const selector of selectors)
    assert.equal(getComputedStyle($(selector)).display, 'none', selector);
});

test('a new pick scrolls the card to the top; the same pick again does not', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7), flight('test02', 30.4, -97.7)]),
  ]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await turn();
  const scroller = $('#entity-card').closest('[data-rail-scroller]');
  const tops = [];
  scroller.scrollTo = ({ top }) => tops.push(top);
  cards.select({ layerId: 'flights', id: 'test02' }, { follow: false });
  await nextTick();
  await turn();
  assert.deepEqual(tops, [0]);
  cards.refresh?.();
  await nextTick();
  await turn();
  assert.deepEqual(tops, [0]);
});

test('reselecting the same aircraft by voice brings its card back from Pinned', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  const identity = { layerId: 'flights', id: 'test01' };
  cards.select(identity, { follow: false });
  await nextTick();
  $('.entity-card__action--pin').click();
  await nextTick();
  $('#context-tab-pinned').click();
  await nextTick();
  assert.equal($('#entity-card'), null);
  cards.refresh();
  await nextTick();
  assert.equal($('#entity-card'), null, 'a refresh leaves the tab alone');
  const opener = createContextCardOpener(pinia);
  assert.equal(opener.show(identity, { since: opener.generation() }), true);
  await nextTick();
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  assert.ok($('#entity-card'));
});

test('a nearest vessel is flown to, since it cannot be followed', async (t) => {
  const { $, cards, followed, flown } = fixture(t, [
    {
      id: 'ais-live-vessels',
      name: 'Live Vessels',
      enabled: true,
      records: [
        { id: 'boat01', mmsi: 'boat01', name: 'BOAT', lat: 30.28, lon: -97.74 },
      ],
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  $(NEAREST).click();
  await nextTick();
  assert.equal(cards.card?.identity.id, 'boat01');
  assert.deepEqual(followed, []);
  assert.deepEqual(flown, [cards.card.key]);
});

test('the nearby lists follow the Context search', async (t) => {
  contextSearchStyles(t);
  const { $, cards } = fixture(t, [
    flightsOn([flight('near01', 30.31, -97.74)]),
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.ok($(NEAREST));
  contextSearchOpen.value = true;
  contextSearchText.value = 'nomatchxyz';
  await nextTick();
  assert.equal(
    Boolean($(NEAREST)),
    false,
    'nothing matches, so nothing is nearest',
  );
  assert.match($('.view-context__empty').textContent, /nomatchxyz/);
  contextSearchText.value = 'near01';
  await nextTick();
  assert.match($(NEAREST).textContent, /NEAR01/);
  assert.equal(getComputedStyle($('.view-context__tiles')).display, 'none');
  assert.notEqual(getComputedStyle($('.view-context__radius')).display, 'none');
  assert.notEqual(getComputedStyle($('.nearby-lists')).display, 'none');
});

test('More details starts folded for every new pick', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7), flight('test02', 30.4, -97.7)]),
  ]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  $('.entity-card__more').open = true;
  cards.select({ layerId: 'flights', id: 'test02' }, { follow: false });
  await nextTick();
  assert.equal($('.entity-card__more').open, false);
});

test('Pin adds Inspect and Pinned tabs; a pin opens on Inspect; unpinning the last removes the tabs', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7), flight('test02', 30.4, -97.7)]),
  ]);
  const pinned = usePinnedStore(pinia);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  assert.equal(
    Boolean($('.context-pin-tabs')),
    false,
    'no tabs with nothing pinned',
  );
  const pin = $('.entity-card__action--pin');
  assert.ok(pin, 'Pin is among the actions');
  assert.equal(
    Boolean($('.entity-hero .entity-card__action--pin')),
    false,
    'never on the hero',
  );
  pin.click();
  await nextTick();
  assert.ok($('#context-tab-inspect') && $('#context-tab-pinned'));
  assert.match($('#context-tab-pinned').textContent, /Pinned · 1/);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  $('#context-tab-pinned').click();
  await nextTick();
  assert.equal(
    Boolean($('#entity-card')),
    false,
    'Pinned shows the grid, not the card',
  );
  assert.equal(
    document.querySelectorAll('.pinned-grid__tile').length,
    1,
    'one tile, no empty slots',
  );
  // A new pick shows on Inspect.
  cards.select({ layerId: 'flights', id: 'test02' }, { follow: false });
  await nextTick();
  assert.equal(pinned.tab, 'inspect');
  assert.equal(cards.card.identity.id, 'test02');
  // Tapping a pin selects it and switches to Inspect; the pin stays.
  pinned.show('pinned');
  await nextTick();
  $('.pinned-grid__open').click();
  await nextTick();
  assert.equal(cards.card.identity.id, 'test01');
  assert.equal(pinned.tab, 'inspect');
  assert.equal(pinned.pins.length, 1);
  pinned.unpin(pinned.pins[0].key);
  await nextTick();
  assert.equal(Boolean($('.context-pin-tabs')), false);
  // The last pin gone takes the tabs with it, but its Undo stays in reach.
  const undo = $('.pin-undo-notice button');
  assert.ok(undo, 'Undo is offered after the last unpin');
  undo.click();
  await nextTick();
  assert.equal(pinned.pins.length, 1, 'Undo puts it back');
  pinned.unpin(pinned.pins[0].key);
});

// A pinned place wears its card map's marker, an amber ring around its
// glyph (the airport glyph for an airport, a pin otherwise), apart from the
// items pinned beside it, which wear the sprite the map drew them with.
test('pinned places wear their place marker; pinned aircraft keep the plane', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  const airport = {
    ident: 'KDCA',
    iata: 'DCA',
    name: 'Ronald Reagan Washington National Airport',
    lat: 38.8521,
    lon: -77.0377,
  };
  pinned.pin(placePin(placeIdentity({ airport }), airport.name));
  pinned.pin(
    placePin(
      placeIdentity({
        name: 'Austin',
        lat: 30.27,
        lon: -97.74,
        from: 'search',
      }),
      'Austin',
    ),
  );
  pinned.pin({
    key: 'flights:n8832j',
    kind: 'item',
    title: 'N8832J',
    icon: 'flight',
    mark: 'helicopter',
    still: '/still/n.png',
    identity: { layerId: 'flights', id: 'n8832j' },
  });
  t.after(() =>
    pinned.pins.map((pin) => pin.key).forEach((key) => pinned.unpin(key)),
  );
  pinned.show('pinned');
  await nextTick();
  const tiles = [...document.querySelectorAll('.pinned-grid__tile')].map(
    (tile) => {
      const icon = tile.querySelector('.pinned-grid__icon');
      return [
        tile.textContent.includes('N8832J')
          ? 'aircraft'
          : tile.textContent.includes('Austin')
            ? 'place'
            : 'airport',
        icon.dataset.mark || icon.textContent.trim(),
        icon.classList.contains('pinned-grid__icon--place'),
      ];
    },
  );
  assert.deepEqual(tiles.sort(), [
    ['aircraft', 'helicopter', false],
    ['airport', 'local_airport', true],
    ['place', 'location_on', true],
  ]);
  assert.ok($('.pinned-grid__icon--place'));
});

test('pins have no limit: a fifth keeps all five, the grid holds them all, and Undo on unpin puts one back', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  const item = (n) => ({
    key: `flights:${n}`,
    kind: 'item',
    title: `ITEM${n}`,
    icon: 'flight',
    still: `/still/${n}.png`,
    identity: { layerId: 'flights', id: String(n) },
  });
  for (const n of [1, 2, 3, 4, 5, 6]) pinned.pin(item(n));
  t.after(() =>
    pinned.pins.map((pin) => pin.key).forEach((key) => pinned.unpin(key)),
  );
  await nextTick();
  assert.deepEqual(
    pinned.pins.map((pin) => pin.title),
    ['ITEM1', 'ITEM2', 'ITEM3', 'ITEM4', 'ITEM5', 'ITEM6'],
    'nothing made room',
  );
  assert.equal(
    Boolean($('.context-pin-notice')),
    false,
    'no replaced-the-oldest notice',
  );
  pinned.show('pinned');
  await nextTick();
  assert.equal(document.querySelectorAll('.pinned-grid__tile').length, 6);
  assert.match($('.pinned-grid__title').textContent, /Pinned · 6/);
  assert.doesNotMatch(
    $('.pinned-grid__title').textContent,
    /of/,
    'no cap in the title',
  );
  // Unpinning says what went and offers Undo, which puts it back where it was.
  document.querySelectorAll('.pinned-grid__unpin')[2].click();
  await nextTick();
  assert.equal(pinned.pins.length, 5);
  assert.match($('.pin-undo-notice').textContent, /Unpinned ITEM3/);
  $('.pin-undo-notice button').click();
  await nextTick();
  assert.deepEqual(
    pinned.pins.map((pin) => pin.title),
    ['ITEM1', 'ITEM2', 'ITEM3', 'ITEM4', 'ITEM5', 'ITEM6'],
  );
  assert.equal(pinned.stillOf('flights:3'), '/still/3.png', 'with its still');
  assert.equal(Boolean($('.pin-undo-notice')), false);
});

test('Esc anywhere in Context clears the pick first, then the search (text kept); pins stay', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.unpin('flights:x'));
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  contextSearchOpen.value = true;
  contextSearchText.value = 'swa';
  await nextTick();
  const esc = (target) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };
  // From the search field, the pick still goes first.
  assert.equal(esc($('.context-search__input')), true);
  await nextTick();
  assert.equal(cards.card, null, 'the pick goes first');
  assert.equal(contextSearchOpen.value, true);
  // From a header button, the search closes next and keeps its text.
  assert.equal(esc($('#global-context-panel .context-dock-btn')), true);
  assert.equal(contextSearchOpen.value, false, 'then the search');
  assert.equal(contextSearchText.value, 'swa', 'its text is kept');
  assert.equal(
    esc($('#global-context-panel .cyber-panel-body')),
    false,
    'then the panel may collapse',
  );
  assert.equal(pinned.pins.length, 1, 'pins stay');
});

const escKey = (target) => {
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
};

// The pick is cleared only where it shows: on Lists or Pinned it is out of
// view, so Esc there leaves it.
test('Esc on the Lists or the Pinned tab leaves the pick; on Inspect it clears it', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  t.after(resetContextLists);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.unpin('flights:x'));
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  pinned.show('pinned');
  await nextTick();
  assert.equal($('#context-tab-pinned').getAttribute('aria-selected'), 'true');
  assert.equal(
    escKey($('#context-tab-pinned')),
    false,
    'nothing for Context to do on Pinned',
  );
  assert.equal(
    cards.card?.identity.id,
    'test01',
    'the pick stays while Pinned shows',
  );
  setContextListPresence('weather', { count: 2 });
  showContextList('weather');
  await nextTick();
  assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
  assert.equal(
    escKey($('#weather-panel-body')),
    false,
    'nothing for Context to do on Lists',
  );
  assert.equal(
    cards.card?.identity.id,
    'test01',
    'the pick stays while a list shows',
  );
  // With the search open, that Esc closes the search instead, and only it.
  contextSearchOpen.value = true;
  await nextTick();
  assert.equal(escKey($('#weather-panel-body')), true);
  assert.equal(contextSearchOpen.value, false, 'the search closes');
  assert.equal(cards.card?.identity.id, 'test01', 'the pick still stays');
  $('#context-tab-inspect').click();
  await nextTick();
  assert.equal(escKey($('#context-tab-inspect')), true);
  assert.equal(cards.card, null, 'on Inspect the pick clears');
});

// Folded, Context shows neither the pick nor the search: its Esc leaves both.
test('Esc on a folded Context leaves the pick it does not show', async (t) => {
  const { $, cards, close } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  close();
  await nextTick();
  const title = $('#global-context-panel .context-title-open');
  assert.ok(title, 'Context is folded');
  assert.equal(escKey(title), false, 'nothing for Context to do');
  assert.equal(cards.card?.identity.id, 'test01', 'the pick stays');
});

/** Recent Imagery's real readout and layer, in Context's list body. */
async function recentImageryInContext(t) {
  const timers = manualTimers();
  const catalog = fakeCatalog();
  const layer = createRecentImageryLayer({
    catalog,
    renderer: fakeRenderer(),
    thumbnails: fakeThumbnails(),
    host: () => ({ collection: {}, kind: 'globe' }),
    now: () => new Date('2026-09-21T15:00:00Z'),
    setTimeoutImpl: timers.setTimeoutImpl,
    clearTimeoutImpl: timers.clearTimeoutImpl,
  });
  layer.setSources({ viirs: true });
  const viewer = {
    camera: {},
    scene: { canvas: { clientWidth: 1000 }, requestRender() {} },
  };
  bindFakeCesiumCamera(viewer, { globe: fakeGlobePort() });
  layer.init(viewer);
  layer.attachMapStackController(fakeController());
  let active = false;
  const tool = {
    start() {
      active = true;
      layer.setToolActive(true);
    },
    cancel() {
      active = false;
      layer.setToolActive(false);
    },
    isActive: () => active,
  };
  const readout = createRecentImageryPanel({
    container: document.getElementById('recent-imagery-panel-body'),
    layer,
    viewer,
    tool,
    createSplit: () => ({ setValue() {}, destroy() {} }),
    fetchImpl: async () => new Response(''),
  });
  t.after(() => {
    readout.destroy?.();
    resetContextLists();
  });
  layer.enable();
  layer.setBox(BOX);
  catalog.resolveLast();
  await settleImagery();
  await nextTick();
  return { layer, tool, readout };
}

test('Esc in Recent Imagery’s box tool or preview is the readout’s alone; then Context’s', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)])]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  const { layer, tool, readout } = await recentImageryInContext(t);
  showContextList('recent-imagery');
  contextSearchOpen.value = true;
  await nextTick();
  const root = readout.root;
  // A day's row, where the keyboard is in the list.
  const strip = root.querySelector('.ri-card-open');
  assert.ok(root.closest('#global-context-panel'), 'the readout is in Context');
  // Previewing a day (the first day shows at once): Esc from elsewhere in
  // the readout clears the preview and nothing else.
  assert.ok(layer.getSnapshot().preview.key, 'a day is previewed');
  assert.equal(root.hasAttribute('data-owns-escape'), true);
  assert.equal(escKey(root.querySelector('#ri-opacity')), true);
  assert.equal(layer.getSnapshot().preview.key, null, 'the preview is cleared');
  assert.equal(contextSearchOpen.value, true, 'the search stays open');
  assert.equal(cards.card?.identity.id, 'test01', 'the pick stays');
  await nextTick();
  assert.equal(
    root.hasAttribute('data-owns-escape'),
    false,
    'idle, Esc is not its own',
  );
  // Drawing a box: Esc on a day’s row cancels the tool and nothing else.
  tool.start();
  await nextTick();
  assert.equal(root.hasAttribute('data-owns-escape'), true);
  assert.equal(escKey(strip), true);
  assert.equal(tool.isActive(), false, 'the box tool is cancelled');
  assert.equal(contextSearchOpen.value, true, 'the search stays open');
  // Nothing of its own left: the next Esc is Context's, which closes the
  // search, and the row is not blurred by the same key press.
  await nextTick();
  assert.equal(root.hasAttribute('data-owns-escape'), false);
  strip.focus();
  let blurred = 0;
  strip.addEventListener('blur', () => blurred++);
  assert.equal(escKey(strip), true);
  assert.equal(contextSearchOpen.value, false, 'Context closes the search');
  assert.equal(blurred, 0, 'the row keeps focus');
  assert.equal(
    cards.card?.identity.id,
    'test01',
    'the pick, out of view on Lists, stays',
  );
});

test('Esc while typing a camera calibration value cancels the edit and keeps the card', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  const cctv = useCctvStore(pinia);
  cctv.publish(
    presentCctvPanel({ enabled: true, activeCameraId: 'cam1' }, true),
  );
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  $('#context-tab-camera').click();
  await nextTick();
  await nextTick();
  const finished = [];
  cctv.setCalEdit({
    field: 'heading',
    label: 'HDG ',
    ariaLabel: 'Heading',
    step: '1',
    value: '90',
    finish: (commit) => finished.push(commit),
  });
  await nextTick();
  const input = $('#context-tab-panel .cctv-cal-input');
  assert.ok(input, 'the value is being typed in the Camera settings tab');
  // Vue ignores an event stamped in the same millisecond its listener was
  // attached; a person never types that fast.
  await new Promise((resolve) => setTimeout(resolve, 5));
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  input.dispatchEvent(event);
  assert.deepEqual(finished, [false], 'the edit is cancelled');
  assert.equal(cards.card?.identity.id, 'cam1', 'the camera card stays');
  // The card is out of view on Camera settings, so Esc there leaves it; on
  // Inspect it clears the pick.
  assert.equal(escKey($('#context-tab-camera')), false);
  assert.equal(cards.card?.identity.id, 'cam1');
  $('#context-tab-inspect').click();
  await nextTick();
  assert.equal(escKey($('#context-tab-inspect')), true);
  assert.equal(cards.card, null);
});

test('clearing the pick from inside its card keeps focus in Context', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)])]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  const button = $('.entity-card__action--pin');
  button.focus();
  button.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  await nextTick();
  assert.equal(cards.card, null);
  assert.equal(
    document.activeElement,
    $('#global-context-panel .cyber-panel-body'),
    'focus moves to the panel body, ahead of the card leaving',
  );
});

/**
 * A Radio layer module double: two stations near Austin, one far away. It
 * plays as the layer does: playStation works with the layer off, pause
 * keeps the station, stop lets it go, and turning off (`turnOff`, as Clear
 * all or Radio off do) keeps only a stream the player asked to keep.
 */
function radioLayer({ playing = null } = {}) {
  const stations = [
    {
      id: 'kut',
      name: 'KUT 90.5',
      lat: 30.28,
      lon: -97.74,
      tags: ['news'],
      state: 'Texas',
      country: 'US',
    },
    { id: 'kutx', name: 'KUTX 98.9', lat: 30.3, lon: -97.7, tags: ['music'] },
    { id: 'far', name: 'FAR FM', lat: 40.7, lon: -74, tags: ['talk'] },
  ];
  const listeners = new Set();
  const calls = [];
  let keep = null;
  const derive = (next) => ({
    ...next,
    playingStation:
      stations.find((station) => station.id === next.playingStationId) || null,
    filteredCount: next.filteredCount ?? stations.length,
  });
  let state = derive({
    enabled: true,
    filter: 'all',
    categories: [
      { id: 'all', label: 'All' },
      { id: 'news', label: 'News' },
    ],
    presentationActive: true,
    acceptedCatalogGeneration: 1,
    selected: stations[0],
    audioState: playing ? 'playing' : 'stopped',
    playingStationId: playing,
    volume: 0.8,
  });
  const radio = {
    calls,
    stations,
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    emit(patch) {
      state = derive({ ...state, ...patch });
      for (const listener of listeners) listener(state);
    },
    state: () => state,
    getUIState: () => state,
    getRadioAcceptedCatalogSnapshot: () => ({ stations }),
    filterRadioStations: (all) => all,
    selectStation(id, options) {
      calls.push(['select', id, options?.autoplay ?? false]);
      const station = stations.find((each) => each.id === id);
      if (!station) return false;
      radio.emit(
        options?.autoplay
          ? { selected: station, audioState: 'loading', playingStationId: id }
          : { selected: station },
      );
      return true;
    },
    playStation(id) {
      calls.push(['play', id]);
      const station = stations.find((each) => each.id === id);
      if (!station) return false;
      radio.emit({
        selected: station,
        audioState: 'loading',
        playingStationId: id,
      });
      return true;
    },
    pause() {
      calls.push(['pause']);
      radio.emit({ audioState: 'paused' });
      return true;
    },
    togglePlayback: () => calls.push(['toggle']),
    stopPlayback() {
      calls.push(['stop']);
      radio.emit({ audioState: 'stopped', playingStationId: null });
    },
    stepStationWhileOff(direction) {
      calls.push(['step', direction]);
      return true;
    },
    keepStreamWhenOff: (predicate) => (keep = predicate),
    /** Radio turning off as the layer does: a kept stream plays on. */
    turnOff() {
      const kept =
        state.playingStationId && keep?.(state.playingStationId) === true;
      radio.emit({
        enabled: false,
        presentationActive: false,
        ...(kept ? {} : { audioState: 'stopped', playingStationId: null }),
      });
    },
  };
  return radio;
}

test('Radio on: its stations show in Context, nearest first within the radius; only the selected one can be pinned', async (t) => {
  const radio = radioLayer();
  const { $, cards, pinia, close } = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  const rows = [...document.querySelectorAll('.radio-stations__list li')].map(
    (row) => row.textContent,
  );
  assert.equal(rows.length, 2, 'the far station is outside the radius');
  assert.match(rows[0], /KUT 90\.5/);
  assert.equal(
    document.querySelectorAll('.radio-stations .entity-card__action--pin')
      .length,
    1,
    'one Pin, on the selected station',
  );
  assert.ok(
    $('#radio-fold-slot #radio-panel'),
    'the fold moves under the list',
  );
  document.querySelectorAll('.radio-stations__list button')[1].click();
  assert.deepEqual(
    radio.calls.at(-1),
    ['select', 'kutx', true],
    'a row plays its station',
  );
  $('.radio-stations .entity-card__action--pin').click();
  await nextTick();
  const pinned = usePinnedStore(pinia);
  t.after(() => pinned.unpin('radio:kut'));
  assert.deepEqual(
    pinned.pins.map((pin) => [pin.key, pin.kind]),
    [['radio:kut', 'station']],
  );
  // Closing Context takes the list away; the fold goes back to its home.
  close();
  await nextTick();
  await nextTick();
  assert.ok(
    $('.radio-fold-home > #radio-panel'),
    'the fold is back in the page',
  );
});

/**
 * Rows laid out as a browser would, for the list's height cap: each row
 * 24 px tall, one under another (happy-dom lays nothing out).
 */
function layRowsOut(t) {
  const row = (el) =>
    el.tagName === 'LI' &&
    el.parentElement?.classList.contains('radio-stations__list');
  const proto = globalThis.HTMLElement.prototype;
  const top = Object.getOwnPropertyDescriptor(proto, 'offsetTop');
  const height = Object.getOwnPropertyDescriptor(proto, 'offsetHeight');
  Object.defineProperty(proto, 'offsetTop', {
    configurable: true,
    get() {
      return row(this)
        ? [...this.parentElement.children].indexOf(this) * 24
        : (top?.get?.call(this) ?? 0);
    },
  });
  Object.defineProperty(proto, 'offsetHeight', {
    configurable: true,
    get() {
      return row(this) ? 24 : (height?.get?.call(this) ?? 0);
    },
  });
  t.after(() => {
    if (top) Object.defineProperty(proto, 'offsetTop', top);
    else delete proto.offsetTop;
    if (height) Object.defineProperty(proto, 'offsetHeight', height);
    else delete proto.offsetHeight;
  });
}

async function radioWithStations(t, count) {
  layRowsOut(t);
  const radio = radioLayer();
  for (let i = radio.stations.length; i < count + 1; i++)
    radio.stations.push({
      id: `near${i}`,
      name: `Near ${i}`,
      lat: 30.27 + i * 0.01,
      lon: -97.74,
      tags: ['music'],
    });
  const fixed = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = fixed.cards.layerModule;
  fixed.cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  fixed.cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  await nextTick();
  return { ...fixed, radio };
}

test('over seven stations, the list shows seven rows and scrolls the rest; the count stays in the header', async (t) => {
  const { $ } = await radioWithStations(t, 11);
  const list = $('.radio-stations__list');
  assert.equal(list.children.length, 11);
  assert.ok(list.classList.contains('is-capped'));
  assert.ok(
    list.classList.contains('ui-scroll'),
    'the thin scrollbar Context uses',
  );
  assert.equal(list.style.maxHeight, '168px', 'the seventh row’s bottom');
  assert.match($('.radio-stations__label').textContent, /· 11/);
  // A row the keyboard reaches comes into view.
  const row = list.children[9];
  const shown = [];
  row.scrollIntoView = (options) => shown.push(options);
  row.querySelector('button').focus();
  await nextTick();
  assert.deepEqual(shown, [{ block: 'nearest' }]);
});

test('seven stations or fewer show in full, with no cap', async (t) => {
  const { $ } = await radioWithStations(t, 7);
  const list = $('.radio-stations__list');
  assert.equal(list.children.length, 7);
  assert.equal(list.classList.contains('is-capped'), false);
  assert.equal(list.style.maxHeight, '');
});

/** Context open on the station list near Austin, Radio on (`playing`: a station heard). */
async function radioOnWithList(t, { playing = 'kut' } = {}) {
  const radio = radioLayer({ playing });
  const fixed = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = fixed.cards.layerModule;
  fixed.cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  fixed.cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  const pinned = usePinnedStore(fixed.pinia);
  t.after(() => pinned.unpin('radio:kut'));
  return { ...fixed, radio, pinned };
}

// A station's name is third-party text: Fly to goes to the station's own
// coordinates and never looks its name up as a place.
test("Radio's Fly to flies to the station's coordinates, not to a place named like it", async (t) => {
  const { $, radio, pinia } = await radioOnWithList(t);
  const calls = [];
  useOmnibarStore(pinia).connectRunner(async (name, args) => {
    calls.push([name, args]);
    return { ok: true };
  });
  t.after(() => useOmnibarStore(pinia).connectRunner(null));
  for (const name of ['JFK', 'Austin']) {
    const station = { ...radio.stations[0], name };
    radio.emit({ selected: station });
    await nextTick();
    [...document.querySelectorAll('.radio-stations button')]
      .find((button) => /Fly to/.test(button.textContent))
      .click();
    assert.deepEqual(
      calls.at(-1),
      ['fly_to_location', { latitude: station.lat, longitude: station.lon }],
      name,
    );
  }
  assert.ok($('.radio-stations__list'), 'the station list stays');
});

const MINI_CONTROLS = [
  '.radio-mini__pin',
  '[aria-label="Previous filtered station"]',
  '.radio-mini__play',
  '[aria-label="Next filtered station"]',
  '.radio-mini__close',
  '.radio-volume__mute',
];
const miniControls = ($) =>
  MINI_CONTROLS.map((selector) => Boolean($(`.radio-mini ${selector}`)));

test('Radio on with the station list open: an unpinned station playing is in the mini player, live, with every control', async (t) => {
  const { $ } = await radioOnWithList(t);
  assert.ok($('.radio-stations__list'), 'the list is open');
  assert.match($('.radio-mini').textContent, /KUT 90\.5/);
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
  assert.deepEqual(
    miniControls($),
    MINI_CONTROLS.map(() => true),
  );
});

// Radio on, Context open as a panel on its station list, nothing selected:
// playing the nearest station brings the mini player at once, loading, with
// the list still in view, and it stays while the stream loads and plays.
test('Radio on, nothing selected: playing a station from the open list shows the mini player at once, loading, then live', async (t) => {
  const { $, radio } = await radioOnWithList(t, { playing: null });
  radio.emit({ selected: null, audioState: 'stopped', playingStationId: null });
  await nextTick();
  assert.ok($('.radio-stations__list'), 'the list is open');
  assert.equal($('.radio-mini'), null, 'nothing selected, nothing to show');
  document.querySelector('.radio-stations__list button').click();
  await nextTick();
  assert.ok($('.radio-stations__list'), 'the list stays in view');
  assert.ok($('.radio-mini'), 'shown as the station starts');
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'loading',
    'not live while it loads',
  );
  assert.equal(
    $('.radio-mini .feed-dot').getAttribute('aria-label'),
    'Loading',
  );
  radio.emit({ audioState: 'playing' });
  await nextTick();
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'live',
    'still shown, playing',
  );
  assert.deepEqual(
    miniControls($),
    MINI_CONTROLS.map(() => true),
  );
});

test('a station selected and paused or loading keeps the mini player with Radio on', async (t) => {
  const { $, radio } = await radioOnWithList(t, { playing: null });
  assert.match(
    $('.radio-mini').textContent,
    /KUT 90\.5/,
    'selected, not yet playing',
  );
  assert.equal($('.radio-mini .feed-dot'), null);
  radio.emit({ audioState: 'loading', playingStationId: 'kut' });
  await nextTick();
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'loading',
    'loading is not live',
  );
  assert.equal(
    $('.radio-mini .feed-dot').getAttribute('aria-label'),
    'Loading',
  );
  radio.emit({ audioState: 'buffering' });
  await nextTick();
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'loading',
    'nor is buffering',
  );
  radio.emit({ audioState: 'playing' });
  await nextTick();
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
  assert.equal($('.radio-mini .feed-dot').getAttribute('aria-label'), 'Live');
  radio.emit({ audioState: 'paused' });
  await nextTick();
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'paused');
  assert.deepEqual(
    miniControls($),
    MINI_CONTROLS.map(() => true),
    'every control, whatever the state',
  );
});

test('Now playing and the mini player read one playback state, both ways', async (t) => {
  const { $, radio } = await radioOnWithList(t);
  const nowState = () => $('.radio-stations__state').textContent;
  const nowButton = () => $('.radio-stations__actions button').textContent;
  assert.match(nowState(), /Playing/);
  assert.match(nowButton(), /Pause/);
  assert.equal(
    $('.radio-mini__play').getAttribute('aria-label'),
    'Pause KUT 90.5',
  );
  // Pausing in the mini player.
  $('.radio-mini__play').click();
  await nextTick();
  assert.deepEqual(radio.calls.at(-1), ['pause']);
  assert.match(nowState(), /Paused/);
  assert.match(nowButton(), /Play/);
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'paused');
  // Playing from Now playing.
  $('.radio-stations__actions button').click();
  await nextTick();
  assert.deepEqual(radio.calls.at(-1), ['play', 'kut']);
  assert.match(nowState(), /Loading/);
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'loading',
    'Loading, as Now playing says',
  );
  assert.equal(
    $('.radio-mini__play').getAttribute('aria-label'),
    'Pause KUT 90.5',
  );
  // Pausing from Now playing; the mini player follows.
  radio.emit({ audioState: 'playing' });
  await nextTick();
  $('.radio-stations__actions button').click();
  await nextTick();
  assert.equal(
    $('.radio-mini__play').getAttribute('aria-label'),
    'Play KUT 90.5',
  );
  // Another station heard while KUT stays selected: neither says KUT plays.
  radio.emit({ audioState: 'playing', playingStationId: 'kutx' });
  await nextTick();
  assert.match(nowState(), /Ready/);
  assert.match(
    $('.radio-mini').textContent,
    /KUTX 98\.9/,
    'the player holds the station heard',
  );
});

test('the mini player’s Pin toggles, and unpinning never stops the station', async (t) => {
  const { $, radio, pinned } = await radioOnWithList(t);
  const pin = () => $('.radio-mini__pin');
  assert.equal(pin().getAttribute('aria-pressed'), 'false');
  assert.equal(pin().getAttribute('aria-label'), 'Pin KUT 90.5');
  pin().click();
  await nextTick();
  assert.equal(pinned.isPinned('radio:kut'), true);
  assert.equal(pin().getAttribute('aria-pressed'), 'true');
  assert.equal(pin().disabled, false, 'still a button');
  assert.equal(
    pin().getAttribute('aria-label'),
    'Pin KUT 90.5',
    'one name; aria-pressed says it is on',
  );
  const before = radio.calls.length;
  pin().click();
  await nextTick();
  assert.equal(pinned.isPinned('radio:kut'), false);
  assert.deepEqual(radio.calls.slice(before), [], 'no stop or pause');
  assert.equal(radio.state().audioState, 'playing');
  assert.equal(
    $('.radio-mini .feed-dot').dataset.state,
    'live',
    'the player stays',
  );
  // Pinned during this playback, it stays kept through Radio off.
  radio.turnOff();
  await settle();
  assert.equal(radio.state().audioState, 'playing');
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
});

test('a station never pinned while it played stops with Radio off, and the player goes', async (t) => {
  const { $, radio } = await radioOnWithList(t);
  radio.turnOff();
  await settle();
  assert.equal(radio.state().audioState, 'stopped');
  assert.equal($('.radio-mini'), null);
});

test('Close stops the station heard and puts the player away, pinned or not', async (t) => {
  const { $, radio, pinned } = await radioOnWithList(t);
  $('.radio-mini__close').click();
  await nextTick();
  assert.deepEqual(radio.calls.at(-1), ['stop']);
  assert.equal($('.radio-mini'), null);
  // Pinned: Close still stops it.
  radio.playStation('kut');
  pinned.pin({
    key: 'radio:kut',
    kind: 'station',
    title: 'KUT 90.5',
    icon: 'radio',
    identity: { layerId: 'radio', id: 'kut' },
  });
  await nextTick();
  assert.ok($('.radio-mini'), 'back as the station plays again');
  $('.radio-mini__close').click();
  await nextTick();
  assert.deepEqual(radio.calls.at(-1), ['stop']);
  assert.equal($('.radio-mini'), null);
  assert.equal(radio.state().playingStationId, null);
});

test('Close from the keyboard hands focus to Context, which stays', async (t) => {
  const { $ } = await radioOnWithList(t);
  const close = $('.radio-mini__close');
  close.focus();
  close.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  await nextTick();
  assert.equal($('.radio-mini'), null);
  assert.ok(
    document.activeElement?.closest('#global-context-panel'),
    `focus is in Context, not on ${document.activeElement?.tagName}`,
  );
});

test('where nothing hovers, the mini player’s speaker is a volume disclosure and Mute is inside', async (t) => {
  const realMatchMedia = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({
    matches: query === '(hover: none)',
    media: query,
  });
  t.after(() => (globalThis.matchMedia = realMatchMedia));
  const { $ } = await radioOnWithList(t);
  const speaker = $('.radio-mini .radio-volume > .radio-volume__mute');
  assert.equal(speaker.getAttribute('aria-label'), 'Radio volume');
  assert.equal(speaker.getAttribute('aria-expanded'), 'false');
  assert.equal(speaker.hasAttribute('aria-pressed'), false);
  speaker.click();
  await nextTick();
  assert.equal(speaker.getAttribute('aria-expanded'), 'true');
  const mute = $('.radio-mini .radio-volume__slider .radio-volume__mute');
  assert.equal(mute.getAttribute('aria-label'), 'Mute radio');
  assert.equal(mute.getAttribute('aria-pressed'), 'false');
});

test('volume: Now playing, the mini player and the Tuner fold set one user volume, and mute and unmute together', async (t) => {
  const { $, radio, pinia } = await radioOnWithList(t);
  // As RadioControls answers it: the layer's params, persisted, then the
  // layer's state (the fold presents the same state).
  const persisted = [];
  const owner = useRadioStore(pinia).connect({
    setRadioVolume(percent) {
      persisted.push(percent / 100);
      radio.emit({ volume: percent / 100 });
    },
  });
  t.after(() => useRadioStore(pinia).detach(owner));
  const nowSlider = () => $('.radio-stations__volume .radio-volume__range');
  const miniSlider = () => $('.radio-mini .radio-volume__range');
  const slide = (input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  assert.equal(nowSlider().getAttribute('aria-label'), 'Volume, 80%');
  assert.equal(miniSlider().getAttribute('aria-label'), 'Volume, 80%');
  slide(nowSlider(), 40);
  await nextTick();
  assert.equal(miniSlider().value, '40', 'the mini player follows Now playing');
  assert.equal(miniSlider().getAttribute('aria-label'), 'Volume, 40%');
  slide(miniSlider(), 65);
  await nextTick();
  assert.equal(nowSlider().value, '65', 'Now playing follows the mini player');
  // The fold's slider is the same action.
  slide($('#radio-volume'), 30);
  await nextTick();
  assert.equal(nowSlider().value, '30');
  assert.equal(miniSlider().value, '30');
  assert.deepEqual(persisted, [0.4, 0.65, 0.3]);
  // Mute in the mini player mutes both; unmute in Now playing brings 30 back.
  const miniMute = $('.radio-mini .radio-volume__mute');
  assert.equal(miniMute.getAttribute('aria-label'), 'Mute radio');
  miniMute.click();
  await nextTick();
  const nowMute = $('.radio-stations__volume .radio-volume__mute');
  assert.equal(nowMute.getAttribute('aria-pressed'), 'true');
  assert.equal(nowMute.getAttribute('aria-label'), 'Unmute radio');
  assert.equal(nowSlider().value, '0');
  nowMute.click();
  await nextTick();
  assert.equal(miniSlider().value, '30');
  assert.equal(
    $('.radio-mini .radio-volume__mute').getAttribute('aria-pressed'),
    'false',
  );
  assert.deepEqual(persisted, [0.4, 0.65, 0.3, 0, 0.3]);
  // Voice ducking lowers what is heard, never the volume shown.
  radio.emit({ voiceDucked: true, effectiveVolume: 0 });
  await nextTick();
  assert.equal(nowSlider().value, '30');
  assert.equal(miniSlider().value, '30');
  assert.equal(
    $('.radio-mini .radio-volume__mute').getAttribute('aria-pressed'),
    'false',
  );
});

test('volume: unmute after sliding down to zero brings back the level the slide started from', async (t) => {
  const { $, radio, pinia } = await radioOnWithList(t);
  const owner = useRadioStore(pinia).connect({
    setRadioVolume(percent) {
      radio.emit({ volume: percent / 100 });
    },
  });
  t.after(() => useRadioStore(pinia).detach(owner));
  const nowSlider = () => $('.radio-stations__volume .radio-volume__range');
  const slide = (input, value) => {
    input.value = String(value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const slider = nowSlider();
  slider.focus();
  for (const value of [60, 40, 20, 3, 1, 0]) {
    slide(slider, value);
    await nextTick();
  }
  slider.blur();
  $('.radio-stations__volume .radio-volume__mute').click();
  await nextTick();
  assert.equal(nowSlider().value, '80', 'the level before the slide');
  // A slide elsewhere (the Tuner fold) ending on a level too low to hear
  // brings back half volume.
  for (const value of [1, 0]) {
    slide($('#radio-volume'), value);
    await nextTick();
  }
  $('.radio-stations__volume .radio-volume__mute').click();
  await nextTick();
  assert.equal(nowSlider().value, '50');
});

// Expanded to the full-height column, Context covers the corner: the same
// mini player moves to the column's foot, inside Context, the station
// playing on, and goes back to the corner as it was when Context shrinks.
const expandButton = () =>
  document.querySelector(
    '#global-context-panel .context-dock-btn[aria-label$="full-height column"], #global-context-panel .context-dock-btn[aria-label^="Shrink Context"]',
  );
test('expanding Context moves the mini player to the column’s foot without stopping the station; shrinking takes it back', async (t) => {
  const { $, radio } = await radioOnWithList(t);
  const mini = $('.radio-mini');
  assert.ok(
    mini.closest('.context-corner'),
    'in the corner while a station plays',
  );
  expandButton().click();
  await nextTick();
  assert.equal(expandButton().getAttribute('aria-pressed'), 'true', 'expanded');
  assert.equal(
    document.querySelectorAll('.radio-mini').length,
    1,
    'one player, never two',
  );
  assert.equal($('.radio-mini'), mini, 'the same player, moved');
  assert.ok(
    mini.closest('#global-context-panel #context-mini-foot'),
    'at the foot of the column',
  );
  assert.equal(mini.closest('.context-corner'), null, 'not in the corner');
  assert.equal($('#context-mini-foot').style.display, '', 'its foot shows');
  assert.equal(radio.state().audioState, 'playing', 'the station plays on');
  assert.equal(
    radio.calls.some(([name]) => /stop|pause/i.test(name)),
    false,
    'nothing stopped it',
  );
  expandButton().click();
  await nextTick();
  assert.equal(document.querySelectorAll('.radio-mini').length, 1);
  assert.equal($('.radio-mini'), mini, 'still the same player');
  assert.ok(
    mini.closest('.context-corner'),
    'back in the corner once Context shrinks',
  );
  assert.equal(
    $('#context-mini-foot').style.display,
    'none',
    'the foot is put away',
  );
  assert.equal(mini.dataset.state, 'live', 'still live');
});

test('while expanded the mini player at the column’s foot controls playback', async (t) => {
  const { $, radio } = await radioOnWithList(t);
  expandButton().click();
  await nextTick();
  const foot = () => $('#context-mini-foot .radio-mini');
  assert.ok(foot(), 'in the column');
  assert.deepEqual(
    MINI_CONTROLS.map((selector) => Boolean(foot().querySelector(selector))),
    MINI_CONTROLS.map(() => true),
    'every control there',
  );
  foot().querySelector('.radio-mini__play').click();
  await nextTick();
  assert.ok(
    radio.calls.some(([name]) => /pause|toggle/.test(name)),
    'Pause reached the station',
  );
  assert.equal(radio.state().audioState, 'paused');
  assert.equal(foot().dataset.state, 'paused');
  foot().querySelector('.radio-mini__play').click();
  await nextTick();
  assert.ok(
    radio.calls.some(([name, id]) => name === 'play' && id === 'kut'),
    'and Play starts it again',
  );
  assert.equal(foot().dataset.state, 'loading');
  foot().querySelector('[aria-label="Next filtered station"]').click();
  await nextTick();
  foot().querySelector('.radio-mini__close').click();
  await nextTick();
  assert.equal(
    $('.radio-mini'),
    null,
    'Close takes it away from the column too',
  );
  expandButton().click();
  await nextTick();
});

// Radio's source is chosen on its Data Layers row; Context shows only that
// source, with no switch or tabs of its own.
test('Context shows only the Radio source chosen on its row: the stations, or the local receiver', async (t) => {
  const { $, radio } = await radioOnWithList(t, { playing: null });
  assert.ok($('.radio-stations__list'), 'the internet stations');
  assert.equal($('.local-receiver'), null);
  radio.emit({
    enabled: false,
    source: 'local',
    localReceiver: true,
    selected: null,
    audioState: 'stopped',
    playingStationId: null,
  });
  await nextTick();
  assert.equal($('.radio-stations__list'), null, 'no station list');
  assert.equal(
    $('.radio-stations:not(.local-receiver)'),
    null,
    'no Now playing for a station',
  );
  const local = $('.local-receiver');
  assert.ok(local, 'the local receiver instead');
  assert.match(local.textContent, /LOCAL RTL-SDR/);
  assert.match(local.textContent, /CONNECT/);
  assert.equal(
    document.querySelectorAll(
      '#global-context-panel [data-chip-id^="radio-source"], #global-context-panel [role="tab"][id*="radio"]',
    ).length,
    0,
    'no switch or tabs in Context',
  );
  assert.equal(
    $('#global-context-panel #sdr-radio-card'),
    null,
    'the full card stays on the row',
  );
  radio.emit({ enabled: true, source: 'internet', localReceiver: false });
  await nextTick();
  assert.ok($('.radio-stations__list'), 'the stations again');
  assert.equal($('.local-receiver'), null);
});

// Under an open Context the dock and the mini player stand at the foot of
// the column, wherever the panel above them ends, and the panel gives up
// their height: neither measures the other, so a dock arriving lays the
// column out once. Until the panel has made room they wait unseen rather
// than show over its last rows.
test('under an open Context the corner stands at the column’s foot, whatever the panel’s height, and waits unseen until the panel makes room', async (t) => {
  const { $ } = await radioOnWithList(t);
  const corner = $('.context-corner');
  const stack = $('#right-context-rail');
  const panel = $('#global-context-panel');
  assert.ok(
    corner.querySelector('.radio-mini'),
    'something stands in the corner',
  );
  const FOOT = 700;
  const HEIGHT = 37;
  stack.dataset.columnBottom = String(FOOT);
  Object.defineProperty(corner, 'offsetHeight', {
    configurable: true,
    get: () => HEIGHT,
  });
  corner.getBoundingClientRect = () => {
    const bottom =
      globalThis.innerHeight - parseFloat(corner.style.bottom || '0');
    return {
      left: 1218,
      right: 1548,
      width: 330,
      top: bottom - HEIGHT,
      bottom,
      height: HEIGHT,
    };
  };
  let panelBottom = 600;
  panel.getBoundingClientRect = () => ({
    left: 1218,
    right: 1548,
    width: 330,
    top: 150,
    bottom: panelBottom,
    height: panelBottom - 150,
  });
  const measure = async () => {
    globalThis.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  await measure();
  const standing = corner.style.bottom;
  assert.equal(
    standing,
    `${globalThis.innerHeight - FOOT}px`,
    'on the column’s foot',
  );
  assert.equal(corner.style.top, 'auto');
  assert.match(
    stack.style.getPropertyValue('--right-stack-reserve'),
    /^\d+px$/,
    'the panel gives up its height',
  );
  assert.equal(corner.classList.contains('context-corner--settling'), false);
  // The panel still running down over it (the column not yet laid out):
  // the corner stays where it is, unseen.
  panelBottom = FOOT - 10;
  await measure();
  assert.equal(
    corner.style.bottom,
    standing,
    'its place does not follow the panel',
  );
  assert.ok(
    corner.classList.contains('context-corner--settling'),
    'unseen meanwhile',
  );
  // The panel has made room: seen, still in the same place.
  panelBottom = FOOT - HEIGHT - 8;
  await measure();
  assert.equal(corner.style.bottom, standing);
  assert.equal(corner.classList.contains('context-corner--settling'), false);
});

// The mini player's slider opens in the top layer, placed from the speaker:
// above it where the window has room, else to its left, never off screen;
// it closes on Escape and on a click elsewhere.
test('the mini player’s volume slider opens over Context, above the speaker or beside it, and closes on Escape or a click elsewhere', async (t) => {
  const { $ } = await radioOnWithList(t);
  const box = $('.radio-mini .radio-volume');
  const speaker = $('.radio-mini .radio-volume__mute');
  const popup = $('.radio-mini .radio-volume__slider');
  assert.equal(popup.getAttribute('popover'), 'manual', 'a top-layer popover');
  const rect = (left, top, width, height) => () => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  });
  popup.getBoundingClientRect = rect(0, 0, 144, 40);
  // Room above: it opens above, its right edge on the speaker's.
  speaker.getBoundingClientRect = rect(700, 700, 28, 28);
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.ok(box.classList.contains('is-open'), 'focus opens it');
  assert.equal(popup.dataset.side, 'above');
  assert.equal(popup.style.top, `${700 - 40 - 6}px`);
  assert.equal(popup.style.left, `${728 - 144}px`);
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  await nextTick();
  assert.equal(box.classList.contains('is-open'), false, 'Escape closes it');
  // No room above: to the left, centred on the speaker, inside the window.
  speaker.getBoundingClientRect = rect(700, 20, 28, 28);
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.equal(popup.dataset.side, 'left');
  assert.equal(popup.style.left, `${700 - 144 - 6}px`);
  assert.equal(popup.style.top, `${20 + 14 - 20}px`, 'centred on the speaker');
  speaker.getBoundingClientRect = rect(700, 2, 28, 8);
  box.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
  );
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.equal(popup.style.top, '8px', 'kept inside the window');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  assert.equal(
    box.classList.contains('is-open'),
    false,
    'a click elsewhere closes it',
  );
});

// Expanded, the mini player is inside Context: an Esc that closes its open
// slider is the slider's alone.
test('while expanded, Esc in the mini player’s open volume slider closes only the slider', async (t) => {
  const { $ } = await radioOnWithList(t);
  expandButton().click();
  await nextTick();
  contextSearchOpen.value = true;
  await nextTick();
  const box = $('#context-mini-foot .radio-volume');
  const speaker = box.querySelector('.radio-volume__mute');
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.ok(box.classList.contains('is-open'), 'the slider is open');
  assert.equal(box.hasAttribute('data-owns-escape'), true);
  await new Promise((resolve) => setTimeout(resolve, 5));
  box.querySelector('.radio-volume__range').dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  await nextTick();
  assert.equal(box.classList.contains('is-open'), false, 'the slider closes');
  assert.equal(contextSearchOpen.value, true, 'the search stays open');
  assert.equal(
    box.hasAttribute('data-owns-escape'),
    false,
    'closed, Esc is Context’s again',
  );
  assert.equal(escKey(speaker), true);
  assert.equal(
    contextSearchOpen.value,
    false,
    'the next Esc closes the search',
  );
});

// The panel's own Esc (PanelChrome binds it on the way up) must not also
// collapse Context for the Esc that closed the slider.
test('while expanded, Esc in the mini player’s open volume slider leaves Context open', async (t) => {
  const { $, close } = await radioOnWithList(t);
  expandButton().click();
  await nextTick();
  const panel = $('#global-context-panel');
  let collapses = 0;
  const disclosure = bindPanelDisclosure({
    panel,
    onEscape: (event) =>
      collapsePanelOnEscape(event, {
        panel,
        onChange: (collapsed) => {
          if (collapsed) collapses += 1;
          close();
        },
      }),
  });
  t.after(() => disclosure.destroy());
  assert.equal(panel.classList.contains('collapsed'), false, 'Context is open');
  const box = $('#context-mini-foot .radio-volume');
  const speaker = box.querySelector('.radio-volume__mute');
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.ok(box.classList.contains('is-open'), 'the slider is open');
  await new Promise((resolve) => setTimeout(resolve, 5));
  box.querySelector('.radio-volume__range').dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  await nextTick();
  assert.equal(box.classList.contains('is-open'), false, 'the slider closes');
  assert.equal(collapses, 0, 'the panel’s Esc does not run');
  assert.equal(
    panel.classList.contains('collapsed'),
    false,
    'Context stays open',
  );
  assert.equal(
    expandButton()?.getAttribute('aria-pressed'),
    'true',
    'and expanded',
  );
  // With the slider closed, the next Esc is the panel's.
  escKey(speaker);
  await nextTick();
  assert.equal(collapses, 1, 'the next Esc collapses Context');
});

test('on touch, the first tap on the mini player’s speaker opens its slider and keeps it open; the next tap closes it', async (t) => {
  const realMatch = globalThis.matchMedia;
  globalThis.matchMedia = (query) => ({
    matches: query === '(hover: none)',
    media: query,
    addEventListener() {},
    removeEventListener() {},
  });
  t.after(() => (globalThis.matchMedia = realMatch));
  const { $ } = await radioOnWithList(t);
  const box = $('.radio-mini .radio-volume');
  const speaker = $('.radio-mini .radio-volume__mute');
  // A tap: press, the focus it gives, then its click.
  speaker.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  speaker.click();
  await nextTick();
  assert.ok(box.classList.contains('is-open'), 'the first tap leaves it open');
  // The speaker already has focus: the next tap is a press and a click.
  speaker.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  speaker.click();
  await nextTick();
  assert.equal(
    box.classList.contains('is-open'),
    false,
    'a second tap closes it',
  );
  // Focus from the keyboard still opens it.
  speaker.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  speaker.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
  await nextTick();
  assert.ok(box.classList.contains('is-open'), 'keyboard focus opens it');
});

test('a station’s category shows as a chip coloured as its marker; its tag moves to the meta line; no tags, no chip', async (t) => {
  // The layer's own classifier, labels and colours.
  const layer = createRadioLayer({
    source: {},
    services: {
      ground: {},
      picking: { unregisterPickOwner() {} },
      globe: {},
      render: { governorRequestRender() {} },
      overlays: {
        clearOverlaySource() {},
        setOverlaySourceVisible() {},
        setOverlayEntries() {},
      },
    },
  });
  t.after(() => layer.destroy());
  const radio = radioLayer({ playing: 'kutx' });
  radio.stations[1].tags = ['chiptune', 'music'];
  radio.radioStationCategoryId = layer.radioStationCategoryId;
  radio.radioCategoryColor = layer.radioCategoryColor;
  radio.emit({
    selected: radio.stations[1],
    categories: layer.buildRadioCategories(radio.stations),
  });
  const { $, cards } = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  assert.equal(
    $('.radio-stations__now-head strong').textContent,
    'KUTX 98.9',
    'the title is the name alone',
  );
  const chip = $('.radio-stations__meta .radio-category');
  assert.equal(chip.textContent, 'Music');
  assert.equal(
    chip.style.getPropertyValue('--radio-category'),
    layer.radioCategoryColor('music'),
  );
  assert.match(
    $('.radio-stations__meta-text').textContent,
    /^chiptune\b/,
    'the tag after the category',
  );
  // The distance is its own part of the line, kept whole while the details
  // before it give way with an ellipsis.
  assert.match($('.radio-stations__meta-distance').textContent, /\d\s*km$/);
  assert.equal(
    $('.radio-stations__meta-text').title,
    $('.radio-stations__meta-text').textContent,
    'the whole line on hover',
  );
  const dots = [
    ...document.querySelectorAll('.radio-stations__list .radio-category-dot'),
  ].map((dot) => dot.getAttribute('aria-label'));
  assert.deepEqual(dots, ['News', 'Music'], 'each row says its category');
  assert.equal(
    $('.radio-mini__icon').style.color !== '',
    true,
    'the mini player’s glyph takes the colour',
  );
  // No tags: no chip, never "Other".
  radio.stations[1].tags = [];
  radio.emit({ selected: { ...radio.stations[1] } });
  await nextTick();
  assert.equal($('.radio-stations__meta .radio-category'), null);
  assert.doesNotMatch($('.radio-stations__meta').textContent, /Other/);
});

test('on a phone, Esc in Context is left to the sheet, which closes first', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)])]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  document.body.classList.add('mobile-shell');
  t.after(() => document.body.classList.remove('mobile-shell'));
  const event = new KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
    cancelable: true,
  });
  $('.entity-card__action--pin').dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.ok(cards.card, 'the pick stays for the sheet to close first');
});

test('on a phone, Esc in the search field closes the search', async (t) => {
  const { $ } = fixture(t, [flightsOn([])]);
  contextSearchOpen.value = true;
  await nextTick();
  document.body.classList.add('mobile-shell');
  t.after(() => document.body.classList.remove('mobile-shell'));
  // Vue ignores an event stamped in the same millisecond its listener was attached.
  await new Promise((resolve) => setTimeout(resolve, 5));
  $('.context-search__input').dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }),
  );
  assert.equal(contextSearchOpen.value, false);
});

const settleTicks = async () => {
  for (let i = 0; i < 4; i += 1) await nextTick();
};

test('the Lists tab going while it has focus hands focus to the tab that shows', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  t.after(resetContextLists);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.unpin('flights:x'));
  setContextListPresence('weather', { count: 2 });
  showContextList('weather');
  await settleTicks();
  $('#context-tab-lists').focus();
  setContextListPresence('weather', null);
  await settleTicks();
  assert.equal($('#context-tab-lists'), null);
  assert.equal(document.activeElement?.id, `context-tab-${pinned.tab}`);
});

test('the Camera settings tab going while it has focus keeps focus in Context', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const cams = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: [camera],
    module: {
      frameUrlForCamera: (id) => ({
        url: `/frame/${id}.jpg`,
        refreshMs: 10_000,
      }),
    },
  };
  const { $, cards, pinia, notifyLayers } = fixture(t, [cams]);
  useCctvStore(pinia).publish(
    presentCctvPanel({ enabled: true, activeCameraId: 'cam1' }, true),
  );
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await settleTicks();
  $('#context-tab-camera').focus();
  cams.enabled = false;
  notifyLayers();
  await settleTicks();
  assert.equal($('#context-tab-camera'), null);
  assert.notEqual(document.activeElement, document.body);
  assert.ok($('#global-context-panel').contains(document.activeElement));
});

test('Undo from the keyboard focuses the pin put back, or the Pinned tab', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.isPinned('flights:x') && pinned.unpin('flights:x'));
  pinned.show('pinned');
  await settleTicks();
  $('.pinned-grid__unpin').dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 0 }),
  );
  await settleTicks();
  const undo = $('.pin-undo-notice button');
  assert.equal(document.activeElement, undo);
  undo.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await settleTicks();
  assert.ok(pinned.isPinned('flights:x'));
  // The last unpin left Pinned for Inspect, so its tab takes focus.
  assert.equal(document.activeElement, $('#context-tab-pinned'));
  // With Pinned still showing, the tile put back takes it.
  pinned.pin({
    key: 'flights:y',
    kind: 'item',
    title: 'Y',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'y' },
  });
  t.after(() => pinned.isPinned('flights:y') && pinned.unpin('flights:y'));
  pinned.show('pinned');
  await settleTicks();
  pinned.unpin('flights:x');
  await settleTicks();
  $('.pin-undo-notice button').focus();
  $('.pin-undo-notice button').dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 0 }),
  );
  await settleTicks();
  assert.equal(
    document.activeElement?.closest('.pinned-grid__tile')?.dataset.pinKey,
    'flights:x',
  );
});

// Turning a list layer on from Data Layers selects its list inside Context.
for (const [layerId, listId] of [
  ['rocket-launches', 'space-missions'],
  ['weather-radar', 'weather'],
]) {
  test(`turning ${layerId} on from Data Layers shows its list in Context`, async (t) => {
    const { $, cards, pinia, notifyLayers } = fixture(t, [flightsOn([])]);
    t.after(resetContextLists);
    const chrome = usePanelChromeStore(pinia);
    const owner = chrome.connect({});
    t.after(() => chrome.detach(owner));
    chrome.publish(owner, 'global-context-panel', { collapsed: false });
    chrome.publish(owner, 'data-panel', { collapsed: false });
    await settleTicks();
    cards.allLayers();
    await settleTicks();
    notifyLayers({
      type: 'visibility',
      layerId,
      enabled: true,
      origin: 'user',
    });
    assert.equal(cards.lastDirectOn?.layerId, layerId);
    if (listId === 'space-missions')
      useSpaceMissionsStore(pinia).setEnabled(true);
    else setContextListPresence(listId, { count: 2 });
    await settleTicks();
    assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
    assert.notEqual($('#context-lists').style.display, 'none');
    assert.notEqual($(`#context-list-${listId}`).style.display, 'none');
    assert.equal(chrome.panels['data-panel'].collapsed, false);
  });
}

test('each Lists sub-tab controls a tab panel that names it', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  t.after(resetContextLists);
  useSpaceMissionsStore(pinia).setEnabled(true);
  setContextListPresence('weather', { count: 2 });
  setContextListPresence('news', { count: 3 });
  showContextList('weather');
  await settleTicks();
  const tabs = [
    ...document.querySelectorAll('.context-list-tabs [role="tab"]'),
  ];
  assert.deepEqual(
    tabs.map((tab) => tab.id),
    [
      'context-list-tab-space-missions',
      'context-list-tab-weather',
      'context-list-tab-news',
    ],
  );
  for (const tab of tabs) {
    const pane = document.getElementById(tab.getAttribute('aria-controls'));
    assert.ok(pane, `${tab.id} controls a pane in the page`);
    assert.equal(pane.getAttribute('role'), 'tabpanel');
    assert.equal(pane.getAttribute('aria-labelledby'), tab.id);
  }
  assert.ok($('#context-lists'));
});

test('turning Radio on brings Inspect forward and keeps the pick; a station picked on the globe takes its place', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.unpin('flights:x'));
  pinned.show('pinned');
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  pinned.show('pinned');
  document.dispatchEvent(new CustomEvent('gev:radio-show-stations'));
  await nextTick();
  assert.equal(pinned.tab, 'inspect');
  assert.equal(
    cards.card?.identity.id,
    'test01',
    'the pick (and any follow) stays',
  );
  pinned.show('pinned');
  await nextTick();
  document.dispatchEvent(
    new CustomEvent('gev:radio-selected', { detail: { stationId: 'kut' } }),
  );
  await nextTick();
  assert.equal(
    cards.card,
    null,
    'a station picked on the globe is the new pick',
  );
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
});

test('the notice that a pin went stays while it is held', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pinia = createPinia();
  const pinned = usePinnedStore(pinia);
  const item = (n) => ({
    key: `k:${n}`,
    kind: 'item',
    title: `I${n}`,
    icon: 'flight',
    identity: {},
  });
  for (const n of [1, 2, 3, 4, 5]) pinned.pin(item(n));
  assert.equal(pinned.unpinned, null, 'pinning a fifth says nothing');
  pinned.unpin('k:1');
  assert.ok(pinned.unpinned);
  pinned.holdNotice('focus', true);
  pinned.holdNotice('pointer', true);
  pinned.holdNotice('pointer', false);
  t.mock.timers.tick(20_000);
  assert.ok(pinned.unpinned, 'still held by focus');
  pinned.holdNotice('focus', false);
  t.mock.timers.tick(8_000);
  assert.equal(pinned.unpinned, null, 'gone once both let go');
  pinned.unpin('k:2');
  pinned.holdNotice('pointer', true);
  pinned.releaseNotice();
  t.mock.timers.tick(8_000);
  assert.equal(pinned.unpinned, null, 'closing Context lets a held notice go');
});

test('Undo lets go of the focus it had, so the next notice still goes', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pinned = usePinnedStore(createPinia());
  const item = (n) => ({
    key: `k:${n}`,
    kind: 'item',
    title: `I${n}`,
    icon: 'flight',
    identity: {},
  });
  for (const n of [1, 2]) pinned.pin(item(n));
  pinned.unpin('k:1');
  pinned.holdNotice('focus', true);
  pinned.undo();
  assert.ok(pinned.isPinned('k:1'), 'put back');
  pinned.unpin('k:2');
  t.mock.timers.tick(8_000);
  assert.equal(
    pinned.unpinned,
    null,
    'no focusout came, and the notice still went',
  );
});

test('every card: three buttons at most and an Ask icon; Follow for what moves, Fly to for what does not', async (t) => {
  const { $, cards, asked } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: true,
      records: [
        { id: 'q1', usgsId: 'q1', magnitude: 4.2, lat: 30.2, lon: -97.6 },
      ],
    },
  ]);
  const labels = () =>
    [
      ...document.querySelectorAll('#entity-card .entity-card__actions button'),
    ].map(
      (button) =>
        button.textContent.trim() || button.getAttribute('aria-label'),
    );
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  assert.deepEqual(labels().slice(0, 2), ['navigationFollow', 'keepPin']);
  assert.match(labels()[2], /^Ask GEV about TEST01$/);
  assert.equal(labels().length, 3, 'no Fly to, no TR-3B, no long Ask button');
  $('.entity-card__action--ask-icon').click();
  assert.deepEqual(
    asked,
    [{ key: cards.card.key, title: 'TEST01' }],
    'the Ask icon opens Chat with this item',
  );
  cards.select({ layerId: 'earthquakes', id: 'q1' }, { fly: false });
  await nextTick();
  assert.deepEqual(labels().slice(0, 2), ['my_locationFly to', 'keepPin']);
  assert.ok(
    $('.entity-card__action-row .entity-card__action--primary'),
    'Fly to leads when nothing else does',
  );
});

// The source line's age is a number in the locale's own form.
test('a card’s source line words its age with the locale’s number format', async (t) => {
  const observedMs = Date.now() - 1500 * 86_400_000;
  const { $, cards } = fixture(t, [
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: true,
      records: [
        { id: 'q1', title: 'M4 quake', lat: 30.3, lon: -97.7, observedMs },
      ],
    },
  ]);
  cards.select({ layerId: 'earthquakes', id: 'q1' }, { fly: false });
  await nextTick();
  assert.match(
    $('.entity-card__head .entity-card__source-line')?.textContent || '',
    /1,500 d ago/,
  );
});

test('a card has one source line under its name, its key numbers, then Nearby before More details', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn(
      [
        {
          ...flight('test01', 30.3, -97.7),
          speedMps: 200,
          heading: 71,
          verticalRateMps: 0,
        },
        flight('next01', 30.31, -97.71),
      ],
      { source: 'OpenSky' },
    ),
  ]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  const line = $('.entity-card__head .entity-card__source-line');
  assert.ok(line, 'one small source line in the header');
  assert.match(line.textContent, /OpenSky/);
  const tiles = [
    ...document.querySelectorAll('#entity-card .entity-card__tile span'),
  ].map((span) => span.textContent);
  assert.deepEqual(
    tiles,
    ['Altitude', 'Speed', 'Heading'],
    'altitude, speed and heading, live; the climb rate stays a fact',
  );
  const nearby = $('#entity-card .nearby-lists');
  const more = $('#entity-card .entity-card__more');
  assert.ok(nearby && more);
  assert.match(
    $('#entity-card .nearby-lists__title').textContent,
    /^Nearby · 250 km$/,
  );
  assert.ok(
    nearby.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING,
    'Nearby, then More details',
  );
  assert.equal(
    Boolean(
      $(
        '#entity-card .spot-conditions__weather, #entity-card .spot-conditions__radius',
      ),
    ),
    false,
    'no weather block or second radius on a card',
  );
  assert.match(more.textContent, /Data source.*OpenSky/s);
});

test("Nearby on a card lists the picked item's own layer first", async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('plane01', 30.28, -97.75)]),
    {
      id: 'ais-live-vessels',
      name: 'Live Vessels',
      enabled: true,
      records: [
        { id: 'b1', mmsi: 'b1', name: 'PICKED', lat: 30.27, lon: -97.74 },
        { id: 'b2', mmsi: 'b2', name: 'OTHER BOAT', lat: 30.4, lon: -97.9 },
      ],
    },
  ]);
  cards.select({ layerId: 'ais-live-vessels', id: 'b1' }, { fly: false });
  await nextTick();
  const order = [
    ...document.querySelectorAll('#entity-card .nearby-lists__layer'),
  ].map((list) => list.dataset.layer);
  assert.deepEqual(order, ['ais-live-vessels', 'flights']);
});

test('nothing picked: the time reads local and UTC, and there is only counts and one Nearby section', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('far01', 35, -90)])]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.match($('.view-context__region').textContent, /\d\d:\d\d UTC/);
  assert.equal(Boolean($('.view-context__towns')), false, 'no towns chips');
  assert.equal(
    Boolean($('.view-context .entity-card__action--ask')),
    false,
    'no Ask button',
  );
  assert.doesNotMatch(
    $('.view-context').textContent,
    /Nothing from the layers/,
    'never "nothing nearby"',
  );
});

test('a vessel drawn with a model shows it on top, the map beside it; with no model, the map alone', async (t) => {
  await withFleet(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const active = [];
  const { $, cards } = fixture(
    t,
    [
      {
        id: 'ais-live-vessels',
        name: 'Live Vessels',
        enabled: true,
        records: [
          {
            id: 'boat01',
            mmsi: '366000001',
            name: 'BOAT',
            shipType: 'Cargo',
            lat: 30.28,
            lon: -97.74,
          },
        ],
      },
    ],
    {
      previews: {
        ...STUB_PREVIEWS,
        model: () => ({
          setActive: (value) => active.push(value),
          update() {},
          destroy() {},
        }),
      },
    },
  );
  cards.select({ layerId: 'ais-live-vessels', id: 'boat01' }, { fly: false });
  await nextTick();
  await turn();
  await nextTick();
  assert.equal($('.entity-hero').dataset.hero, 'model');
  assert.ok($('.entity-hero .aircraft-hero'), 'the model draws while paused');
  assert.equal(
    Boolean($('.entity-hero .close-up-map')),
    false,
    'the map is made only once it is picked',
  );
  const switches = [
    ...document.querySelectorAll(
      '#entity-card .entity-card__preview-switch button',
    ),
  ];
  assert.deepEqual(
    switches.map((button) => button.title),
    ['3D model', 'Map', 'Play preview'],
  );
  assert.equal(
    switches[2].getAttribute('aria-label'),
    'Play preview',
    'the card starts paused',
  );
  assert.equal(active.at(-1), false, 'the model does not rotate');
  t.mock.timers.tick(HERO_AUTOPLAY_MS * 2);
  await nextTick();
  assert.equal(
    switches[0].getAttribute('aria-pressed'),
    'true',
    'the first view stays until Play',
  );
  switches[2].click();
  await nextTick();
  assert.equal(active.at(-1), true, 'Play starts model rotation');
  switches[2].click();
  await nextTick();
  assert.equal(active.at(-1), false, 'Pause stops model rotation');
  switches[2].click();
  await nextTick();
  t.mock.timers.tick(HERO_AUTOPLAY_MS - 1);
  await nextTick();
  assert.equal(
    switches[0].getAttribute('aria-pressed'),
    'true',
    'Play starts a fresh view timer',
  );
  t.mock.timers.tick(1);
  await nextTick();
  assert.equal(
    switches[1].getAttribute('aria-pressed'),
    'true',
    'the next view follows the timer',
  );
  assert.equal(active.at(-1), false, 'the hidden model stops');
  switches[1].click();
  await nextTick();
  assert.equal(
    switches[1].getAttribute('aria-pressed'),
    'true',
    'the map, picked',
  );
  cards.card = { ...cards.card, lat: null, lon: null };
  await nextTick();
  assert.equal(
    $('button[aria-label="Map"]'),
    null,
    'without a position only the model remains',
  );
  const play = $('.entity-card__preview-play');
  assert.ok(play, 'a lone model still offers Play');
  play.click();
  await nextTick();
  assert.equal(
    active.at(-1),
    true,
    'Play rotates the lone model without a view timer',
  );
  resetFleetModelSet();
  cards.clear();
  await nextTick();
  cards.select({ layerId: 'ais-live-vessels', id: 'boat01' }, { fly: false });
  await nextTick();
  assert.equal(
    $('.entity-hero').dataset.hero,
    'map',
    'no model set loaded: the close-up map',
  );
});

test('an aircraft without a photo, route or model shows a close-up map, never its icon', async (t) => {
  const { $, cards } = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)])]);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await turn();
  await nextTick();
  assert.equal($('.entity-hero').dataset.hero, 'map');
  assert.equal(Boolean($('.entity-hero__placeholder')), false);
});

test('a camera card: Fly to, Pin and Dock in the row; its tools are a Camera settings tab; docking never pins', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
        cameraDetails: () => ({
          name: camera.name,
          city: 'Austin',
          provider: 'TxDOT',
          credit: 'City of Austin',
          feedType: 'image',
          headingDeg: 0,
          fovDeg: 40,
          rangeM: 120,
          refreshMs: 10_000,
        }),
      },
    },
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  // The camera is the active one (CctvControls publishes this).
  useCctvStore(pinia).publish(
    presentCctvPanel({ enabled: true, activeCameraId: 'cam1' }, true),
  );
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  await nextTick();
  const tiles = [
    ...document.querySelectorAll('#entity-card .entity-card__tile'),
  ].map((tile) => [
    tile.querySelector('span').textContent,
    tile.querySelector('strong').textContent,
  ]);
  assert.deepEqual(tiles, [
    ['City', 'Austin'],
    ['Field of view', '40°'],
    ['Range', '120 m'],
  ]);
  // The provider is named plainly as the source; the feed is its own fact;
  // facing and refresh, not in the row, are here too.
  const more = $('#entity-card .entity-card__more').textContent;
  assert.match(more, /Feed\s*image/);
  assert.match(more, /Data source\s*TxDOT/);
  assert.match(more, /Facing\s*N/);
  assert.match(more, /Refresh\s*10 s/);
  assert.doesNotMatch(
    more,
    /City|Field of view|Range/,
    'nothing in the row again under More details',
  );
  // The source line names the provider and the frame's age, not its refresh.
  assert.doesNotMatch(
    $('#entity-card .entity-card__source-line')?.textContent || '',
    /10 s/,
  );
  assert.match(
    $('#entity-card .entity-card__subtitle').textContent,
    /^Austin · 30\.27, -97\.73$/,
  );
  // Three buttons and the Ask icon; the dock is one of the buttons, not an
  // icon on the image.
  const row = [
    ...document.querySelectorAll(
      '#entity-card .entity-card__action-row button',
    ),
  ];
  assert.deepEqual(
    row.map((button) => button.textContent.trim() || 'ask'),
    ['my_locationFly to', 'keepPin', 'picture_in_picture_altDock', 'ask'],
  );
  assert.equal($('.entity-hero__dock'), null, 'no dock icon on a camera image');
  // The camera's tools are a Camera settings tab beside Inspect, not part of
  // the card.
  assert.ok(!$('#entity-card #cctv-tools'), 'no tools on the card');
  assert.ok(!$('#entity-card .cctv-tools__summary'), 'no Camera tools fold');
  const tabNames = () =>
    [
      ...document.querySelectorAll(
        '#context-body > .context-pin-tabs [role="tab"]',
      ),
    ].map((tab) => tab.textContent.trim());
  assert.deepEqual(tabNames(), ['Inspect', 'Camera settings']);
  $('#context-tab-camera').click();
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-camera').getAttribute('aria-selected'), 'true');
  assert.ok(
    !$('#global-context-panel #entity-card'),
    'the card gives way to the tab',
  );
  assert.ok(
    $('#context-tab-panel #cctv-tools-slot #cctv-tools'),
    'the tools are in the tab',
  );
  // A search puts the tools away; clearing it brings them back.
  contextSearchOpen.value = true;
  contextSearchText.value = 'zzz';
  await nextTick();
  await nextTick();
  assert.ok($('.cctv-tools-home #cctv-tools'), 'home while searching');
  contextSearchText.value = '';
  closeContextSearch();
  await nextTick();
  await nextTick();
  assert.ok(
    $('#context-tab-panel #cctv-tools-slot #cctv-tools'),
    'back in the tab',
  );
  // Inspect again: the tools go home and the card is back.
  $('#context-tab-inspect').click();
  await nextTick();
  await nextTick();
  assert.ok($('.cctv-tools-home #cctv-tools'), 'home on Inspect');
  assert.ok($('#entity-card'), 'the card is back');
  // Voice or search asking for camera settings shows the tab.
  document.dispatchEvent(new CustomEvent(CAMERA_SETTINGS_EVENT));
  await nextTick();
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-camera').getAttribute('aria-selected'), 'true');
  $('#context-tab-inspect').click();
  await nextTick();
  // Dock: pressed while docked, and pressing again undocks.
  const dock = () => $('.entity-card__action--dock');
  dock().click();
  await nextTick();
  assert.equal(dock().getAttribute('aria-pressed'), 'true');
  assert.match(dock().textContent, /Docked/);
  const docked = $('.context-corner .docked-view');
  assert.ok(docked, 'docked bottom right');
  assert.match(docked.textContent, /I-35 @ 12th/);
  assert.equal(
    docked.querySelector('img').getAttribute('src'),
    '/frame/cam1.jpg',
  );
  // Credited under its picture as its card's source line names it; the dock
  // keeps who it is from, for when Cameras goes off.
  assert.equal(
    docked.querySelector('.docked-view__credit')?.textContent,
    'TxDOT · City of Austin',
  );
  assert.deepEqual(useDockedStore(pinia).view.source, {
    provider: 'TxDOT',
    credit: 'City of Austin',
  });
  assert.equal(usePinnedStore(pinia).pins.length, 0, 'docking never pins');
  dock().click();
  await nextTick();
  assert.equal($('.docked-view'), null, 'pressing Docked undocks');
  dock().click();
  await nextTick();
  // Inspect stays free: another pick keeps the dock, and the tools go home.
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await nextTick();
  assert.ok($('.docked-view'), 'the camera stays docked');
  assert.ok($('.cctv-tools-home #cctv-tools'), 'the tools stay home');
  assert.ok(!$('#context-tab-camera'), 'no Camera settings tab off a camera');
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  assert.ok($('#context-tab-camera'), 'the tab is back with the camera card');
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  $('.docked-view').querySelector('button').click();
  await nextTick();
  assert.equal(cards.card.identity.id, 'cam1', 'back in Context');
  assert.equal(useDockedStore(pinia).view, null, 'and no longer docked');
  // Its pin keeps who the feed is from, to credit its still.
  $('.entity-card__action--pin').click();
  await nextTick();
  assert.deepEqual(usePinnedStore(pinia).pins[0]?.source, {
    provider: 'TxDOT',
    credit: 'City of Austin',
  });
});

test('a docked camera whose layer goes off says it is out of feed, not live', async (t) => {
  let frames = true;
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) =>
          frames ? { url: `/frame/${id}.jpg`, refreshMs: 10_000 } : null,
      },
    },
  ]);
  useDockedStore(pinia).dock({
    key: 'cctv:cam1',
    kind: 'camera',
    title: camera.name,
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  await nextTick();
  // Live once its frame has loaded, not before.
  assert.equal($('.docked-view__tag').textContent, 'Docked · loading');
  $('.docked-view img').dispatchEvent(new Event('load'));
  await nextTick();
  assert.match($('.docked-view__tag').textContent, /live/);
  frames = false;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.equal($('.docked-view img'), null, 'no stale frame');
  assert.match($('.docked-view__tag').textContent, /out of feed/);
});

test('a docked camera is not shown twice: its own card has a Docked bar, and Show here undocks it', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  assert.ok($('#entity-card .cctv-preview'), 'the feed shows on the card');
  $('.entity-card__action--dock').click();
  await nextTick();
  assert.equal(
    $('#entity-card .cctv-preview'),
    null,
    'not a second time on the card',
  );
  assert.ok($('.docked-view img'), 'the dock shows it');
  // The bar says what the dock says: loading until its frame loads, then live.
  assert.match(
    $('#entity-card .entity-hero--docked').textContent,
    /Docked · loading/,
  );
  assert.equal(
    $('#entity-card .entity-hero--docked .feed-dot').dataset.state,
    'loading',
  );
  $('.docked-view img').dispatchEvent(new Event('load'));
  await nextTick();
  assert.match(
    $('#entity-card .entity-hero--docked').textContent,
    /Docked · bottom right/,
  );
  assert.equal(
    $('#entity-card .entity-hero--docked .feed-dot').dataset.state,
    'live',
  );
  $('.entity-hero__docked-show').click();
  await nextTick();
  assert.equal(useDockedStore(pinia).view, null, 'Show here undocks');
  assert.ok(
    $('#entity-card .cctv-preview'),
    'and the feed is back on the card',
  );
});

// A camera's enlarged view takes its own Esc. With the panel's Esc (as
// PanelChrome binds it) and the map's (entityContextBridge) both bound, one
// Esc closes the view and does nothing else, with focus on the page (Safari
// and Firefox leave a clicked button unfocused) or on the button that
// opened it (Chrome focuses it).
test('Esc with a camera’s enlarged view open closes only the view, from the page or from its button', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia, close, dataManager } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
        cameraDetails: () => ({
          name: camera.name,
          city: 'Austin',
          provider: 'TxDOT',
          feedType: 'image',
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const disconnect = installEntityContext({
    viewer,
    getDataManager: dataManager,
    pinia,
    inspector: { counts: { update() {}, note() {}, stop() {} } },
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const panel = $('#global-context-panel');
  let collapses = 0;
  const disclosure = bindPanelDisclosure({
    panel,
    onEscape: (event) =>
      collapsePanelOnEscape(event, {
        panel,
        onChange: (collapsed) => {
          if (!collapsed) return;
          collapses += 1;
          close();
        },
      }),
  });
  t.after(() => disclosure.destroy());
  const cctv = useCctvStore(pinia);
  cctv.publish(
    presentCctvPanel({ enabled: true, activeCameraId: 'cam1' }, true),
  );
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  cctv.setFrame({ cameraId: 'cam1', src: '/frame/cam1.jpg' });
  await nextTick();
  await nextTick();
  const expand = () => $('#entity-card .cctv-preview__expand');
  const popup = () => document.querySelector('.cctv-popup');
  const effects = () => ({
    popup: Boolean(popup()),
    card: cards.card?.identity.id ?? null,
    collapses,
  });

  expand().click();
  await nextTick();
  assert.ok(popup(), 'the view is open');
  assert.equal(
    popup().hasAttribute('data-owns-escape'),
    true,
    'and owns its Esc',
  );
  assert.equal(escKey(document.body), true);
  await nextTick();
  assert.deepEqual(
    effects(),
    { popup: false, card: 'cam1', collapses: 0 },
    'from the page: the view closes, the card stays',
  );

  expand().click();
  await nextTick();
  assert.ok(popup());
  assert.equal(escKey(expand()), true);
  await nextTick();
  assert.deepEqual(
    effects(),
    { popup: false, card: 'cam1', collapses: 0 },
    'from its button: the view closes, Context stays open',
  );
  assert.equal(panel.contains(expand()), true);

  // With the view closed, the next Esc is Context's again: the pick clears.
  assert.equal(escKey(expand()), true);
  await nextTick();
  assert.deepEqual(effects(), { popup: false, card: null, collapses: 0 });
});

test('a camera card refreshes in place: nothing remounts, and the scrollbar thumb waits for the pointer', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  let n = 0;
  const { $, cards } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg?n=${n++}`,
          refreshMs: 1000,
        }),
        cameraDetails: () => ({
          name: camera.name,
          city: 'Austin',
          feedType: 'image',
          headingDeg: 0,
          fovDeg: 40,
          rangeM: 120,
          refreshMs: 1000,
        }),
      },
    },
  ]);
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  const card = $('#entity-card');
  const frame = $('.cctv-preview__frame');
  const scroller = $('.global-context-panel-inner');
  const top = scroller?.scrollTop ?? 0;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.equal($('#entity-card'), card, 'the card is the same element');
  assert.equal(
    $('.cctv-preview__frame'),
    frame,
    'so is its picture box, which keeps its 16:9 height',
  );
  assert.equal(scroller?.scrollTop ?? 0, top, 'and the panel keeps its scroll');
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(
    new URL('./styles/layers.css', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /\.global-context-panel-inner:not\(:hover\):not\(:focus-within\) \{\s*scrollbar-color: transparent transparent;/,
  );
});

test('the tab row is one line: Inspect holds its start, the other tabs scroll beside it, and arrows move across both', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  usePinnedStore(pinia).pin({
    key: 'place:a',
    kind: 'place',
    title: 'Zilker Park',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'a' },
  });
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  await nextTick();
  const row = $('#context-body > .context-pin-tabs--main');
  assert.equal(row.getAttribute('role'), 'tablist');
  assert.equal(
    row.firstElementChild.id,
    'context-tab-inspect',
    'Inspect leads, outside the strip',
  );
  const strip = row.querySelector('.context-pin-tabs__strip');
  assert.deepEqual(
    [...strip.querySelectorAll('[role="tab"]')].map((tab) => tab.id),
    ['context-tab-camera', 'context-tab-pinned'],
  );
  // Arrows go from Inspect into the strip and on.
  const inspect = $('#context-tab-inspect');
  inspect.focus();
  inspect.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
  );
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-camera').getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement?.id, 'context-tab-camera');
});

test('the live dot is a dot wherever it is: never stretched by the row it sits in', async () => {
  const { readFile } = await import('node:fs/promises');
  const css = await readFile(
    new URL('./styles/entity-card.css', import.meta.url),
    'utf8',
  );
  const rule = css.match(/\n\.feed-dot \{([^}]*)\}/)[1];
  assert.match(rule, /flex: 0 0 auto;/);
  const size = (prop) => rule.match(new RegExp(`\\n\\s*${prop}: ([^;]+);`))[1];
  assert.equal(size('width'), size('height'), 'square');
  assert.equal(size('min-width'), size('width'));
  assert.equal(size('max-width'), size('width'));
  // The docked row stretches its label, not the dot.
  assert.match(
    css,
    /\.entity-hero--docked > span:not\(\.feed-dot\) \{[^}]*flex: 1;/,
  );
  assert.doesNotMatch(css, /\.entity-hero--docked > span \{/);
});

test('the dock sits in the column under Context, which gives up that room, and takes it back when the dock closes', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  // The test DOM lays nothing out: the panel and the dock report their boxes.
  const panel = document.getElementById('global-context-panel');
  const stack = document.getElementById('right-context-rail');
  const corner = document.querySelector('.context-corner');
  panel.getBoundingClientRect = () => ({
    left: 1218,
    right: 1548,
    top: 100,
    bottom: 520,
    width: 330,
    height: 420,
  });
  stack.style.rowGap = '8px';
  Object.defineProperty(corner, 'offsetHeight', {
    configurable: true,
    get: () => (corner.querySelector('.docked-view') ? 186 : 0),
  });
  const settle = async () => {
    await nextTick();
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 5));
  };
  const docked = useDockedStore(pinia);
  docked.dock({
    key: 'cctv:cam1',
    kind: 'camera',
    title: camera.name,
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  await settle();
  assert.ok(corner.classList.contains('context-corner--column'));
  assert.equal(corner.style.top, '528px', 'one gap under the panel');
  assert.equal(corner.style.width, '330px', 'as wide as the panel');
  assert.equal(
    stack.style.getPropertyValue('--right-stack-reserve'),
    '194px',
    'the column keeps room for it',
  );
  docked.close();
  await settle();
  assert.equal(
    stack.style.getPropertyValue('--right-stack-reserve'),
    '',
    'Context takes its height back',
  );
});

test('a docked camera stays live with Cameras off, and so does its pin; other pins pause, and closing the dock pauses it', async (t) => {
  const cams = [
    { id: 'cam1', name: 'LP 410 at Culebra', lat: 29.47, lon: -98.6 },
    { id: 'cam2', name: 'I-10 at Wurzbach', lat: 29.53, lon: -98.56 },
  ];
  const cctv = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: cams,
    module: {
      frameUrlForCamera: (id) => ({
        url: `/frame/${id}.jpg`,
        refreshMs: 10_000,
      }),
    },
  };
  const { $, cards, pinia, notifyLayers } = fixture(t, [
    cctv,
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  // The test DOM cannot draw images: each frame the dock shows is kept as this.
  _setFrameStillCaptureForTest(async () => 'data:image/jpeg;base64,DOCKED');
  t.after(() => _setFrameStillCaptureForTest(null));
  const docked = useDockedStore(pinia);
  const pinned = usePinnedStore(pinia);
  const tile = (key) =>
    $(`.pinned-grid__tile[data-kind="camera"]:nth-child(${key})`);
  for (const camera of cams) {
    cards.select({ layerId: 'cctv', id: camera.id }, { fly: false });
    await nextTick();
    pinned.pin({
      key: `cctv:${camera.id}`,
      kind: 'camera',
      title: camera.name,
      icon: 'videocam',
      identity: {
        layerId: 'cctv',
        id: camera.id,
        label: camera.name,
        lat: camera.lat,
        lon: camera.lon,
      },
      still: `data:image/jpeg;base64,PIN-${camera.id}`,
    });
  }
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  $('.entity-card__action--dock').click();
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  $('.docked-view img').dispatchEvent(new Event('load'));
  await turn();
  // Cameras off in Data Layers: the dock keeps its one feed.
  cctv.enabled = false;
  notifyLayers();
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.match($('.docked-view__tag').textContent, /Docked · live/);
  assert.equal($('.docked-view .feed-dot').dataset.state, 'live');
  assert.equal(
    $('.docked-view img').getAttribute('src'),
    '/frame/cam1.jpg',
    'still reading its feed',
  );
  assert.equal(cctv.enabled, false, 'never turned back on');
  // Its pin mirrors the dock; the other pin pauses on its last frame.
  pinned.show('pinned');
  await nextTick();
  assert.equal(tile(1).querySelector('.feed-dot').dataset.state, 'live');
  assert.equal(tile(1).querySelector('.paused-chip'), null);
  assert.equal(
    pinned.stillOf('cctv:cam1'),
    'data:image/jpeg;base64,DOCKED',
    "the dock's latest frame",
  );
  assert.match(tile(2).querySelector('.paused-chip').textContent, /Paused/);
  assert.equal(
    tile(2).querySelector('.paused-chip').getAttribute('title'),
    'Cameras off · last frame',
  );
  assert.equal(pinned.stillOf('cctv:cam2'), 'data:image/jpeg;base64,PIN-cam2');
  // Closing the dock pauses its pin, on the last frame the dock showed.
  $('.docked-view button[title="Close"]').click();
  await nextTick();
  assert.match(tile(1).querySelector('.paused-chip').textContent, /Paused/);
  assert.equal(pinned.stillOf('cctv:cam1'), 'data:image/jpeg;base64,DOCKED');
});

test('a docked camera whose feed fails or drops out says so on its pin and its card, as the dock does, never live', async (t) => {
  let frames = true;
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) =>
          frames ? { url: `/frame/${id}.jpg`, refreshMs: 10_000 } : null,
      },
    },
  ]);
  _setFrameStillCaptureForTest(async () => 'data:image/jpeg;base64,DOCKED');
  t.after(() => _setFrameStillCaptureForTest(null));
  const pinned = usePinnedStore(pinia);
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  pinned.pin({
    key: 'cctv:cam1',
    kind: 'camera',
    title: camera.name,
    icon: 'videocam',
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  $('.entity-card__action--dock').click();
  await nextTick();
  const dockDot = () => $('.docked-view .feed-dot');
  const cardDot = () => $('#entity-card .entity-hero--docked .feed-dot');
  const cardBar = () => $('#entity-card .entity-hero--docked').textContent;
  const pinDot = () => $('.pinned-grid__tile[data-kind="camera"] .feed-dot');
  // The pin is on the Pinned tab and the card on Inspect: each is read in turn.
  const pinSays = async () => {
    pinned.show('pinned');
    await nextTick();
    const dot = pinDot();
    const said = {
      state: dot?.dataset.state,
      label: dot?.getAttribute('aria-label'),
      chip: Boolean($('.pinned-grid .paused-chip')),
    };
    pinned.show('inspect');
    await nextTick();
    return said;
  };
  $('.docked-view img').dispatchEvent(new Event('load'));
  await nextTick();
  assert.equal(dockDot().dataset.state, 'live');
  assert.equal(cardDot().dataset.state, 'live');
  assert.deepEqual(await pinSays(), {
    state: 'live',
    label: 'Docked · live',
    chip: false,
  });

  // The frame fails: the dock, the card and the pin all say it is unavailable.
  $('.docked-view img').dispatchEvent(new Event('error'));
  await nextTick();
  assert.equal(
    $('.docked-view__tag').textContent,
    'Docked · frame unavailable',
  );
  assert.equal(dockDot().dataset.state, 'lost');
  assert.equal(cardDot().dataset.state, 'lost');
  assert.equal(
    cardDot().getAttribute('aria-label'),
    'Docked · frame unavailable',
  );
  assert.match(cardBar(), /Docked · frame unavailable/);
  assert.doesNotMatch(cardBar(), /bottom right/);
  assert.deepEqual(await pinSays(), {
    state: 'lost',
    label: 'Docked · frame unavailable',
    chip: false,
  });

  // Out of its feed altogether: the same on all three.
  frames = false;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.match($('.docked-view__tag').textContent, /out of feed/);
  assert.equal(cardDot().dataset.state, 'lost');
  assert.match(cardBar(), /Docked · out of feed/);
  assert.deepEqual(await pinSays(), {
    state: 'lost',
    label: 'Docked · out of feed',
    chip: false,
  });
});

test('a docked camera whose stream stalls shows the dock’s stalled state on its pin and card', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
      },
    },
  ]);
  const pinned = usePinnedStore(pinia);
  const docked = useDockedStore(pinia);
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  pinned.pin({
    key: 'cctv:cam1',
    kind: 'camera',
    title: camera.name,
    icon: 'videocam',
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  $('.entity-card__action--dock').click();
  await nextTick();
  // What the dock publishes when its stream stalls (dockedCamera.test.mjs
  // drives the stream itself).
  docked.setFeed('cctv:cam1', 'paused', 'Docked · stalled');
  await nextTick();
  const bar = $('#entity-card .entity-hero--docked');
  assert.equal(bar.querySelector('.feed-dot').dataset.state, 'paused');
  assert.match(bar.textContent, /Docked · stalled/);
  pinned.show('pinned');
  await nextTick();
  const dot = $('.pinned-grid__tile[data-kind="camera"] .feed-dot');
  assert.equal(dot.dataset.state, 'paused');
  assert.equal(dot.getAttribute('title'), 'Docked · stalled');
});

test('unpinning from the keyboard moves focus to the next pin, then the previous, then Undo; a pointer unpin leaves it be', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  for (const [id, title] of [
    ['a', 'Zilker Park'],
    ['b', 'Barton Springs'],
    ['c', 'Mount Bonnell'],
  ])
    pinned.pin({
      key: `place:${id}`,
      kind: 'place',
      title,
      icon: 'location_on',
      identity: { layerId: 'place', id },
    });
  pinned.show('pinned');
  await nextTick();
  const unpin = (title) =>
    $(`.pinned-grid__unpin[aria-label="Unpin ${title}"]`);
  const byKeyboard = (button) =>
    button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  const settle = async () => {
    await nextTick();
    await nextTick();
  };
  // The first: focus moves to the next pin's unpin button.
  unpin('Zilker Park').focus();
  byKeyboard(unpin('Zilker Park'));
  await settle();
  assert.equal(document.activeElement, unpin('Barton Springs'));
  // The last in the list: to the one before it.
  unpin('Mount Bonnell').focus();
  byKeyboard(unpin('Mount Bonnell'));
  await settle();
  assert.equal(document.activeElement, unpin('Barton Springs'));
  // A pointer unpin leaves focus where the pointer left it.
  pinned.pin({
    key: 'place:d',
    kind: 'place',
    title: 'Deep Eddy',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'd' },
  });
  await nextTick();
  const before = document.activeElement;
  unpin('Deep Eddy').dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 1 }),
  );
  await settle();
  assert.equal(document.activeElement, before, 'a pointer unpin moves nothing');
  // The very last pin: the Pinned tab goes, and focus lands on Undo, which
  // the notice then holds while focus is on it.
  byKeyboard(unpin('Barton Springs'));
  await settle();
  assert.equal($('#context-tab-pinned'), null);
  const undo = $('.pin-undo-notice button');
  assert.equal(document.activeElement, undo);
  assert.match($('.pin-undo-notice').textContent, /Unpinned Barton Springs/);
  undo.click();
  await nextTick();
  assert.deepEqual(
    pinned.pins.map((pin) => pin.key),
    ['place:b'],
  );
  t.after(() =>
    pinned.pins.map((pin) => pin.key).forEach((key) => pinned.unpin(key)),
  );
});

test('Clear all from the keyboard moves focus to Undo', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'place:a',
    kind: 'place',
    title: 'Zilker Park',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'a' },
  });
  pinned.pin({
    key: 'place:b',
    kind: 'place',
    title: 'Barton Springs',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'b' },
  });
  pinned.show('pinned');
  await nextTick();
  const clear = $('.pinned-grid__clear');
  clear.focus();
  clear.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  await nextTick();
  assert.equal(pinned.pins.length, 0);
  assert.equal(document.activeElement, $('.pin-undo-notice button'));
  assert.match($('.pin-undo-notice').textContent, /Unpinned 2 items/);
  t.after(() => pinned.clearNotice());
});

test('when its card cannot open, ⤢ keeps the dock and says so', async (t) => {
  const { $, cards, pinia } = fixture(t, [flightsOn([])]);
  const docked = useDockedStore(pinia);
  docked.dock({
    key: 'cockpit:flights:gone1',
    kind: 'cockpit',
    title: 'GONE1',
    identity: { layerId: 'flights', id: 'gone1' },
  });
  cards.open = () => {};
  await nextTick();
  $('.docked-view button').click();
  await nextTick();
  await nextTick();
  assert.ok(docked.view, 'the dock stays');
  assert.match(
    $('.docked-view__notice').textContent,
    /Could not open this in Context/,
  );
});

test('a dock transfer on a phone keeps the dock until Context is shown', async (t) => {
  const body = document.body;
  body.classList.add('mobile-shell');
  t.after(() => {
    body.classList.remove('mobile-shell');
    delete body.dataset.mobileSheet;
  });
  let revealAllowed = false;
  const { $, pinia } = fixture(
    t,
    [flightsOn([flight('test01', 30.3, -97.7)])],
    {
      openPanel: () => {
        if (revealAllowed) body.dataset.mobileSheet = 'context';
      },
    },
  );
  const docked = useDockedStore(pinia);
  docked.dock({
    key: 'flights:test01',
    kind: 'cockpit',
    title: 'TEST01',
    identity: { layerId: 'flights', id: 'test01' },
  });
  await nextTick();
  $('.docked-view button[title="Open in Context"]').click();
  await turn();
  assert.ok(docked.view, 'a hidden destination leaves the dock in place');
  revealAllowed = true;
  $('.docked-view button[title="Open in Context"]').click();
  await turn();
  assert.equal(body.dataset.mobileSheet, 'context');
  assert.ok($('#entity-card'));
  assert.equal(docked.view, null);
});

test('a docked cockpit view holds through a short feed gap, then says it is out of feed', async (t) => {
  const records = [flight('test01', 30.3, -97.7)];
  const { $, pinia } = fixture(t, [flightsOn(records)], {
    previews: STUB_PREVIEWS,
  });
  useDockedStore(pinia).dock({
    key: 'cockpit:flights:test01',
    kind: 'cockpit',
    title: 'TEST01',
    identity: { layerId: 'flights', id: 'test01' },
  });
  await nextTick();
  assert.ok($('.docked-view .flight-cockpit'), 'the cockpit view shows');
  assert.match($('.docked-view__tag').textContent, /live/);
  // Esri's credit, under the picture while the view shows.
  assert.match(
    $('.docked-view__credit')?.textContent || '',
    /^Powered by Esri — Source: Esri, Maxar/,
  );
  records.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.ok(
    $('.docked-view .flight-cockpit'),
    'one missed read keeps the view',
  );
  await new Promise((resolve) => setTimeout(resolve, 4200));
  await nextTick();
  assert.equal($('.docked-view .flight-cockpit'), null);
  assert.match($('.docked-view__tag').textContent, /out of feed/);
  assert.equal($('.docked-view__credit'), null, 'no picture, no credit');
});

test('a docked cockpit view pauses while Cockpit, clean view or recording hides the corner, and runs again after', async (t) => {
  const active = [];
  const cockpitPreview = () => ({
    setActive: (on) => active.push(on),
    update() {},
    destroy() {},
  });
  const records = [flight('test01', 30.3, -97.7)];
  const { $, pinia } = fixture(t, [flightsOn(records)], {
    previews: { ...STUB_PREVIEWS, cockpit: cockpitPreview },
  });
  const docked = useDockedStore(pinia);
  docked.dock({
    key: 'cockpit:flights:test01',
    kind: 'cockpit',
    title: 'TEST01',
    identity: { layerId: 'flights', id: 'test01' },
  });
  await nextTick();
  assert.ok($('.docked-view .flight-cockpit'));
  assert.equal(active.at(-1), true, 'running while shown');
  for (const mode of ['cockpit-mode', 'ui-clean-view', 'recording-mode']) {
    t.after(() => document.body.classList.remove(mode));
    document.body.classList.add(mode);
    await turn();
    await nextTick();
    assert.equal(active.at(-1), false, `paused under ${mode}`);
    assert.equal(
      docked.feedOf('cockpit:flights:test01').text,
      'Docked · paused',
    );
    document.body.classList.remove(mode);
    await turn();
    await nextTick();
    assert.equal(active.at(-1), true, `running again after ${mode}`);
  }
});

test("a camera's row of figures fills a missing city, field of view or range from facing, refresh, then provider, and More details never repeats it", async (t) => {
  const camera = { id: 'cam1', name: 'US-183', lat: 30.27, lon: -97.73 };
  let details = {};
  const { $, cards } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        cameraDetails: () => ({
          name: camera.name,
          city: null,
          provider: null,
          feedType: null,
          headingDeg: null,
          fovDeg: null,
          rangeM: null,
          refreshMs: 6_000,
          ...details,
        }),
      },
    },
  ]);
  const show = async (next) => {
    details = next;
    cards.clear();
    await nextTick();
    cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
    await nextTick();
    await nextTick();
    return {
      tiles: [
        ...document.querySelectorAll('#entity-card .entity-card__tile span'),
      ].map((span) => span.textContent),
      more: $('#entity-card .entity-card__more')?.textContent || '',
    };
  };
  // No field of view or range: facing and refresh take their places.
  let shown = await show({ city: 'Austin', provider: 'TxDOT', headingDeg: 90 });
  assert.deepEqual(shown.tiles, ['City', 'Facing', 'Refresh']);
  assert.match(shown.more, /Data source\s*TxDOT/);
  assert.doesNotMatch(shown.more, /City|Facing|Refresh/);
  // Only a city: refresh, then the provider, stand in; the provider leaves
  // More details for the row.
  shown = await show({ city: 'Austin', provider: 'TxDOT' });
  assert.deepEqual(shown.tiles, ['City', 'Refresh', 'Provider']);
  assert.doesNotMatch(shown.more, /Data source|TxDOT|City|Refresh/);
  // One figure is no row: it goes under More details.
  shown = await show({});
  assert.deepEqual(shown.tiles, []);
  assert.equal($('#entity-card .entity-card__tiles'), null);
  assert.match(shown.more, /Refresh\s*6 s/);
});

test("a partner-supplied camera's card names its owner beside the provider", async (t) => {
  const camera = {
    id: 'cam1',
    name: 'Hwy 1 @ Willingdon',
    lat: 49.26,
    lon: -123.0,
  };
  let details = {};
  const { $, cards } = fixture(t, [
    {
      id: 'cctv',
      name: 'Cameras',
      enabled: true,
      records: [camera],
      module: {
        frameUrlForCamera: (id) => ({
          url: `/frame/${id}.jpg`,
          refreshMs: 10_000,
        }),
        cameraDetails: () => ({
          name: camera.name,
          refreshMs: 10_000,
          ...details,
        }),
      },
    },
  ]);
  const sourceLine = async (next) => {
    details = next;
    cards.clear();
    await nextTick();
    cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
    await nextTick();
    await nextTick();
    return $('#entity-card .entity-card__source-line')?.textContent || '';
  };
  assert.match(
    await sourceLine({ provider: 'DriveBC', credit: 'TransLink' }),
    /^DriveBC · TransLink/,
  );
  // A feed with no partner names only its provider.
  const plain = await sourceLine({ provider: 'DriveBC' });
  assert.match(plain, /^DriveBC/);
  assert.doesNotMatch(plain, /TransLink/);
});

test('a camera opened from its pin stays while Cameras is off, with its last frame', async (t) => {
  const camera = { id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 };
  const layer = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: [camera],
    module: {
      frameUrlForCamera: (id) =>
        layer.enabled ? { url: `/frame/${id}.jpg`, refreshMs: 10_000 } : null,
      cameraDetails: () => ({
        name: camera.name,
        city: 'Austin',
        feedType: 'image',
        headingDeg: 0,
        fovDeg: 40,
        rangeM: 120,
        refreshMs: 10_000,
      }),
    },
  };
  const flights = flightsOn([flight('test01', 30.3, -97.7)]);
  const { $, cards, pinia, notifyLayers } = fixture(t, [layer, flights]);
  const pinned = usePinnedStore(pinia);
  // The saved frame (the test DOM cannot draw one): data, never the URL.
  _setFrameStillCaptureForTest(
    async ({ url }) => `data:image/jpeg;base64,${btoa(url)}`,
  );
  t.after(() => _setFrameStillCaptureForTest(null));
  const saved = `data:image/jpeg;base64,${btoa('/frame/cam1.jpg')}`;
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  $('.entity-card__action--pin').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await nextTick();
  pinned.show('pinned');
  await nextTick();
  assert.equal(
    pinned.stillOf('cctv:cam1') || pinned.stillOf(cards.card.key),
    saved,
    'the pin keeps the frame it saved',
  );
  // Cameras turned off: an ordinary pick closes, but the pin stays.
  cards.clear();
  layer.enabled = false;
  layer.records = [];
  notifyLayers();
  await nextTick();
  $('.pinned-grid__open').click();
  await nextTick();
  assert.equal(cards.card?.identity.id, 'cam1', 'the pin opens its card');
  assert.equal(
    $('#context-tab-camera'),
    null,
    'Camera settings are hidden while Cameras is off',
  );
  const selection = cards.selectionGeneration();
  document.dispatchEvent(new CustomEvent(CAMERA_SETTINGS_EVENT));
  await nextTick();
  assert.equal(
    cards.selectionGeneration(),
    selection,
    'a settings request leaves the saved selection alone',
  );
  assert.equal(cards.fromPin, true, 'the card keeps its pin origin');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await nextTick();
  assert.equal(
    cards.card?.identity.id,
    'cam1',
    'still there after a refresh tick',
  );
  assert.equal(
    $('.entity-hero img')?.getAttribute('src'),
    saved,
    'the same saved still',
  );
  assert.match($('.entity-hero .paused-chip').textContent, /Paused/);
  assert.equal(
    $('.entity-hero .paused-chip').getAttribute('title'),
    'Cameras off · last frame',
  );
  assert.deepEqual(
    [...document.querySelectorAll('#entity-card .entity-card__tile span')].map(
      (span) => span.textContent,
    ),
    ['City', 'Field of view', 'Range'],
    'the paused chip, not a status figure, says why',
  );
  assert.equal(layer.enabled, false, 'the layer is not turned back on');
  // Once Cameras is on, its settings can activate the camera without losing the pin.
  layer.enabled = true;
  layer.records = [camera];
  notifyLayers();
  await nextTick();
  $('#context-tab-camera').click();
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-camera').getAttribute('aria-selected'), 'true');
  assert.equal(cards.fromPin, true);
  layer.enabled = false;
  layer.records = [];
  notifyLayers();
  await nextTick();
  assert.equal($('#context-tab-camera'), null);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  assert.equal($('.entity-hero img')?.getAttribute('src'), saved);
  layer.enabled = true;
  notifyLayers();
  await nextTick();
  assert.equal(
    $('#context-tab-camera').getAttribute('aria-selected'),
    'false',
    'turning Cameras back on stays on Inspect',
  );
  // A card picked the ordinary way still closes with its layer.
  flights.enabled = false;
  assert.equal(
    cards.select(
      {
        layerId: 'flights',
        id: 'test01',
        label: 'TEST01',
        lat: 30.3,
        lon: -97.7,
      },
      { follow: false },
    ),
    true,
  );
  assert.equal(cards.fromPin, false);
  await new Promise((resolve) => setTimeout(resolve, 2300));
  await nextTick();
  assert.equal(cards.card, null, 'an ordinary pick goes with its layer');
});

test('a stream camera pinned while its video connects keeps its first drawn frame, never a blank one', async (t) => {
  const camera = { id: 'cam9', name: 'US 113 @ US 9', lat: 38.68, lon: -75.4 };
  const layer = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: [camera],
    module: {
      frameUrlForCamera: (id) => ({
        url: `/frame/${id}.svg`,
        refreshMs: 10_000,
      }),
      cameraDetails: () => ({
        name: camera.name,
        feedType: 'hls',
        refreshMs: 10_000,
      }),
    },
  };
  const { $, cards, pinia } = fixture(t, [layer]);
  const cctv = useCctvStore(pinia);
  const active = { ...camera, isVideo: true };
  cctv.publish(
    presentCctvPanel(
      {
        enabled: true,
        count: 1,
        cameraIndex: [active],
        activeCameraId: 'cam9',
        activeCamera: active,
      },
      true,
    ),
  );
  await nextTick();
  // The live video's canvas, at home in the camera tools until a card shows it.
  if (!$('#cctv-video')) {
    const home = document.body.appendChild(document.createElement('div'));
    home.id = 'cctv-frame-wrap';
    home.appendChild(document.createElement('canvas')).id = 'cctv-video';
  }
  cctv.setLive(true);
  cctv.setLiveState('waiting');
  const saved = [];
  _setFrameStillCaptureForTest(async ({ shown, url }) => {
    saved.push({ shown: shown?.tagName || null, url });
    return 'data:image/jpeg;base64,DRAWN';
  });
  t.after(() => _setFrameStillCaptureForTest(null));
  cards.select({ layerId: 'cctv', id: 'cam9' }, { fly: false });
  await nextTick();
  await nextTick();
  assert.equal(
    $('#entity-card .cctv-preview__video canvas')?.id,
    'cctv-video',
    'the card shows the live canvas',
  );
  assert.equal(
    $('#entity-card .cctv-preview__wait')?.textContent,
    'Acquiring frame…',
  );
  $('.entity-card__action--pin').click();
  await turn();
  await nextTick();
  assert.deepEqual(
    saved,
    [],
    'nothing saved from a canvas that has drawn nothing',
  );
  cctv.setLiveState('playing');
  await turn();
  await nextTick();
  assert.deepEqual(
    saved.map((entry) => entry.shown),
    ['CANVAS'],
    'the drawn frame is saved',
  );
  assert.equal(
    usePinnedStore(pinia).stillOf(cards.card.key),
    'data:image/jpeg;base64,DRAWN',
  );
});

test('a camera pinned while its video connects never saves another camera picked meanwhile', async (t) => {
  const first = { id: 'cam9', name: 'US 113 @ US 9', lat: 38.68, lon: -75.4 };
  const second = { id: 'cam10', name: 'US 13 @ SR 1', lat: 38.7, lon: -75.5 };
  const layer = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: [first, second],
    module: {
      frameUrlForCamera: (id) => ({
        url: `/frame/${id}.svg`,
        refreshMs: 10_000,
      }),
      cameraDetails: (id) => ({ name: id, feedType: 'hls', refreshMs: 10_000 }),
    },
  };
  const { $, cards, pinia } = fixture(t, [layer]);
  const cctv = useCctvStore(pinia);
  const activate = (camera) => {
    const active = { ...camera, isVideo: true };
    cctv.publish(
      presentCctvPanel(
        {
          enabled: true,
          count: 2,
          cameraIndex: [active],
          activeCameraId: camera.id,
          activeCamera: active,
        },
        true,
      ),
    );
  };
  activate(first);
  await nextTick();
  if (!$('#cctv-video')) {
    const home = document.body.appendChild(document.createElement('div'));
    home.id = 'cctv-frame-wrap';
    home.appendChild(document.createElement('canvas')).id = 'cctv-video';
  }
  cctv.setLive(true);
  cctv.setLiveState('waiting');
  const saved = [];
  _setFrameStillCaptureForTest(async ({ shown, url }) => {
    saved.push({ shown: shown?.tagName || null, url });
    return shown
      ? 'data:image/jpeg;base64,DRAWN'
      : `data:image/jpeg;base64,${btoa(url)}`;
  });
  t.after(() => _setFrameStillCaptureForTest(null));
  cards.select({ layerId: 'cctv', id: 'cam9' }, { fly: false });
  await nextTick();
  await nextTick();
  const pinKey = cards.card.key;
  $('.entity-card__action--pin').click();
  await turn();
  await nextTick();
  assert.deepEqual(saved, [], 'waiting for the first camera to draw');
  // The second camera is picked and draws before the first one did.
  activate(second);
  cards.select({ layerId: 'cctv', id: 'cam10' }, { fly: false });
  await nextTick();
  await nextTick();
  cctv.setLiveState('playing');
  await turn();
  await nextTick();
  assert.deepEqual(
    saved,
    [{ shown: null, url: '/frame/cam9.svg' }],
    'the first camera’s own frame is read instead',
  );
  assert.equal(
    usePinnedStore(pinia).stillOf(pinKey),
    `data:image/jpeg;base64,${btoa('/frame/cam9.svg')}`,
  );
});

test('a pinned camera is a still: its tile keeps the frame it had when pinned and nothing re-reads it', async (t) => {
  let frame = '/frame/cam1-a.jpg';
  const reads = [];
  const layer = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    records: [{ id: 'cam1', name: 'I-35 @ 12th', lat: 30.27, lon: -97.73 }],
    module: {
      frameUrlForCamera: (id) => {
        reads.push(id);
        return { url: frame, refreshMs: 10_000 };
      },
    },
  };
  const { $, cards, pinia } = fixture(t, [layer]);
  const pinned = usePinnedStore(pinia);
  _setFrameStillCaptureForTest(
    async ({ url }) => `data:image/jpeg;base64,${btoa(url)}`,
  );
  t.after(() => _setFrameStillCaptureForTest(null));
  cards.select({ layerId: 'cctv', id: 'cam1' }, { fly: false });
  await nextTick();
  $('.entity-card__action--pin').click();
  t.after(() => pinned.unpin('cctv:cam1'));
  await new Promise((resolve) => setTimeout(resolve, 0));
  cards.clear();
  frame = '/frame/cam1-b.jpg';
  pinned.show('pinned');
  await nextTick();
  reads.length = 0;
  const still = $('.pinned-grid__frame').getAttribute('src');
  assert.equal(
    still,
    `data:image/jpeg;base64,${btoa('/frame/cam1-a.jpg')}`,
    'the frame it had when pinned, saved',
  );
  assert.doesNotMatch(
    still,
    /^\/frame\//,
    'never a URL that would fetch a newer frame',
  );
  assert.equal(Boolean($('.pinned-grid__live')), false, 'no live dot');
  await new Promise((resolve) => setTimeout(resolve, 50));
  await nextTick();
  assert.deepEqual(reads, [], 'the grid asks for no frame');
});

test('Clear all unpins everything at once, and Undo puts every pin back with its still', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'place:a',
    kind: 'place',
    title: 'Zilker Park',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'a' },
    still: '/still/a.png',
  });
  pinned.pin({
    key: 'place:b',
    kind: 'place',
    title: 'Barton Springs',
    icon: 'location_on',
    identity: { layerId: 'place', id: 'b' },
    still: '/still/b.png',
  });
  pinned.show('pinned');
  await nextTick();
  assert.match($('.pinned-grid__head').textContent, /Pinned · 2\s*Clear all/);
  $('.pinned-grid__clear').click();
  await nextTick();
  assert.equal(pinned.pins.length, 0);
  assert.equal(
    $('#context-tab-pinned'),
    null,
    'the Pinned tab goes with the last pin',
  );
  assert.match($('.pin-undo-notice').textContent, /Unpinned 2 items/);
  $('.pin-undo-notice button').click();
  await nextTick();
  assert.deepEqual(
    pinned.pins.map((pin) => pin.key),
    ['place:a', 'place:b'],
    'back, in order',
  );
  assert.equal(pinned.stillOf('place:b'), '/still/b.png');
});

/**
 * Context with Radio off and its station KUT pinned on the Pinned tab. The
 * omnibar's setLayer records any attempt to turn a layer on; none is made
 * (`listed: false` leaves the station out of the catalogue).
 */
async function radioOffWithPinnedStation(t, { listed = true } = {}) {
  _resetPinnedStationForTest();
  t.after(() => _resetPinnedStationForTest());
  const radio = radioLayer();
  radio.emit({ enabled: false, presentationActive: false, selected: null });
  if (!listed) {
    const play = radio.playStation;
    radio.playStation = (id) =>
      id === 'kut' ? (radio.calls.push(['play', id]), false) : play(id);
  }
  const row = { id: 'radio', name: 'Radio', enabled: false, records: [] };
  const fixed = fixture(t, [flightsOn([flight('test01', 30.3, -97.7)]), row]);
  const { cards, pinia } = fixed;
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  cards.setView({ center: HERE, heightM: 40_000 });
  const turnedOn = [];
  useOmnibarStore(pinia).connect({
    layers: () => [],
    setLayer: async (...args) => turnedOn.push(args),
  });
  t.after(() => useOmnibarStore(pinia).connect(null));
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'radio:kut',
    kind: 'station',
    title: 'KUT 90.5',
    icon: 'radio',
    identity: { layerId: 'radio', id: 'kut' },
  });
  t.after(() => pinned.unpin('radio:kut'));
  pinned.show('pinned');
  // Context finds the Radio layer on its next look.
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  return { ...fixed, radio, row, pinned, turnedOn };
}

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await turn();
    await nextTick();
  }
};

test('with Radio off, tapping a pinned station plays it and leaves Radio off; its tile and the mini player go live', async (t) => {
  const { $, radio, row, pinned, turnedOn } =
    await radioOffWithPinnedStation(t);
  assert.equal(
    $('.pinned-grid .paused-chip').getAttribute('title'),
    'Radio off',
  );
  const tile = $('.pinned-grid__open');
  assert.equal(tile.getAttribute('title'), 'Play KUT 90.5');
  tile.click();
  await settle();
  assert.deepEqual(
    radio.calls.at(-1),
    ['play', 'kut'],
    'played from the catalogue',
  );
  assert.deepEqual(turnedOn, [], 'nothing turned on');
  assert.equal(row.enabled, false);
  assert.equal(radio.state().enabled, false);
  assert.equal(pinned.tab, 'pinned', 'Pinned stays: there is no station list');
  radio.emit({ audioState: 'playing' });
  await nextTick();
  assert.equal($('.pinned-grid .feed-dot').dataset.state, 'live');
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
});

test('a pinned station whose stream fails shows the error in the mini player and its tile', async (t) => {
  const { $, radio } = await radioOffWithPinnedStation(t);
  $('.pinned-grid__open').click();
  await settle();
  radio.emit({
    audioState: 'error',
    audioError: 'Broadcaster stream is unavailable or blocked by the browser.',
  });
  await nextTick();
  assert.match(
    $('.pinned-grid .paused-chip').getAttribute('title'),
    /unavailable or blocked/,
  );
  assert.match(
    $('.radio-mini').textContent,
    /KUT 90\.5/,
    'the player stays to say so',
  );
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'lost');
  assert.match(
    $('.radio-mini__name').getAttribute('title'),
    /unavailable or blocked/,
  );
});

test('with only a pin and Radio off, the mini player is ready to play the pinned station in one tap, Radio left off', async (t) => {
  const { $, radio, turnedOn, close } = await radioOffWithPinnedStation(t);
  close();
  await nextTick();
  const mini = $('.radio-mini');
  assert.ok(mini, 'the pinned station keeps the player');
  assert.match(mini.textContent, /KUT 90\.5/);
  assert.equal(mini.getAttribute('aria-label'), 'Radio station');
  assert.equal(mini.querySelector('.feed-dot'), null, 'ready, not paused');
  assert.deepEqual(
    miniControls($),
    MINI_CONTROLS.map(() => true),
    'every control is there',
  );
  assert.equal($('.radio-mini__pin').getAttribute('aria-pressed'), 'true');
  $('.radio-mini__play').click();
  await settle();
  assert.deepEqual(radio.calls.at(-1), ['play', 'kut']);
  assert.deepEqual(turnedOn, []);
  assert.equal(radio.state().enabled, false);
  radio.emit({ audioState: 'playing' });
  await nextTick();
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
});

test('with Local receiver chosen the mini player offers no pinned station; back on the internet stations it does', async (t) => {
  const { $, radio, close } = await radioOffWithPinnedStation(t);
  close();
  await nextTick();
  assert.ok($('.radio-mini'), 'ready to play the pin');
  radio.emit({ source: 'local', localReceiver: true });
  await nextTick();
  assert.equal($('.radio-mini'), null, 'only the local receiver');
  radio.emit({ source: 'internet', localReceiver: false });
  await nextTick();
  assert.match($('.radio-mini').textContent, /KUT 90\.5/);
});

test('with Radio off, Previous and Next step without turning Radio on, and are disabled with nothing to step through', async (t) => {
  const { $, radio, turnedOn, close } = await radioOffWithPinnedStation(t);
  close();
  await nextTick();
  $('[aria-label="Next filtered station"]').click();
  $('[aria-label="Previous filtered station"]').click();
  assert.deepEqual(radio.calls.slice(-2), [
    ['step', 1],
    ['step', -1],
  ]);
  assert.deepEqual(turnedOn, []);
  radio.emit({ filteredCount: 0 });
  await nextTick();
  const next = $('.radio-mini [aria-label="Next filtered station"]');
  const previous = $('.radio-mini [aria-label="Previous filtered station"]');
  assert.ok(next && previous, 'still there');
  assert.equal(next.disabled, true);
  assert.equal(previous.disabled, true);
});

test('with Radio off, Next on a paused pinned station shows the station stepped to, ready to play, and Play plays it', async (t) => {
  const { $, radio, close } = await radioOffWithPinnedStation(t);
  close();
  await nextTick();
  // As the layer steps with Radio off: a paused stream of the station left
  // behind is let go, and the selection moves on.
  radio.stepStationWhileOff = (direction) => {
    radio.calls.push(['step', direction]);
    radio.emit({
      audioState: 'stopped',
      playingStationId: null,
      selected: radio.stations[1],
    });
    return true;
  };
  $('.radio-mini__play').click();
  await settle();
  radio.emit({ audioState: 'playing' });
  await nextTick();
  $('.radio-mini__play').click();
  await nextTick();
  assert.equal(
    $('.radio-mini').getAttribute('aria-label'),
    'Radio playback: Paused',
  );
  assert.match($('.radio-mini').textContent, /KUT 90\.5/);
  $('[aria-label="Next filtered station"]').click();
  await nextTick();
  assert.match(
    $('.radio-mini').textContent,
    /KUTX 98\.9/,
    'the station stepped to',
  );
  assert.doesNotMatch($('.radio-mini').textContent, /KUT 90\.5/);
  assert.equal(
    $('.radio-mini').getAttribute('aria-label'),
    'Radio station',
    'ready to play',
  );
  $('.radio-mini__play').click();
  await nextTick();
  assert.deepEqual(
    radio.calls.at(-1),
    ['play', 'kutx'],
    'Play plays it, not the pin',
  );
});

test('the mini player’s name says what it is doing: playing, loading, paused or unavailable', async (t) => {
  const { $, radio } = await radioOnWithList(t);
  const label = () => $('.radio-mini').getAttribute('aria-label');
  assert.equal(label(), 'Radio playing');
  radio.emit({ audioState: 'loading' });
  await nextTick();
  assert.equal(label(), 'Radio playback: Loading');
  radio.emit({ audioState: 'paused' });
  await nextTick();
  assert.equal(label(), 'Radio playback: Paused');
  radio.emit({ audioState: 'error' });
  await nextTick();
  assert.equal(label(), 'Radio playback: Broadcaster stream unavailable');
  radio.emit({ audioState: 'stopped', playingStationId: null });
  await nextTick();
  assert.equal(label(), 'Radio station');
});

test('a pinned station plays on (or stays paused) through Radio off, Clear all, Context closing, tabs, another pick and camera moves', async (t) => {
  const { $, radio, cards, pinned, close } = await radioOffWithPinnedStation(t);
  radio.emit({ enabled: true, presentationActive: true });
  radio.playStation('kut');
  radio.emit({ audioState: 'playing' });
  await nextTick();
  const before = radio.calls.length;
  const live = () => {
    assert.equal(radio.state().audioState, 'playing');
    assert.equal($('.radio-mini .feed-dot').dataset.state, 'live');
  };
  radio.turnOff(); // Radio off, or Clear all
  await settle();
  live();
  pinned.show('inspect');
  await nextTick();
  pinned.show('pinned');
  await nextTick();
  live();
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  live();
  cards.setView({ center: { lat: 31, lon: -98 }, heightM: 90_000 });
  await settle();
  live();
  close();
  await nextTick();
  live();
  assert.deepEqual(radio.calls.slice(before), [], 'no pause, stop or replay');
  // Paused, it stays paused through Radio off.
  radio.pause();
  radio.turnOff();
  await settle();
  assert.equal(radio.state().audioState, 'paused');
  assert.equal($('.radio-mini .feed-dot').dataset.state, 'paused');
});

test('a pinned station the catalogue does not hold says so on its tile', async (t) => {
  const { $, radio } = await radioOffWithPinnedStation(t, { listed: false });
  $('.pinned-grid__open').click();
  await settle();
  assert.deepEqual(radio.calls.at(-1), ['play', 'kut']);
  assert.match(
    $('.pinned-grid .paused-chip').getAttribute('title'),
    /KUT 90\.5 is not in the station directory right now/,
  );
});

test('with Radio on, tapping a pinned station plays it on Inspect without touching the layer', async (t) => {
  _resetPinnedStationForTest();
  t.after(() => _resetPinnedStationForTest());
  const radio = radioLayer();
  const { cards, pinia } = fixture(t, [
    flightsOn([flight('test01', 30.3, -97.7)]),
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  const turnedOn = [];
  useOmnibarStore(pinia).connect({
    layers: () => [],
    setLayer: async (...args) => turnedOn.push(args),
  });
  t.after(() => useOmnibarStore(pinia).connect(null));
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'radio:kutx',
    kind: 'station',
    title: 'KUTX 98.9',
    icon: 'radio',
    identity: { layerId: 'radio', id: 'kutx' },
  });
  t.after(() => pinned.unpin('radio:kutx'));
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  pinned.show('pinned');
  await nextTick();
  document.querySelector('.pinned-grid__open').click();
  await settle();
  assert.deepEqual(turnedOn, []);
  assert.equal(pinned.tab, 'inspect');
  assert.equal(cards.card, null, 'the pick is let go for the station list');
  assert.deepEqual(radio.calls.at(-1), ['play', 'kutx']);
});

test('with nothing on, display-only tiles show what free layers would show, worldwide and last known', async (t) => {
  const satellites = {
    id: 'satellites',
    name: 'Satellites',
    enabled: false,
    records: [],
    stats: {},
  };
  const asked = [];
  const fetchImpl = async (url) => {
    asked.push(String(url));
    if (String(url).includes('/api/layer-counts'))
      return new Response(
        JSON.stringify({
          now: Date.now(),
          counts: [
            {
              layerId: 'satellites',
              count: 1272,
              at: Date.now() - 2 * 3600_000,
            },
            { layerId: 'cctv', count: 7350, at: Date.now() - 60_000 },
            { layerId: 'traffic', count: 99, at: Date.now() },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    return new Response('', { status: 503 });
  };
  const { $, cards, notifyLayers } = fixture(t, [satellites], { fetchImpl });
  cards.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
  await nextTick();
  await turn();
  await nextTick();
  const tiles = () => [
    ...document.querySelectorAll(
      '.view-context__tiles--counts .view-context__tile',
    ),
  ];
  assert.deepEqual(
    tiles().map((tile) => tile.dataset.layer),
    ['satellites', 'cctv'],
    'free layers only, in order',
  );
  assert.match(tiles()[0].textContent, /1,272/);
  assert.doesNotMatch(
    tiles()[0].textContent,
    /≈/,
    'an old count is marked by its age, not a sign',
  );
  assert.match(tiles()[0].textContent, /2 h ago/);
  assert.match(tiles()[1].textContent, /7,350/);
  assert.equal(
    document.querySelector('.view-context__tiles--counts button'),
    null,
    'display only',
  );
  assert.match($('.view-context__label').textContent, /Worldwide, last known/);
  assert.match(
    $('.view-context__hint--counts').textContent,
    /No live requests/,
  );
  // The camera's height is a strip of its own under the facts, as before.
  assert.match($('.view-context__camera').textContent, /Camera height/);
  assert.equal(
    [
      ...document.querySelectorAll(
        '.view-context__tiles--facts .view-context__tile-name',
      ),
    ].some((node) => /^Camera$/.test(node.textContent)),
    false,
    'not a squeezed tile',
  );
  assert.ok($('.view-context__pointer'), 'the pointer to Data Layers stays');
  assert.equal(
    asked.filter((url) => url.includes('/api/layer-counts')).length,
    1,
  );
  // The layer turned on counts itself when its count is of the whole world;
  // turned off, its count stays. The data manager announces each change, as
  // it does on a toggle.
  satellites.enabled = true;
  satellites.stats = {
    count: 1300,
    lastUpdate: Date.now(),
    scope: 'worldwide',
  };
  notifyLayers();
  await nextTick();
  satellites.enabled = false;
  notifyLayers();
  await nextTick();
  assert.match(
    tiles()[0].textContent,
    /1,300/,
    'the live count stays after the layer is off',
  );
  assert.equal(
    asked.filter((url) => url.includes('/api/layer-counts')).length,
    1,
    'no second ask',
  );
});

test('a feed in trouble gives no live count for the nothing-on tiles, even a fresh one', async (t) => {
  const satellites = {
    id: 'satellites',
    name: 'Satellites',
    enabled: false,
    records: [],
    stats: {},
  };
  const { cards, notifyLayers } = fixture(t, [satellites], {
    useInspector: true,
  });
  cards.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
  await nextTick();
  satellites.enabled = true;
  satellites.stats = {
    count: 900,
    lastUpdate: Date.now(),
    stale: true,
    scope: 'worldwide',
  };
  notifyLayers();
  await nextTick();
  satellites.enabled = false;
  notifyLayers();
  await nextTick();
  assert.equal(
    document.querySelector(
      '.view-context__tiles--counts .view-context__tile[data-layer="satellites"]',
    ),
    null,
    'no tile from a stale feed',
  );
});

// Bounded: without the hand-off this test must fail by name, not hang.
test(
  'when the last Nearby row goes while focused, the radius slider takes the focus, not the page',
  { timeout: 10_000 },
  async (t) => {
    const flights = flightsOn([flight('near01', 30.31, -97.74)]);
    const { $, cards } = fixture(t, [flights]);
    cards.setView({ center: HERE, heightM: 40_000 });
    await nextTick();
    const row = $('.view-context .nearby-lists [data-row-key]');
    assert.ok(row, 'one Nearby row');
    row.focus();
    assert.equal(document.activeElement, row);
    // The aircraft leaves; the next read of the view finds nothing nearby.
    flights.records = [];
    flights.stats = {
      ...flights.stats,
      count: 0,
      lastUpdate: flights.stats.lastUpdate + 1,
    };
    cards.setView({ center: { ...HERE }, heightM: 40_000 });
    await nextTick();
    await nextTick();
    assert.equal(
      Boolean($('.view-context .nearby-lists')),
      false,
      'the section is gone',
    );
    assert.equal(document.activeElement, $('.view-context__radius input'));

    cards.setView({ center: HERE, heightM: 6_000_000 });
    await nextTick();
    assert.ok(document.activeElement.matches('.view-context__blocks'));
  },
);

test(
  'a focused globe row that drops out hands the focus to the row now in its place',
  { timeout: 10_000 },
  async (t) => {
    const flights = flightsOn([
      flight('near01', 1, 1),
      flight('mid01', 10, 10),
    ]);
    const { $, cards } = fixture(t, [flights]);
    const GLOBE = { center: { lat: 0, lon: 0 }, heightM: 20_000_000 };
    cards.setView({ ...GLOBE });
    await nextTick();
    const first = $(
      '.view-context__block[data-layer="flights"] [data-row-key]',
    );
    first.focus();
    assert.equal(document.activeElement, first);
    // The nearest aircraft leaves with the next snapshot.
    flights.records = [flight('mid01', 10, 10)];
    flights.stats = {
      ...flights.stats,
      count: 1,
      lastUpdate: flights.stats.lastUpdate + 1,
    };
    cards.setView({ ...GLOBE });
    await nextTick();
    await nextTick();
    const row = $('.view-context__block[data-layer="flights"] [data-row-key]');
    assert.match(row.textContent, /MID01/);
    assert.equal(document.activeElement, row, 'the row now in its place');
  },
);

test('switching zoom modes preserves the focused item or moves focus to the view', async (t) => {
  const flights = flightsOn([flight('near01', 30.31, -97.74)]);
  const { $, cards, notifyLayers, replaceManager } = fixture(t, [flights], {
    useInspector: true,
  });
  const nearby = '.nearby-lists [data-row-key]';
  const atGlobe = '.view-context__blocks [data-row-key]';
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  $(nearby).focus();
  assert.equal(document.activeElement, $(nearby));

  cards.setView({ center: HERE, heightM: 6_000_000 });
  await nextTick();
  assert.ok(
    document.activeElement === $(atGlobe),
    'the same item owns focus in the globe view',
  );
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.ok(
    document.activeElement === $(nearby),
    'the same item owns focus again in Nearby',
  );

  const globe = { center: HERE, heightM: 6_000_000 };
  cards.setView(globe);
  await nextTick();
  assert.equal(document.activeElement, $(atGlobe));
  flights.enabled = false;
  notifyLayers();
  cards.setView({ ...globe });
  await nextTick();
  assert.ok(
    document.activeElement === $('.view-context'),
    'the view owns focus when the last layer closes',
  );

  flights.enabled = true;
  notifyLayers();
  await nextTick();
  $(atGlobe).focus();
  replaceManager({ layers: new Map(), getAll: () => [] });
  cards.pulseInspector();
  await nextTick();
  assert.equal(
    document.activeElement,
    $('.view-context'),
    'a silent manager replacement recovers focus on the next pulse',
  );
});

test(
  'globe search keeps focus in Context when the last matching row leaves',
  { timeout: 10_000 },
  async (t) => {
    const flights = flightsOn([
      flight('near01', 1, 1),
      flight('mid01', 10, 10),
    ]);
    const { $, cards } = fixture(t, [flights]);
    const globe = { center: { lat: 0, lon: 0 }, heightM: 20_000_000 };
    cards.setView(globe);
    contextSearchOpen.value = true;
    contextSearchText.value = 'near01';
    await nextTick();
    const row = $('.view-context__block [data-row-key]');
    assert.match(row.textContent, /NEAR01/);
    row.focus();
    assert.equal(document.activeElement, row);

    flights.records = [flight('mid01', 10, 10)];
    flights.stats = {
      ...flights.stats,
      count: 1,
      lastUpdate: flights.stats.lastUpdate + 1,
    };
    cards.setView({ ...globe });
    await nextTick();
    await nextTick();
    assert.ok(
      document.activeElement === $('.view-context__blocks'),
      'focus moves to the globe results when the last matching row leaves',
    );
    assert.ok(
      !$('.view-context__blocks .view-context__block'),
      'the unmatched globe group is gone',
    );
    assert.match(
      $('.view-context__blocks [role="status"]')?.textContent ?? '',
      /\b0\b/,
    );
  },
);

test('a stalled feed turned on and off never passes its old count off as new over a newer server count', async (t) => {
  const satellites = {
    id: 'satellites',
    name: 'Satellites',
    enabled: false,
    records: [],
    stats: {},
  };
  const fetchImpl = async (url) =>
    String(url).includes('/api/layer-counts')
      ? new Response(
          JSON.stringify({
            now: Date.now(),
            counts: [
              {
                layerId: 'satellites',
                count: 1272,
                at: Date.now() - 10 * 60_000,
              },
            ],
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        )
      : new Response('', { status: 503 });
  const { cards, notifyLayers } = fixture(t, [satellites], { fetchImpl });
  cards.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
  await nextTick();
  await turn();
  await nextTick();
  const tile = () =>
    document.querySelector(
      '.view-context__tiles--counts .view-context__tile[data-layer="satellites"]',
    );
  assert.match(tile().textContent, /1,272/);
  // Its feed last read three hours ago.
  satellites.enabled = true;
  satellites.stats = {
    count: 900,
    lastUpdate: Date.now() - 3 * 3600_000,
    scope: 'worldwide',
  };
  notifyLayers();
  await nextTick();
  satellites.enabled = false;
  notifyLayers();
  await nextTick();
  assert.match(tile().textContent, /1,272/, 'the newer server count stays');
  assert.match(tile().textContent, /10 min ago/);
  assert.doesNotMatch(tile().textContent, /900|s ago/);
});

test('only a worldwide live count replaces a server count: an area count (vessels) does not', async (t) => {
  const vessels = {
    id: 'ais-live-vessels',
    name: 'Live Vessels',
    enabled: false,
    records: [],
    stats: {},
  };
  const flights = {
    id: 'flights',
    name: 'Live Flights',
    enabled: false,
    records: [],
    stats: {},
  };
  const fetchImpl = async (url) =>
    String(url).includes('/api/layer-counts')
      ? new Response(
          JSON.stringify({
            now: Date.now(),
            counts: [
              { layerId: 'flights', count: 9100, at: Date.now() - 10 * 60_000 },
              {
                layerId: 'ais-live-vessels',
                count: 41000,
                at: Date.now() - 10 * 60_000,
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      : new Response('', { status: 503 });
  const { cards, notifyLayers } = fixture(t, [flights, vessels], { fetchImpl });
  cards.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
  await nextTick();
  await turn();
  await nextTick();
  const tile = (id) =>
    document.querySelector(
      `.view-context__tiles--counts .view-context__tile[data-layer="${id}"]`,
    );
  assert.match(tile('ais-live-vessels').textContent, /41,000/);
  // Vessels load the area in view; Flights a worldwide snapshot.
  vessels.enabled = true;
  vessels.stats = { count: 120, lastUpdate: Date.now() };
  flights.enabled = true;
  // Its drawn count leaves out what the military layer shows; the snapshot
  // itself is the world's.
  flights.stats = {
    count: 9300,
    lastUpdate: Date.now(),
    scope: 'worldwide',
    scopeCount: 9400,
  };
  notifyLayers();
  await nextTick();
  vessels.enabled = false;
  flights.enabled = false;
  notifyLayers();
  await nextTick();
  assert.match(
    tile('ais-live-vessels').textContent,
    /41,000/,
    'the area count is not kept',
  );
  assert.match(tile('flights').textContent, /9,400/, 'the worldwide count is');
});

test('at a local view, another layer refreshing never reads a moving layer again', async (t) => {
  let reads = 0;
  const satellites = {
    id: 'satellites',
    name: 'Satellites',
    enabled: true,
    stats: { count: 1, lastUpdate: Date.now() },
    module: {
      getAnalystRecords: () => {
        reads++;
        return [
          { noradId: '1', name: 'SAT', lat: HERE.lat + 0.1, lon: HERE.lon },
        ];
      },
    },
  };
  const flights = flightsOn([flight('near01', HERE.lat + 0.05, HERE.lon)]);
  const { $, cards, notifyLayers } = fixture(t, [satellites, flights]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.match($('.nearby-lists').textContent, /SAT/);
  const before = reads;
  // Flights refresh ten times; the data manager announces each one.
  for (let n = 1; n <= 10; n++) {
    flights.stats = {
      ...flights.stats,
      count: 1,
      lastUpdate: flights.stats.lastUpdate + n,
    };
    notifyLayers();
    await nextTick();
  }
  assert.equal(reads, before, `${reads - before} extra satellite reads`);
  assert.match($('.nearby-lists').textContent, /SAT/, 'still listed');
});

test('Nearby removes a moving satellite within ten seconds of an expensive read', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let now = 2_000_000_000_000;
  let monotonic = 0;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(performance, 'now', () => monotonic);
  let position = HERE;
  const { $, cards } = fixture(t, [
    {
      id: 'satellites',
      enabled: true,
      stats: { count: 1, lastUpdate: 1 },
      module: {
        getAnalystRecords() {
          monotonic += 300;
          return [{ noradId: '1', name: 'SAT', ...position }];
        },
      },
    },
  ]);
  const advance = async (ms) => {
    now += ms;
    t.mock.timers.tick(ms);
    await nextTick();
  };
  // A settled pan can cause the first read between panel pulses.
  await advance(2_100);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const group = () => $('.nearby-lists__layer[data-layer="satellites"]');
  assert.match(group()?.textContent ?? '', /SAT/);

  position = { ...HERE, lat: HERE.lat + 20 };
  // The feed revision stays unchanged while the satellite moves away.
  await advance(1_900);
  assert.ok(group(), 'the early pulse reuses the cached rows');
  await advance(4_000);
  await advance(4_000);
  assert.equal(Boolean(group()), false, 'the departed row is gone by 9.9 s');
});

test('the globe count stays through a refresh and clears for a new enable', async (t) => {
  const flights = flightsOn([], { count: 123 });
  const { $, cards, notifyLayers } = fixture(t, [flights]);
  const total = () =>
    $('.view-context__block[data-layer="flights"] strong')?.textContent;
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  assert.equal(total(), '123');

  flights.stats = { ...flights.stats, count: 0, loading: true };
  notifyLayers();
  await nextTick();
  assert.equal(total(), '123');

  flights.enabled = false;
  notifyLayers();
  await nextTick();
  assert.equal(total(), undefined);
  flights.enabled = true;
  flights.stats = { count: 0, lastUpdate: null, loading: true };
  notifyLayers();
  await nextTick();
  assert.equal(total(), '…');
});

test('globe view: each block lists its three items nearest the centre, on the visible side, and a row opens the card', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([
      flight('near01', 1, 1),
      flight('mid01', 10, 10),
      flight('far01', 40, 40),
      flight('far02', 50, 50),
      flight('back01', 0, 180),
    ]),
  ]);
  cards.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
  await nextTick();
  const rows = [
    ...document.querySelectorAll(
      '.view-context__block[data-layer="flights"] .view-context__block-rows li',
    ),
  ];
  assert.deepEqual(
    rows.map((row) => row.querySelector('.nearby-lists__name').textContent),
    ['NEAR01', 'MID01', 'FAR01'],
    'three, nearest the centre first',
  );
  assert.equal(
    Boolean($('.view-context__block .nearby-lists__badge')),
    false,
    'no Nearest badge',
  );
  // The block's head wears its layer's map sprite, not a glyph.
  const mark = $(
    '.view-context__block[data-layer="flights"] .view-context__block-head .entity-mark',
  );
  assert.equal(mark?.dataset.mark, 'airliner');
  assert.equal(mark.textContent, '');
  const block = () => $('.view-context__block[data-layer="flights"]');
  const count = block().querySelector('strong').textContent;
  const names = () =>
    [...(block()?.querySelectorAll('.nearby-lists__name') ?? [])].map(
      (row) => row.textContent,
    );
  contextSearchOpen.value = true;
  contextSearchText.value = 'nomatchxyz';
  await nextTick();
  assert.deepEqual(names(), [], 'a nonmatching query hides globe rows');
  assert.ok(!block(), 'the unmatched layer group is gone');
  contextSearchText.value = 'far02';
  await nextTick();
  assert.deepEqual(
    names(),
    ['FAR02'],
    'search finds a matching item outside the first three',
  );
  assert.equal(block().querySelector('strong').textContent, count);
  contextSearchText.value = '';
  await nextTick();
  block().querySelectorAll('.view-context__block-rows li button')[1].click();
  await nextTick();
  assert.equal(cards.card?.identity.id, 'mid01');
});

test('a field layer shows one tile with its value at the centre of the view, and nothing under Nearby', async (t) => {
  const asked = [];
  const { $, cards } = fixture(t, [
    flightsOn([flight('near01', 30.28, -97.74)]),
    {
      id: 'wind',
      name: 'Wind',
      enabled: true,
      records: [{ id: 'cell', lat: 30.27, lon: -97.74 }],
      stats: { count: 1, lastUpdate: Date.now() },
      module: {
        getValueAt(lat, lon) {
          asked.push([lat, lon]);
          return { value: '36 km/h from N', detail: 'GFS · 12:00 UTC' };
        },
      },
    },
    {
      id: 'gnss-integrity',
      name: 'GNSS integrity',
      enabled: true,
      stats: { count: 0, lastUpdate: Date.now() },
      module: { getValueAt: () => null },
    },
    {
      id: 'air-quality',
      name: 'Air quality',
      enabled: true,
      stats: { count: 3, lastUpdate: Date.now() },
      module: {
        getValueAt: () => ({ value: null, reason: 'No station within 50 km' }),
      },
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const wind = $('.view-context__tile--value[data-layer="wind"]');
  assert.ok(wind, 'a value tile for the field layer');
  assert.match(wind.querySelector('strong').textContent, /36 km\/h from N/);
  assert.match(wind.textContent, /GFS/);
  assert.deepEqual(
    asked.at(-1),
    [HERE.lat, HERE.lon],
    'read at the centre of the view',
  );
  assert.match(
    $('.view-context__tile--value[data-layer="gnss-integrity"] strong')
      .textContent,
    /—/,
  );
  // A coverage limit says so, rather than "No value".
  const air = $('.view-context__tile--value[data-layer="air-quality"]');
  assert.match(air.querySelector('strong').textContent, /—/);
  assert.match(air.textContent, /No station within 50 km/);
  assert.doesNotMatch(air.textContent, /No value/);
  assert.equal(
    $('.view-context__tile:not(.view-context__tile--value)[data-layer="wind"]'),
    null,
    'no count tile for a field',
  );
  const nearby = $('.nearby-lists')?.textContent || '';
  assert.doesNotMatch(nearby, /Wind|Radar/, 'fields have no Nearby group');
  assert.match(nearby, /NEAR01/);
});

test('a layer holding nothing says why in place of its 0', async (t) => {
  const { $, cards } = fixture(t, [
    {
      id: 'bikeshare',
      name: 'Bikeshare',
      enabled: true,
      records: [],
      stats: {
        count: 0,
        status: 'zoom-in',
        statusMessage: 'Zoom in to see bikes',
      },
    },
    flightsOn([]),
  ]);
  cards.setView({ center: HERE, heightM: 120_000 });
  await nextTick();
  const bikes = $('.view-context__tile[data-layer="bikeshare"] strong');
  assert.ok(bikes);
  assert.match(bikes.textContent, /Zoom in/);
  assert.ok(bikes.classList.contains('view-context__tile-status'));
  assert.match(
    $('.view-context__tile[data-layer="flights"] strong').textContent,
    /^0$/,
    'a plain 0 stays a 0',
  );
});

test("folded, Context's name opens it, as its ◀ button does", async (t) => {
  const { $, pinia, close } = fixture(t, [flightsOn([])]);
  const chrome = usePanelChromeStore(pinia);
  const acted = [];
  const act = chrome.act;
  chrome.act = (...args) => acted.push(args);
  t.after(() => {
    chrome.act = act;
  });
  close();
  await nextTick();
  const name = $('#global-context-panel .context-title-open');
  assert.ok(name, 'folded, the name is a button');
  assert.equal(name.tagName, 'BUTTON');
  name.click();
  assert.deepEqual(acted, [['toggle', 'global-context-panel']]);
});

test('folded, opening Context from its name by keyboard moves focus to the expanded header', async (t) => {
  const { $, pinia, close, open } = fixture(t, [flightsOn([])]);
  const chrome = usePanelChromeStore(pinia);
  const act = chrome.act;
  // As PanelChrome answers it: the panel opens.
  chrome.act = (name, id) => {
    if (name === 'toggle' && id === 'global-context-panel') open();
  };
  t.after(() => {
    chrome.act = act;
  });
  close();
  await nextTick();
  const name = $('#global-context-panel .context-title-open');
  name.focus();
  name.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  await nextTick();
  assert.equal($('#global-context-panel .context-title-open'), null);
  assert.ok(
    document.activeElement?.closest('#global-context-panel .ui-panel__head'),
    `focus is in the header, not on ${document.activeElement?.tagName}`,
  );
});

test('Cameras turned on at globe view adds the inline list without a duplicate layer block', async (t) => {
  const cameras = {
    id: 'cctv',
    name: 'Cameras',
    enabled: false,
    module: {
      getAnalystRecords: undefined,
      camerasNear: () => [{ id: 'cam1', name: 'I-35 @ 12th', km: 1 }],
    },
  };
  const { $, cards, notifyLayers } = fixture(t, [
    flightsOn([flight('near01', 28.1, -80)]),
    cameras,
  ]);
  cards.setView({ center: { lat: 28, lon: -80 }, heightM: 18_000_000 });
  await nextTick();
  assert.equal($('[data-list-card="cctv"]'), null);
  cameras.enabled = true;
  notifyLayers();
  await nextTick();
  assert.match($('[data-list-card="cctv"]').textContent, /I-35 @ 12th/);
  assert.equal($('.view-context__block[data-layer="cctv"]'), null);
});

async function settleWeather(t) {
  await nextTick();
  t.mock.timers.tick(400);
  await turn();
  await nextTick();
}

test('the local time stays on a nearby pan once the same country is confirmed, and clears on failure or a far move', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  // Only the first read answers: later ones fail, as a slow or refused
  // brief would.
  let reads = 0;
  const brief = async () =>
    reads++ === 0
      ? { weather: { timeZone: 'America/Chicago', utcOffsetSeconds: -21600 } }
      : null;
  const { $, point } = fixture(t, [flightsOn([])], { brief });
  point(HERE);
  await settleWeather(t);
  assert.match($('.view-context__region').textContent, /local, \d\d:\d\d UTC/);
  // About 25 km away: the old zone is a hint once the place lookup agrees.
  point({ lat: HERE.lat + 0.2, lon: HERE.lon });
  await nextTick();
  assert.doesNotMatch(
    $('.view-context__region').textContent,
    /local/,
    'UTC until the place lookup confirms the country',
  );
  await turn();
  await nextTick();
  assert.match(
    $('.view-context__region').textContent,
    /local/,
    'kept once the country is confirmed',
  );
  await settleWeather(t);
  // Its own read failed: another spot's zone may be across a border.
  assert.doesNotMatch(
    $('.view-context__region').textContent,
    /local/,
    'dropped when its read fails',
  );
  // London: another zone, so UTC alone until it is read.
  point({ lat: 51.5, lon: -0.12 });
  await nextTick();
  assert.doesNotMatch($('.view-context__region').textContent, /local/);
});

test('with a layer on, zoomed in, the weather block shows the reading the local time came from, with no read of its own', async (t) => {
  const style = document.createElement('style');
  style.textContent = fs.readFileSync(
    new URL('./styles/spot-conditions.css', import.meta.url),
    'utf8',
  );
  document.head.append(style);
  t.after(() => style.remove());
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const reads = [];
  const brief = async (lat, lon) => {
    reads.push([lat, lon]);
    return {
      weather: {
        observedAt: new Date().toISOString(),
        timeZone: 'America/Chicago',
        utcOffsetSeconds: -21600,
        temperatureC: 18.4,
        apparentTemperatureC: 17.2,
        weatherCode: 3,
        windKph: 14.6,
        windDirectionDeg: 180,
        cloudCoverPct: 92,
        visibilityM: 24_000,
        precipitationMm: 0.2,
      },
    };
  };
  const fetched = [];
  const fetchImpl = async (url) => {
    fetched.push(String(url));
    return new Response('', { status: 503 });
  };
  // Denver: a spot no other test reads, so no kept reading answers for it.
  const DENVER = { lat: 39.74, lon: -104.99 };
  const { $, point } = fixture(
    t,
    [flightsOn([flight('near01', DENVER.lat + 0.05, DENVER.lon)])],
    { brief, fetchImpl },
  );
  point(DENVER);
  await nextTick();
  assert.match(
    $('.view-context__weather').textContent,
    /Reading conditions here/,
    'reading until it is in',
  );
  await settleWeather(t);
  const block = $('.view-context__weather');
  assert.match(
    block.querySelector('.spot-conditions__weather-now strong').textContent,
    /18 °C/,
  );
  assert.match(block.textContent, /feels 17°/);
  const factsGrid = block.querySelector('.spot-conditions__weather-facts');
  assert.equal(getComputedStyle(factsGrid).display, 'grid');
  const facts = Object.fromEntries(
    [...factsGrid.querySelectorAll('div')].map((node) => [
      node.querySelector('dt').textContent,
      node.querySelector('dd').textContent,
    ]),
  );
  assert.deepEqual(Object.keys(facts), ['Wind', 'Cloud', 'Visibility', 'Rain']);
  assert.match(facts.Wind, /15 km\/h/);
  assert.equal(facts.Cloud, '92%');
  assert.equal(facts.Visibility, '24 km');
  assert.equal(facts.Rain, '0.2 mm');
  assert.match(
    $('.view-context__region').textContent,
    /local/,
    'the same reading gives the local time',
  );
  // It sits above the radius, under the place and time.
  assert.ok(
    block.compareDocumentPosition($('.view-context__radius')) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert.equal(reads.length, 1, 'one weather read for the time and the block');
  assert.deepEqual(
    fetched.filter((url) => /weather|regional/.test(url)),
    [],
    'no request of its own',
  );
});

test('with a layer on, a spot whose weather cannot be read says so', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { $, point } = fixture(t, [flightsOn([])], { brief: async () => null });
  point({ lat: 59.91, lon: 10.75 });
  await settleWeather(t);
  assert.match(
    $('.view-context__weather').textContent,
    /No weather reading here/,
  );
});

test('switching Street Level cards withdraws only the previous pending request', async (t) => {
  const photo = {
    id: 'mapillary:1',
    name: 'Congress Ave',
    lat: 30.27,
    lon: -97.74,
  };
  const near = { ...photo, id: 'mapillary:2', name: 'Sixth Street' };
  const { cards, pinia } = fixture(t, [
    {
      id: 'street-level',
      name: 'Street Level',
      enabled: true,
      records: [photo, near],
      stats: { count: 2 },
    },
  ]);
  const closed = [];
  useStreetLevelStore(pinia).attach({
    closePhoto: (id, options) =>
      closed.push({ id, pendingOnly: options?.pendingOnly }),
  });
  cards.select({ layerId: 'street-level', id: near.id }, { follow: false });
  await nextTick();
  cards.select({ layerId: 'street-level', id: photo.id }, { follow: false });
  await nextTick();
  assert.deepEqual(closed, [{ id: near.id, pendingOnly: true }]);
});

test('another pick sends a shown photo back to Street Level; only closing its card closes the photo', async (t) => {
  const photo = {
    id: 'mapillary:1',
    name: 'Congress Ave',
    lat: 30.27,
    lon: -97.74,
  };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'street-level',
      name: 'Street Level',
      enabled: true,
      records: [photo],
      stats: { count: 1 },
    },
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  const closed = [];
  useStreetLevelStore(pinia).attach({
    closePhoto: (id, options) =>
      closed.push({ id, pendingOnly: options?.pendingOnly }),
  });
  // A flight picked over the photo's card: only a pending load is cancelled.
  cards.select({ layerId: 'street-level', id: photo.id }, { follow: false });
  await nextTick();
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  assert.equal(cards.card?.layerId, 'flights');
  // A click on open ground lets go of the card the same way.
  cards.select({ layerId: 'street-level', id: photo.id }, { follow: false });
  await nextTick();
  cards.clear();
  await nextTick();
  // The photo card's close button closes the photo.
  cards.select({ layerId: 'street-level', id: photo.id }, { follow: false });
  await nextTick();
  $('#entity-card .entity-card__close').click();
  await nextTick();
  assert.equal(cards.card, null);
  assert.deepEqual(closed, [
    { id: photo.id, pendingOnly: true },
    { id: photo.id, pendingOnly: true },
    { id: photo.id, pendingOnly: false },
  ]);

  const docked = useDockedStore(pinia);
  const identity = { layerId: 'street-level', id: photo.id };
  cards.select(identity, { follow: false });
  await nextTick();
  docked.dock({
    key: cards.card.key,
    kind: 'street',
    title: photo.name,
    identity,
  });
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  assert.equal(docked.view?.identity.id, photo.id);
  assert.equal(closed.length, 3, 'another pick leaves the docked photo alone');

  cards.select(identity, { follow: false });
  await nextTick();
  $('#entity-card .entity-card__close').click();
  await nextTick();
  await nextTick();
  assert.equal(
    docked.view,
    null,
    'the photo card’s Close also dismisses its dock',
  );
  assert.deepEqual(closed.slice(3), [{ id: photo.id, pendingOnly: undefined }]);
});

test("a street-level photo's card moving on to the next image keeps Context's tab; a new pick shows its card", async (t) => {
  const photo = {
    id: 'mapillary:1',
    name: 'Congress Ave',
    lat: 30.27,
    lon: -97.74,
  };
  const next = { ...photo, id: 'mapillary:2', name: 'Sixth Street' };
  const { $, cards, pinia } = fixture(t, [
    {
      id: 'street-level',
      name: 'Street Level',
      enabled: true,
      records: [photo, next],
      stats: { count: 2 },
    },
    flightsOn([flight('test01', 30.3, -97.7)]),
  ]);
  cards.select({ layerId: 'street-level', id: photo.id }, { follow: false });
  await nextTick();
  usePinnedStore(pinia).pin({
    key: cards.card.key,
    identity: cards.card.identity,
    title: photo.name,
    icon: 'streetview',
  });
  await nextTick();
  $('#context-tab-pinned').click();
  cards.advance({ layerId: 'street-level', id: next.id });
  await nextTick();
  assert.equal(
    $('#context-tab-pinned').getAttribute('aria-selected'),
    'true',
    'the walk keeps the tab',
  );
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  assert.equal(
    $('#context-tab-inspect').getAttribute('aria-selected'),
    'true',
    'a new pick shows its card',
  );
});

test('nothing on: up to three suggested layers, and Open shows Data Layers without switching any on', async (t) => {
  const off = (id, name) => ({
    id,
    name,
    enabled: false,
    records: [],
    stats: {},
  });
  const layers = [
    off('satellites', 'Satellites'),
    off('flights', 'Live Flights'),
    off('ais-live-vessels', 'Live Vessels'),
    off('cctv', 'CCTV'),
  ];
  const { $, cards, pinia } = fixture(t, layers);
  const chrome = usePanelChromeStore(pinia);
  const acted = [];
  const act = chrome.act;
  chrome.act = (...args) => acted.push(args);
  t.after(() => {
    chrome.act = act;
  });
  cards.setView({ center: { lat: 28, lon: -80 }, heightM: 18_000_000 });
  await nextTick();
  const named = [
    ...document.querySelectorAll('.view-context__suggest-item'),
  ].map((node) => node.dataset.layer);
  assert.deepEqual(named, ['satellites', 'flights', 'ais-live-vessels']);
  $('.view-context__suggest-open').click();
  assert.deepEqual(acted, [
    ['reveal', 'data-panel'],
    ['toggle', 'data-panel'],
  ]);
  assert.ok(
    layers.every((layer) => !layer.enabled),
    'nothing is switched on',
  );
  // At a city, cameras say nothing about where they are: not suggested.
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.equal($('.view-context__suggest-item[data-layer="cctv"]'), null);
});

test('a custom Data Layers panel opens without applying a filter it cannot clear', async (t) => {
  const { $, cards, pinia } = fixture(
    t,
    [
      { id: 'satellites', name: 'Satellites', enabled: false },
      { id: 'weather-radar', name: 'Radar', enabled: false },
    ],
    { finderControls: false },
  );
  const chrome = usePanelChromeStore(pinia);
  const action = t.mock.method(chrome, 'act');
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  assert.equal($('.view-context__suggest-open'), null);
  $('.view-context__pointer').click();
  assert.deepEqual(
    action.mock.calls.map(({ arguments: args }) => args),
    [
      ['reveal', 'data-panel'],
      ['toggle', 'data-panel'],
    ],
  );
  assert.equal(useLayerFinderStore(pinia).narrowed, false);
});

test('opening Suggested keeps its filter when the phone closes Context', async (t) => {
  const { $, cards, close, pinia } = fixture(
    t,
    [{ id: 'satellites', name: 'Satellites', enabled: false }],
    { useInspector: true },
  );
  cards.setView({ center: HERE, heightM: 20_000_000 });
  await nextTick();
  assert.equal($('.view-context__suggest-item')?.dataset.layer, 'satellites');

  const chrome = usePanelChromeStore(pinia);
  const act = chrome.act;
  t.mock.method(chrome, 'act', (name, panelId) => {
    if (name === 'reveal' && panelId === 'data-panel') close();
    return act(name, panelId);
  });
  $('.view-context__suggest-open').click();

  assert.equal(cards.inspector.shown, false);
  assert.deepEqual(useLayerFinderStore(pinia).selection.picked, ['satellites']);
});

test('the globe breakdown follows a replacement manager with the same layer', async (t) => {
  const original = flightsOn([flight('near01', 30.28, -97.74)]);
  const { $, cards, replaceManager, point } = fixture(t, [original], {
    useInspector: true,
  });
  let labels = ['Airliner', 'Helicopter'];
  t.mock.method(cards, 'breakdown', () => ({
    total: 2,
    splits: [
      { title: 'Type', parts: labels.map((label) => ({ label, count: 1 })) },
    ],
  }));

  point(HERE, 20_000_000);
  await turn();
  const breakdown = () => $('.view-context__bar-key')?.textContent ?? '';
  assert.match(breakdown(), /Airliner/);

  const replacement = flightsOn([flight('near02', 30.28, -97.74)]);
  labels = ['Cargo', 'Glider'];
  replaceManager({
    layers: new Map([
      ['flights', { module: { getAnalystRecords: () => replacement.records } }],
    ]),
    getAll: () => [replacement],
  });
  cards.pulseInspector();
  await turn();

  assert.match(breakdown(), /Cargo/);
  assert.doesNotMatch(breakdown(), /Airliner/);
});

test('the visible Inspector samples metadata once for rows, suggestions and counts', async (t) => {
  let asks = 0;
  const flights = flightsOn([flight('near01', 30.28, -97.74)], {
    scope: 'worldwide',
  });
  const { $, cards, pinia, close, open, replaceManager, notifyLayers } =
    fixture(t, [flights], {
      startOpen: false,
      fetchImpl: async (url) => {
        if (String(url).includes('/api/layer-counts')) asks++;
        return new Response('', { status: 503 });
      },
    });
  const readRows = t.mock.method(cards, 'allLayers');
  const samples = () => readRows.mock.callCount();
  const setHeight = (heightM) => cards.setView({ center: HERE, heightM });
  setHeight(40_000);
  await turn();
  open();
  await nextTick();
  assert.equal(samples(), 1);
  assert.ok($('.view-context [data-layer="flights"]'));
  const counts = useLayerCountsStore(pinia);
  assert.equal(
    counts.state.counts.flights,
    undefined,
    'entry alone does not save a live total',
  );

  setHeight(50_000);
  await nextTick();
  assert.equal(
    samples(),
    1,
    'local camera movement does not resample metadata',
  );
  cards.pulseInspector();
  await nextTick();
  assert.equal(samples(), 2);
  assert.equal(counts.state.counts.flights.count, 1);

  close();
  await nextTick();
  notifyLayers();
  cards.pulseInspector();
  await nextTick();
  assert.equal(samples(), 2, 'hidden refresh does not resample metadata');
  open();
  await nextTick();
  assert.equal(samples(), 3);

  const rows = [{ id: 'satellites', name: 'Satellites', enabled: false }];
  replaceManager({ layers: new Map(), getAll: () => rows });
  setHeight(20_000_000);
  await turn();
  assert.equal(samples(), 4);
  assert.equal($('.view-context__suggest-item')?.dataset.layer, 'satellites');
  assert.equal($('.view-context__suggest-item[data-layer="flights"]'), null);
  assert.equal(asks, 0, 'a category-only sample does not admit counts');
  const list = document.body.appendChild(document.createElement('div'));
  list.id = 'data-toggles';
  const layerPanel = new LayerPanel({
    finder: useLayerFinderStore(pinia),
    getLayers: () =>
      ['flights', 'satellites'].map((id) => ({
        id,
        name: id,
        enabled: false,
        showInTogglePanel: true,
        stats: {},
      })),
    getRowControls: () => null,
    hasRowControls: () => false,
  });
  layerPanel.mount(list);
  t.after(() => layerPanel.destroy());
  $('.view-context__suggest-open').click();
  await nextTick();
  assert.deepEqual(
    [...list.querySelectorAll('.data-toggle-row:not(.is-filtered)')].map(
      (row) => row.dataset.layerId,
    ),
    ['satellites'],
    'Open applies the suggestions from the replacement manager',
  );

  cards.pulseInspector();
  await nextTick();
  assert.equal(
    asks,
    1,
    'the next eligible pulse reads the same rows for admission',
  );
});

test('Inspector rows and count admission update when a manager reuses its array', async (t) => {
  const flightRow = {
    id: 'flights',
    name: 'Live Flights',
    enabled: true,
    stats: { count: 1 },
  };
  const rows = [flightRow];
  let asks = 0;
  const { $, cards, open, replaceManager } = fixture(t, [], {
    startOpen: false,
    fetchImpl: async (url) => {
      if (String(url) === '/api/layer-counts') asks++;
      return new Response('', { status: 503 });
    },
  });
  replaceManager({ layers: new Map(), getAll: () => rows });
  cards.setView({ center: HERE, heightM: 20_000_000 });
  open();
  await nextTick();
  assert.ok($('.view-context__block[data-layer="flights"]'));
  assert.equal(asks, 0);

  flightRow.enabled = false;
  cards.pulseInspector();
  await nextTick();
  assert.ok(!$('.view-context__block[data-layer="flights"]'));
  assert.match($('.view-context__region').textContent, /No layers on/);
  assert.equal(asks, 1);
});

test('phone and Cockpit hide the mounted Inspector while field reads resume once per visible pulse', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  let reads = 0;
  const { $, cards, pinia } = fixture(
    t,
    [
      {
        id: 'wind',
        enabled: true,
        module: { getValueAt: () => ({ value: String(++reads) }) },
      },
    ],
    { useInspector: true },
  );
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const view = $('.view-context');
  const { publishPresence } = useCockpitStore(pinia);
  const { publishPhoneShell } = useDisplayStore(pinia);
  const pulse = cards.inspectorPulse;

  publishPhoneShell({ enabled: true, sheet: 'layers' });
  assert.equal(cards.inspector.shown, false);
  await nextTick();
  const phoneReads = reads;
  cards.setView({
    center: { ...HERE, lat: HERE.lat + 0.3 },
    heightM: 40_000,
  });
  t.mock.timers.tick(4000);
  await nextTick();
  assert.equal(cards.inspectorPulse, pulse);
  assert.equal(reads, phoneReads);
  assert.equal($('.view-context'), view);

  publishPhoneShell({ enabled: true, sheet: 'context' });
  assert.equal(cards.inspector.shown, true);
  publishPresence({ active: true });
  assert.equal(cards.inspector.shown, false);
  await nextTick();
  const cockpitReads = reads;
  t.mock.timers.tick(4000);
  await nextTick();
  assert.equal(cards.inspectorPulse, pulse);
  assert.equal(reads, cockpitReads);
  assert.equal($('.view-context'), view);

  publishPresence({ active: false });
  await nextTick();
  const before = reads;
  t.mock.timers.tick(4000);
  await nextTick();
  assert.equal(cards.inspectorPulse, pulse + 1);
  assert.equal(
    reads - before,
    1,
    'presentation and metadata share the same render',
  );
});

test('unmounting the Context host cancels its count request while the bridge is still connected', async (t) => {
  const reply = Promise.withResolvers();
  let signal;
  const { cards, pinia, unmount } = fixture(t, [], {
    fetchImpl: async (url, options) => {
      if (!String(url).includes('/api/layer-counts'))
        return new Response('', { status: 503 });
      signal = options.signal;
      return reply.promise;
    },
  });
  await nextTick();
  assert.equal(cards.inspector.shown, true);
  assert.equal(signal?.aborted, false);
  unmount();
  assert.deepEqual(cards.inspector, { shown: false, mountId: null });
  await nextTick();
  assert.equal(signal.aborted, true);
  reply.resolve(Response.json({ counts: [{ layerId: 'flights', count: 31 }] }));
  await turn();
  assert.deepEqual(useLayerCountsStore(pinia).state, {
    counts: {},
    lastAttemptAt: null,
  });
});

test('Inspector replies respect Clean View before its visibility observer runs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const weather = Promise.withResolvers();
  const counts = Promise.withResolvers();
  let weatherSignal;
  let countsSignal;
  const { cards, pinia, point } = fixture(t, [], {
    brief: (_lat, _lon, { signal }) => {
      weatherSignal = signal;
      return weather.promise;
    },
    getCounts: ({ signal }) => {
      countsSignal = signal;
      return counts.promise;
    },
  });
  t.after(() => document.body.classList.remove('ui-clean-view'));
  point(HERE);
  await nextTick();
  t.mock.timers.tick(400);
  assert.equal(weatherSignal?.aborted, false);
  assert.equal(countsSignal?.aborted, false);

  weather.resolve({ weather: { temperatureC: 31 } });
  // Let the store's promise wrapper queue the weather owner's continuation.
  await Promise.resolve();
  await Promise.resolve();
  counts.resolve({ counts: [{ layerId: 'flights', count: 31 }] });
  document.body.classList.add('ui-clean-view');
  assert.equal(cards.inspector.shown, true, 'the observer has yet to run');
  await turn();

  assert.deepEqual([weatherSignal.aborted, countsSignal.aborted], [true, true]);
  assert.equal(cards.viewWeather.reading, null);
  assert.deepEqual(useLayerCountsStore(pinia).state, {
    counts: {},
    lastAttemptAt: null,
  });
});

test('hiding or replacing the mounted Inspector cancels its weather and count requests', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  t.after(resetContextLists);
  const countRequests = [];
  const weatherRequests = [];
  const pending = (requests, signal) => {
    const { promise, resolve } = Promise.withResolvers();
    requests.push({ signal, resolve });
    return promise;
  };
  const { $, cards, pinia, point, close, open } = fixture(
    t,
    [{ id: 'directions', enabled: true }],
    {
      brief: (_lat, _lon, { signal }) => pending(weatherRequests, signal),
      fetchImpl: (url, { signal } = {}) =>
        String(url) === '/api/layer-counts'
          ? pending(countRequests, signal)
          : Promise.resolve(new Response('', { status: 503 })),
    },
  );
  const display = useDisplayStore(pinia);
  const cockpit = useCockpitStore(pinia);
  const bhote = useBhoteKoshiPanelStore(pinia);
  let pageVisible = true;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => (pageVisible ? 'visible' : 'hidden'),
  });
  const showPage = (visible) => {
    pageVisible = visible;
    document.dispatchEvent(new Event('visibilitychange'));
  };
  const bhoteRefs = Object.fromEntries(
    [
      'observedStatus',
      'imagerySection',
      'splitReadout',
      'splitInput',
      'timelineLabel',
      'time',
      'progressInput',
      'previousButton',
      'beatIndex',
      'beatTitle',
      'beatMeta',
      'nextButton',
      'playButton',
      'playSceneButton',
      'cinematicButton',
      'storyReplayButton',
      'openSourceButton',
      'corridorButton',
      'caveat',
      'imageryCloudNote',
    ].map((name) => [name, { value: 0, attributes: {} }]),
  );
  const body = document.body;
  const hiddenModes = [
    'ui-clean-view',
    'recording-mode',
    'stories-mode',
    'ui-embed',
  ];
  t.after(() => {
    body.classList.remove(...hiddenModes);
    delete body.dataset.assistantDocked;
    delete document.visibilityState;
  });
  const counts = useLayerCountsStore(pinia);
  t.after(resetContextLists);
  setContextListPresence('weather', { count: 1 });
  const transitions = [
    [
      () => $('#context-tab-lists').click(),
      () => $('#context-tab-inspect').click(),
      true,
    ],
    [
      () => display.publishPhoneShell({ enabled: true, sheet: 'layers' }),
      () => display.publishPhoneShell({ enabled: true, sheet: 'context' }),
    ],
    [
      () => cockpit.publishPresence({ active: true }),
      () => cockpit.publishPresence({ active: false }),
    ],
    [() => showPage(false), () => showPage(true)],
    ...hiddenModes.map((className) => [
      () => body.classList.add(className),
      () => body.classList.remove(className),
    ]),
    [
      () => {
        body.dataset.assistantDocked = 'true';
      },
      () => delete body.dataset.assistantDocked,
    ],
    [
      () =>
        bhote.publish({
          refs: bhoteRefs,
          beforeDate: {},
          afterDate: {},
          reports: [],
        }),
      () => bhote.publish(null),
    ],
    [
      () =>
        assert.ok(
          cards.select({
            layerId: 'local-datacenters',
            id: 'fixture',
            label: 'Fixture site',
          }),
        ),
      () => cards.clear(),
      true,
    ],
    [close, open, true],
  ];
  point(HERE);
  await nextTick();
  for (const [index, [hide, show, unmounts]] of transitions.entries()) {
    t.mock.timers.tick(400);
    await turn();
    assert.equal(countRequests.length, index + 1);
    assert.equal(weatherRequests.length, index + 1);

    const mounted = $('.view-context');
    assert.ok(mounted);
    hide();
    await turn();
    assert.equal(cards.inspector.shown, false);
    assert.equal($('.view-context'), unmounts ? null : mounted);
    const count = countRequests[index];
    const weather = weatherRequests[index];
    assert.equal(count.signal.aborted, true);
    assert.equal(weather.signal.aborted, true);
    count.resolve(
      Response.json({ counts: [{ layerId: 'flights', count: 99 }] }),
    );
    weather.resolve({ weather: { temperatureC: 44 } });
    await turn();
    assert.deepEqual(counts.state.counts, {});
    assert.equal(cards.viewWeather?.reading ?? null, null);
    point({ ...HERE, lat: HERE.lat + (index + 1) * 0.25 });
    t.mock.timers.tick(400);
    await turn();
    assert.equal(countRequests.length, index + 1);
    assert.equal(weatherRequests.length, index + 1);

    show();
    await turn();
  }
  t.mock.timers.tick(400);
  await turn();
  assert.equal(countRequests.length, transitions.length + 1);
  assert.equal(weatherRequests.length, transitions.length + 1);
});

test('a map overlay gets a tile with its state and how fresh it is, at a city and at the globe; Directions, a tool, gets none', async (t) => {
  const { $, cards } = fixture(t, [
    flightsOn([flight('near01', 30.28, -97.74)]),
    {
      id: 'sea-marks',
      name: 'Sea marks',
      enabled: true,
      stats: {},
      module: { getAnalystRecords: undefined },
    },
    {
      id: 'weather-radar',
      name: 'Rain radar',
      enabled: true,
      stats: { lastUpdate: Date.now() - 4 * 60_000 },
      module: { getAnalystRecords: undefined },
    },
    {
      id: 'news',
      name: 'News',
      enabled: true,
      stats: { count: 8, lastUpdate: Date.now() - 4 * 60_000 },
      module: {
        supportsAnalystRecords: false,
        getAnalystRecords: () => [],
      },
    },
    {
      id: 'directions',
      name: 'Directions',
      enabled: true,
      stats: {},
      module: { getAnalystRecords: undefined },
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const marks = $('.view-context__tile--value[data-layer="sea-marks"]');
  assert.ok(marks, 'the overlay has a tile');
  assert.match(marks.textContent, /On the map/);
  const news = document.querySelectorAll(
    '.view-context__tile[data-layer="news"]',
  );
  assert.equal(news.length, 1);
  assert.match(news[0].textContent, /On the map/);
  assert.match(
    $('.view-context__tile--value[data-layer="weather-radar"] strong')
      .textContent,
    /Updated 4 min ago/,
  );
  assert.equal($('[data-layer="directions"]'), null, 'no Directions tile');
  cards.setView({ center: HERE, heightM: 18_000_000 });
  await nextTick();
  assert.equal(
    $('.view-context__block[data-layer="directions"]'),
    null,
    'no Directions block at globe view',
  );
  assert.ok($('.view-context__block[data-layer="flights"]'));
  // At the globe an overlay says its state, never a count.
  assert.match(
    $('.view-context__block[data-layer="weather-radar"] strong').textContent,
    /Updated 4 min ago/,
  );
  assert.match(
    $('.view-context__block[data-layer="sea-marks"] strong').textContent,
    /Live/,
  );
  assert.match(
    $('.view-context__block[data-layer="news"] strong').textContent,
    /Updated 4 min ago/,
  );
});

test('every layer that is on has a tile at every zoom, a reason in place of a 0, and Space Missions counts its list', async (t) => {
  const { $, cards, pinia } = fixture(t, [
    flightsOn([flight('far01', 40.7, -74.0)]),
    {
      id: 'bikeshare',
      name: 'Bike Share',
      enabled: true,
      records: [],
      stats: {
        count: 0,
        status: 'zoom-in',
        statusMessage: 'Zoom in to see bikes',
      },
    },
    // The Space Missions layer's own row, on with its roster.
    {
      id: 'rocket-launches',
      name: 'Space Missions',
      enabled: true,
      records: [{ id: 'm1', name: 'Mission', lat: 30.3, lon: -97.7 }],
      stats: { count: 1, lastUpdate: Date.now() },
    },
  ]);
  const missions = useSpaceMissionsStore(pinia);
  missions.setEnabled(true);
  missions.publish({
    roster: { entries: new Array(23).fill({}) },
    mission: null,
  });
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const missionTiles = (selector) =>
    [...document.querySelectorAll(selector)].filter((el) =>
      ['rocket-launches', 'space-missions'].includes(el.dataset.layer),
    );
  assert.equal(
    missionTiles('.view-context__tile').length,
    1,
    'one Space Missions tile',
  );
  assert.equal(
    Boolean($('.nearby-lists__layer[data-layer="rocket-launches"]')),
    false,
    'no second Nearby group',
  );
  // Nothing of theirs within the radius: still a tile each.
  assert.equal(
    $('.view-context__tile[data-layer="flights"] strong').textContent,
    '0',
  );
  assert.match(
    $('.view-context__tile[data-layer="bikeshare"] strong').textContent,
    /Zoom in to see bikes/,
  );
  assert.equal(
    $('.view-context__tile[data-layer="space-missions"] strong').textContent,
    '23',
  );
  cards.setView({ center: HERE, heightM: 18_000_000 });
  await nextTick();
  assert.match(
    $('.view-context__block[data-layer="bikeshare"] strong').textContent,
    /Zoom in to see bikes/,
    'the same rule at the globe',
  );
  assert.equal(
    $('.view-context__block[data-layer="space-missions"] strong').textContent,
    '23',
  );
  assert.equal(
    missionTiles('.view-context__block').length,
    1,
    'one Space Missions block',
  );
});

test('Space Missions alone is a layer that is on, and its tile carries the mission index feed state', async (t) => {
  const index = {
    id: 'rocket-launches',
    name: 'Space Missions (30d)',
    enabled: true,
    records: [],
    stats: { count: 0, error: 'HTTP 503', lastError: 'HTTP 503' },
  };
  const { $, cards, pinia } = fixture(t, [index]);
  const missions = useSpaceMissionsStore(pinia);
  missions.setEnabled(true);
  // The roster's failure shape: no entries.
  missions.publish({ roster: { count: '—', entries: [] }, mission: null });
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  assert.equal(
    Boolean($('.view-context__tiles--counts')),
    false,
    'not the nothing-on view',
  );
  assert.doesNotMatch($('.view-context').textContent, /No layers on/);
  const tile = $('.view-context__tile[data-layer="space-missions"]');
  assert.ok(tile, 'its one tile');
  assert.doesNotMatch(
    tile.textContent,
    /\b0\b/,
    'never a bare 0 for a failed index',
  );
  assert.notEqual(
    tile.querySelector('.view-context__dot').getAttribute('aria-label'),
    'Live',
  );
  assert.match(
    [...document.querySelectorAll('.view-context__problem')]
      .map((line) => line.textContent)
      .join('\n'),
    /Space Missions \(30d\).*HTTP 503/,
    'the trouble line stays',
  );
  cards.setView({ center: HERE, heightM: 18_000_000 });
  await nextTick();
  assert.doesNotMatch(
    $('.view-context__region').textContent,
    /No layers on/,
    'nor at the globe',
  );
});

test('a stale mission index marks the Space Missions tile stale, keeping its count', async (t) => {
  const index = {
    id: 'rocket-launches',
    name: 'Space Missions (30d)',
    enabled: true,
    records: [],
    stats: { count: 23, stale: true, lastUpdate: Date.now() - 3 * 3600_000 },
  };
  const { $, cards, pinia } = fixture(t, [index]);
  const missions = useSpaceMissionsStore(pinia);
  missions.setEnabled(true);
  missions.publish({
    roster: { entries: new Array(23).fill({}) },
    mission: null,
  });
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const tile = $('.view-context__tile[data-layer="space-missions"]');
  assert.equal(tile.querySelector('strong').textContent, '23');
  assert.equal(
    tile.querySelector('.view-context__dot').getAttribute('aria-label'),
    'Stale',
  );
  assert.ok(
    document.querySelector('.view-context__problem'),
    'its stale line shows',
  );
});

// Reached from Pinned or not, Missions going off while it is the only list
// leaves Context on Inspect, and focus on the Lists tab or in its list moves
// to the Inspect tab.
test('Space Missions turned off while its list shows: Context goes to Inspect and focus to its tab', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  t.after(resetContextLists);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:x',
    kind: 'item',
    title: 'X',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'x' },
  });
  t.after(() => pinned.unpin('flights:x'));
  const missions = useSpaceMissionsStore(pinia);
  for (const focusIn of [
    '#context-tab-lists',
    '[data-mission-roster-focus-continuation]',
    null,
  ]) {
    missions.setEnabled(true);
    missions.publish({
      roster: { entries: new Array(3).fill({}) },
      mission: null,
    });
    await nextTick();
    $('#context-tab-pinned').click();
    await nextTick();
    $('#context-tab-lists').click();
    await nextTick();
    assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
    assert.match($('#context-tab-lists').textContent, /Missions · 3/);
    const outside = document.body.appendChild(document.createElement('button'));
    const focusTarget = focusIn ? $(focusIn) : outside;
    focusTarget.focus();
    assert.equal(document.activeElement === focusTarget, true);
    missions.setEnabled(false);
    await nextTick();
    await nextTick();
    assert.equal($('#context-tab-lists'), null, 'its tab goes');
    assert.equal(
      $('#context-tab-inspect').getAttribute('aria-selected'),
      'true',
      `Inspect, not Pinned (focus in ${focusIn})`,
    );
    if (focusIn)
      assert.equal(
        document.activeElement,
        $('#context-tab-inspect'),
        `focus moves from ${focusIn} to Inspect`,
      );
    else
      assert.equal(
        document.activeElement,
        outside,
        'focus outside Context stays put',
      );
    outside.remove();
  }
});

// With no other tab, the tab row goes with the Lists tab: focus moves to
// Context's body rather than dropping to the page.
test('Space Missions turned off as the only tab: focus moves to Context’s body', async (t) => {
  const { $, pinia } = fixture(t, [flightsOn([])]);
  t.after(resetContextLists);
  const missions = useSpaceMissionsStore(pinia);
  missions.setEnabled(true);
  missions.publish({
    roster: { entries: new Array(3).fill({}) },
    mission: null,
  });
  await nextTick();
  $('#context-tab-lists').click();
  await nextTick();
  const inside = $('[data-mission-roster-focus-continuation]');
  inside.focus();
  assert.equal(document.activeElement === inside, true);
  missions.setEnabled(false);
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-inspect'), null, 'no tab row is left');
  // Compared as a flag: a failing compare of two elements would print both.
  assert.equal(
    document.activeElement === $('#global-context-panel .cyber-panel-body'),
    true,
    'focus is on Context’s body',
  );
});

test('a field layer still loading reads …, not "No value"', async (t) => {
  const { $, cards } = fixture(t, [
    {
      id: 'wind',
      name: 'Wind',
      enabled: true,
      stats: { count: 0, loading: true },
      module: { getValueAt: () => null },
    },
  ]);
  cards.setView({ center: HERE, heightM: 40_000 });
  await nextTick();
  const wind = $('.view-context__tile--value[data-layer="wind"]');
  assert.match(wind.querySelector('strong').textContent, /…/);
  assert.doesNotMatch(wind.textContent, /No value/);
});

test('switching phone sheets pauses the mounted Inspector retry clock', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let reads = 0;
  let elapsed = 0;
  const { $, pinia, point } = fixture(
    t,
    [flightsOn([flight('a1', 30.3, -97.7)])],
    {
      brief: async () => {
        reads++;
        return null;
      },
      weatherClock: { nowMonotonic: () => elapsed },
    },
  );
  const advance = async (ms) => {
    elapsed += ms;
    t.mock.timers.tick(ms);
    await nextTick();
    await turn();
  };
  point(HERE);
  await nextTick();
  await advance(400);
  assert.equal(reads, 1, 'weather is read once the view settles');
  await advance(20_000);
  const mounted = $('.view-context');
  const display = useDisplayStore(pinia);
  display.publishPhoneShell({ enabled: true, sheet: 'layers' });
  await nextTick();
  await advance(60_000);
  assert.equal(
    $('.view-context'),
    mounted,
    'the phone sheet keeps Inspector mounted',
  );
  assert.equal(
    reads,
    1,
    'time on another sheet does not count toward the retry',
  );

  display.publishPhoneShell({ enabled: true, sheet: 'context' });
  await nextTick();
  await advance(36_000);
  await advance(400);
  assert.equal(reads, 1, 'reopening preserves the remaining retry interval');
  await advance(4000);
  await advance(400);
  assert.equal(reads, 2, 'the retry uses the remaining visible time');
});

test('the view stops its refresh ticks while Context shows another tab', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  let reads = 0;
  let elapsed = 0;
  const { $, pinia, point } = fixture(
    t,
    [flightsOn([flight('a1', 30.3, -97.7)])],
    {
      brief: async () => {
        reads++;
        return null;
      },
      weatherClock: { nowMonotonic: () => elapsed },
    },
  );
  const advance = async (ms) => {
    elapsed += ms;
    t.mock.timers.tick(ms);
    await nextTick();
    await turn();
  };
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:a1',
    kind: 'item',
    title: 'A1',
    identity: { layerId: 'flights', id: 'a1' },
  });
  point(HERE);
  await nextTick();
  await advance(400);
  assert.equal(reads, 1, 'the spot weather is read once the view settles');

  $('#context-tab-pinned').click();
  await nextTick();
  assert.equal($('.view-context'), null, 'Pinned unmounts Inspector');
  await advance(16 * 4000);
  await advance(400);
  assert.equal(reads, 1, 'no retry while another tab is shown');

  $('#context-tab-inspect').click();
  await nextTick();
  assert.ok($('.view-context'), 'Inspect remounts Inspector');
  await advance(16 * 4000);
  await advance(400);
  assert.equal(reads, 2, 'the read comes once the view is shown again');
});

test('Radio on with no station picked: the place, then Radio, then Nearby; no worldwide counts or pointer', async (t) => {
  const radio = radioLayer();
  radio.emit({ selected: null });
  const { $, cards } = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  const view = $('.view-context');
  const title = view.querySelector('.view-context__title');
  const stations = view.querySelector('.radio-stations');
  assert.ok(title && stations, 'the place and Radio are one view');
  assert.ok(
    title.compareDocumentPosition(stations) & Node.DOCUMENT_POSITION_FOLLOWING,
    'the place first',
  );
  assert.match(
    $('.radio-stations__idle').textContent,
    /No station selected · pick one to play/,
  );
  assert.equal(
    $('.view-context__tiles--counts'),
    null,
    'no worldwide count tiles while a layer is on',
  );
  assert.doesNotMatch(
    view.textContent,
    /Turn on layers/,
    'no pointer to Data Layers',
  );
  assert.doesNotMatch(view.textContent, /No layers on/);
  // The privacy note is a line under the list, not in the tuner fold.
  assert.equal(
    Boolean(stations.querySelector(':scope > .radio-stations__privacy')),
    true,
  );
  assert.equal(Boolean($('#radio-panel .radio-stations__privacy')), false);
});

test('a sparse station list offers to widen the radius; tag chips show four, then More', async (t) => {
  const radio = radioLayer();
  radio.emit({
    selected: null,
    categories: [
      { id: 'all', label: 'All' },
      ...['news', 'music', 'talk', 'sport', 'jazz', 'rock', 'pop'].map(
        (id) => ({ id, label: id }),
      ),
    ],
  });
  const { $, cards } = fixture(t, [
    { id: 'radio', name: 'Radio', enabled: true, records: [] },
  ]);
  const dm = cards.layerModule;
  cards.layerModule = (id) => (id === 'radio' ? radio : dm(id));
  setContextRadiusKm(250);
  cards.setView({ center: HERE, heightM: 40_000 });
  await new Promise((resolve) => setTimeout(resolve, 1600));
  await nextTick();
  assert.match(
    $('.radio-stations__label').textContent,
    /Only 2 stations within 250 km/,
  );
  $('.radio-stations__widen').click();
  await nextTick();
  assert.ok(contextRadiusKm.value > 250, 'one step wider');
  const chips = [
    ...document.querySelectorAll(
      '.radio-stations__chips button:not(.radio-stations__more)',
    ),
  ];
  assert.equal(chips.length, 4, 'four tags');
  assert.ok($('.radio-stations__more'), 'and More');
});

test('with Context closed, the collapsible sections are already in the page for PanelChrome', async (t) => {
  // PanelChrome finds collapsible panels once, at startup, by their collapse
  // buttons; Context starts closed, so a section that mounts only while it
  // is open would never be registered and its +/- would do nothing.
  const { $, close } = fixture(t, []);
  close();
  await nextTick();
  assert.equal(
    $('#global-context-panel').classList.contains('collapsed'),
    true,
  );
  const targets = [
    ...document.querySelectorAll('.panel-collapse-btn[data-collapse-target]'),
  ].map((button) => button.dataset.collapseTarget);
  // Radio has no collapsible section of its own here: its stations are in
  // Context and its tuner is a fold that moves under the station list.
  for (const id of ['station-panel', 'live-panel']) {
    assert.ok(targets.includes(id), `${id} is there to be registered`);
    // The space station's STATION and LIVE sections follow the lists.
    assert.equal(
      $('#context-lists').compareDocumentPosition(document.getElementById(id)) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      Node.DOCUMENT_POSITION_FOLLOWING,
      `${id} comes after the lists`,
    );
  }
});

test('a pinned aircraft whose layer is off opens flown to where it was, not followed', async (t) => {
  const flights = flightsOn([flight('test01', 30.3, -97.7)]);
  const { cards, followed, flown } = fixture(t, [flights]);
  flights.enabled = false;
  assert.equal(
    cards.open(
      {
        layerId: 'flights',
        id: 'test01',
        label: 'TEST01',
        lat: 30.3,
        lon: -97.7,
      },
      { fromPin: true },
    ),
    true,
  );
  await nextTick();
  assert.deepEqual(followed, [], 'nothing to follow with the layer off');
  assert.deepEqual(flown, ['flights:test01'], 'flown to its last position');
  // With the layer on, the same pin is followed as before.
  cards.clear();
  flights.enabled = true;
  cards.open({
    layerId: 'flights',
    id: 'test01',
    label: 'TEST01',
    lat: 30.3,
    lon: -97.7,
  });
  await nextTick();
  assert.deepEqual(followed, ['flights:test01']);
});

test('whether a layer is off is read again when a layer changes, in views that stay open', async (t) => {
  const cameras = { id: 'cctv', name: 'Cameras', enabled: false, records: [] };
  const { cards, notifyLayers } = fixture(t, [cameras]);
  const off = computed(() => cards.layerOff('cctv'));
  assert.equal(off.value, true);
  cameras.enabled = true;
  notifyLayers();
  assert.equal(
    off.value,
    false,
    'a preview kept open sees Cameras come back on',
  );
});

test('a docked street-level photo that another item replaces closes, unless its card shows it', async (t) => {
  const { cards, pinia } = fixture(t, [
    {
      id: 'street-level',
      name: 'Street Level',
      enabled: true,
      records: [
        { id: 'mapillary:1', name: 'Congress Ave', lat: 30.27, lon: -97.74 },
      ],
      stats: { count: 1 },
    },
    flightsOn([flight('near01', 30.28, -97.74)]),
  ]);
  const streetLevel = useStreetLevelStore(pinia);
  const closed = [];
  const act = streetLevel.act;
  streetLevel.act = (name, ...args) =>
    name === 'closePhoto' ? closed.push(args[0]) : act(name, ...args);
  t.after(() => {
    streetLevel.act = act;
  });
  const docked = useDockedStore(pinia);
  const photo = {
    key: 'street-level:mapillary:1',
    kind: 'street',
    title: 'Congress Ave',
    identity: { layerId: 'street-level', id: 'mapillary:1' },
  };
  // Its card showing: replacing the dock leaves the photo open.
  cards.select(
    { layerId: 'street-level', id: 'mapillary:1' },
    { follow: false },
  );
  await nextTick();
  docked.dock({ ...photo, key: cards.card.key });
  await nextTick();
  docked.dock({
    key: 'cctv:cam1',
    kind: 'camera',
    title: 'Cam',
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  await nextTick();
  assert.deepEqual(closed, []);
  // Its card gone: the replaced photo closes with the dock.
  cards.select({ layerId: 'flights', id: 'near01' }, { follow: false });
  await nextTick();
  closed.length = 0;
  docked.dock({ ...photo, key: 'street-level:mapillary:1' });
  await nextTick();
  docked.dock({
    key: 'cctv:cam1',
    kind: 'camera',
    title: 'Cam',
    identity: { layerId: 'cctv', id: 'cam1' },
  });
  await nextTick();
  assert.deepEqual(closed, ['mapillary:1']);
});

test('a dock replacement keeps the original card, dock slot, and one busy announcement', async (t) => {
  const a = {
    id: 'mapillary:A',
    name: 'Congress Ave',
    lat: HERE.lat,
    lon: HERE.lon,
  };
  const { $, cards, pinia } = fixture(t, [
    { id: 'street-level', name: 'Street Level', enabled: true, records: [a] },
  ]);
  const streetLevel = useStreetLevelStore(pinia);
  const docked = useDockedStore(pinia);
  const publish = (loading) =>
    streetLevel.publish({
      enabled: true,
      dockPhotoLoading: loading,
      viewer: { open: true, photo: { id: a.id }, renderMode: 'letterbox' },
    });
  let cancelled = false;
  streetLevel.attach({
    cancelDockedPhoto: () => {
      cancelled = true;
      publish(false);
    },
  });
  cards.select({ layerId: 'street-level', id: a.id }, { follow: false });
  docked.dock({
    key: 'street-level:mapillary:A',
    kind: 'street',
    title: a.name,
    identity: { layerId: 'street-level', id: a.id },
  });
  publish(false);
  await nextTick();
  await nextTick();
  const frame = $('.docked-view__frame');
  const holder = $('#sl-docked-slot');
  publish(true);
  await nextTick();
  assert.equal(cards.card.identity.id, a.id);
  assert.equal(frame.getAttribute('aria-busy'), 'true');
  assert.match($('.docked-view__status').textContent, /Loading photo/);
  assert.equal(
    $('#sl-docked-slot'),
    holder,
    'the host holds its existing place in the dock',
  );
  assert.equal($('#sl-viewer-wrap').parentElement, holder);
  $('.docked-view__cancel-photo').click();
  await nextTick();
  assert.equal(cancelled, true);
  assert.equal(cards.card.identity.id, a.id);
  assert.equal(frame.hasAttribute('aria-busy'), false);
  assert.equal($('.docked-view__status').textContent, '');
  assert.equal($('#sl-docked-slot'), holder);
});

test('the dock says when a replacement photo did not load or a pick waits on the restore', async (t) => {
  const a = {
    id: 'mapillary:A',
    name: 'Congress Ave',
    lat: HERE.lat,
    lon: HERE.lon,
  };
  const { $, cards, pinia } = fixture(t, [
    { id: 'street-level', name: 'Street Level', enabled: true, records: [a] },
  ]);
  const streetLevel = useStreetLevelStore(pinia);
  const docked = useDockedStore(pinia);
  const publish = (state) =>
    streetLevel.publish({
      enabled: true,
      dockPhotoLoading: false,
      dockPhotoNotice: null,
      viewer: { open: true, photo: { id: a.id }, renderMode: 'letterbox' },
      ...state,
    });
  cards.select({ layerId: 'street-level', id: a.id }, { follow: false });
  docked.dock({
    key: 'street-level:mapillary:A',
    kind: 'street',
    title: a.name,
    identity: { layerId: 'street-level', id: a.id },
  });
  publish();
  await nextTick();
  const status = $('.docked-view__status');
  assert.equal(status.getAttribute('role'), 'status');
  assert.equal(status.textContent, '');
  // A previous attempt to transfer the dock to a hidden phone sheet failed.
  document.body.classList.add('mobile-shell');
  t.after(() => document.body.classList.remove('mobile-shell'));
  $('.docked-view button[title="Open in Context"]').click();
  await turn();
  assert.equal(
    $('.docked-view__notice').textContent,
    'Could not open this in Context',
  );
  publish({ dockPhotoLoading: true, dockPhotoNotice: 'restoring' });
  await nextTick();
  assert.equal(status.textContent, 'Still restoring the photo');
  publish({ dockPhotoNotice: 'failed' });
  await nextTick();
  assert.equal(status.textContent, 'Could not load that photo');
  const notice = $('.docked-view__notice');
  assert.equal(notice.textContent, status.textContent);
  assert.equal(notice.getAttribute('aria-hidden'), 'true');
  publish();
  await nextTick();
  assert.equal(status.textContent, '', 'the word goes when the layer drops it');
  assert.equal(
    $('.docked-view__notice').textContent,
    'Could not open this in Context',
  );
});

for (const still of [null, 'https://example.org/original-photo.jpg']) {
  const fallback = still ? 'with a still that cannot load' : 'without a still';
  test(`the dock reports an unavailable original photo ${fallback}`, async (t) => {
    const id = 'mapillary:A';
    const point = { lat: HERE.lat, lon: HERE.lon };
    const a = { id, name: 'Congress Ave', ...point };
    const identity = { layerId: 'street-level', id, ...point };
    const { $, cards, pinia, flown } = fixture(t, [
      {
        id: 'street-level',
        name: 'Street Level',
        enabled: true,
        records: [a],
        module: { photo: () => ({ ...a, still }) },
      },
    ]);
    const streetLevel = useStreetLevelStore(pinia);
    const docked = useDockedStore(pinia);
    const publish = (state = {}) =>
      streetLevel.publish({
        enabled: true,
        viewer: { open: true, photo: { id }, renderMode: 'letterbox' },
        ...state,
      });
    cards.select(identity, { follow: false });
    docked.dock({
      key: cards.card.key,
      kind: 'street',
      title: a.name,
      identity,
    });
    const sourceCard = cards.card;
    const dock = docked.view;
    const alert = () => $('.docked-view__frame > [role="alert"]');
    publish({ dockPhotoLoading: true, dockPhotoRestoring: true });
    await nextTick();
    assert.equal($('.docked-view__frame').getAttribute('aria-busy'), 'true');
    assert.equal(
      $('.docked-view__status').textContent,
      'Still restoring the photo',
    );
    assert.equal(alert(), null);

    publish({ dockPhotoUnavailable: true, dockPhotoNotice: 'failed' });
    await nextTick();
    const frame = $('.docked-view__frame');
    assert.equal(frame.hasAttribute('aria-busy'), false);
    assert.equal($('.docked-view__loading'), null);
    if (still) {
      const image = frame.querySelector('img');
      assert.equal(
        image.getAttribute('src'),
        still,
        'the original still is tried',
      );
      assert.equal(alert(), null, 'a retained still can serve as the fallback');
      assert.equal(
        $('.docked-view__notice').textContent,
        'Could not load that photo',
      );
      image.dispatchEvent(new Event('error'));
      await nextTick();
      assert.equal(Boolean(frame.querySelector('img')), false);
    }

    assert.equal(alert()?.textContent, 'Image could not be opened');
    assert.equal(frame.querySelectorAll('[role="alert"]').length, 1);
    assert.equal(
      $('.docked-view__status').textContent,
      '',
      'no duplicate live status',
    );
    assert.equal(docked.view, dock);
    assert.equal(cards.card, sourceCard);
    assert.deepEqual(flown, []);

    publish({ dockPhotoUnavailable: true });
    await nextTick();
    assert.equal(
      alert()?.textContent,
      'Image could not be opened',
      'the error survives the transient notice',
    );

    publish();
    await nextTick();
    assert.equal(
      alert(),
      null,
      'the alert clears when the original becomes available',
    );
    assert.ok($('#sl-docked-slot'));
  });
}

test('focus on Open or Close moves to Cancel while a docked photo loads, then back to Close', async (t) => {
  const a = {
    id: 'mapillary:A',
    name: 'Congress Ave',
    lat: HERE.lat,
    lon: HERE.lon,
  };
  const { $, cards, pinia } = fixture(t, [
    { id: 'street-level', name: 'Street Level', enabled: true, records: [a] },
  ]);
  const streetLevel = useStreetLevelStore(pinia);
  const docked = useDockedStore(pinia);
  const publish = (loading) =>
    streetLevel.publish({
      enabled: true,
      dockPhotoLoading: loading,
      viewer: { open: true, photo: { id: a.id }, renderMode: 'letterbox' },
    });
  cards.select({ layerId: 'street-level', id: a.id }, { follow: false });
  docked.dock({
    key: 'street-level:mapillary:A',
    kind: 'street',
    title: a.name,
    identity: { layerId: 'street-level', id: a.id },
  });
  publish(false);
  await nextTick();
  const [open, close] = document.querySelectorAll('.docked-view__head button');
  open.focus();
  publish(true);
  await nextTick();
  await nextTick();
  assert.equal(
    document.activeElement,
    $('.docked-view__cancel-photo'),
    'Open was disabled: Cancel takes focus',
  );
  publish(false);
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, close, 'Cancel went: Close takes focus');
  close.focus();
  publish(true);
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, $('.docked-view__cancel-photo'));
  // Focus elsewhere is left where it is.
  const elsewhere = document.body.appendChild(document.createElement('button'));
  t.after(() => elsewhere.remove());
  elsewhere.focus();
  publish(false);
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, elsewhere);
});

test('while the docked photo restores, Cancel goes, the dock says so, and focus waits on the frame', async (t) => {
  const a = {
    id: 'mapillary:A',
    name: 'Congress Ave',
    lat: HERE.lat,
    lon: HERE.lon,
  };
  const { $, cards, pinia } = fixture(t, [
    { id: 'street-level', name: 'Street Level', enabled: true, records: [a] },
  ]);
  const streetLevel = useStreetLevelStore(pinia);
  const docked = useDockedStore(pinia);
  const publish = (state = {}) =>
    streetLevel.publish({
      enabled: true,
      dockPhotoLoading: false,
      dockPhotoRestoring: false,
      viewer: { open: true, photo: { id: a.id }, renderMode: 'letterbox' },
      ...state,
    });
  cards.select({ layerId: 'street-level', id: a.id }, { follow: false });
  docked.dock({
    key: 'street-level:mapillary:A',
    kind: 'street',
    title: a.name,
    identity: { layerId: 'street-level', id: a.id },
  });
  publish();
  await nextTick();
  const [, close] = document.querySelectorAll('.docked-view__head button');
  const frame = $('.docked-view__frame');
  const slot = $('#sl-docked-slot');
  const step = slot.appendChild(document.createElement('button'));
  step.focus();
  assert.equal(slot.hasAttribute('inert'), false);
  publish({ dockPhotoLoading: true });
  await nextTick();
  await nextTick();
  assert.equal(slot.hasAttribute('inert'), true);
  assert.equal(document.activeElement, $('.docked-view__cancel-photo'));
  $('.docked-view__cancel-photo').focus();
  publish({ dockPhotoLoading: true, dockPhotoRestoring: true });
  await nextTick();
  await nextTick();
  assert.equal($('.docked-view__cancel-photo'), null, 'nothing left to cancel');
  assert.equal(
    $('.docked-view__status').textContent,
    'Still restoring the photo',
  );
  assert.match(
    $('.docked-view__loading').textContent,
    /Still restoring the photo/,
  );
  assert.equal(close.disabled, true);
  assert.equal(frame.getAttribute('aria-busy'), 'true');
  assert.equal(
    document.activeElement,
    frame,
    'focus is not stranded on a removed button',
  );
  publish();
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, close, 'restored: Close takes focus');
  assert.equal(slot.hasAttribute('inert'), false);
  assert.equal(frame.hasAttribute('tabindex'), false);
  // Focus on Close as a restore begins also waits on the frame.
  publish({ dockPhotoLoading: true, dockPhotoRestoring: true });
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement, frame);
});

test('Fly to held by Tracking or Cockpit says so on the card for a few seconds', async (t) => {
  const { $, cards } = fixture(t, [
    {
      id: 'earthquakes',
      name: 'Earthquakes',
      enabled: true,
      records: [
        { id: 'q1', usgsId: 'q1', magnitude: 4.2, lat: 30.2, lon: -97.6 },
      ],
    },
  ]);
  cards.select({ layerId: 'earthquakes', id: 'q1' }, { fly: false });
  await nextTick();
  const note = () => $('#entity-card .entity-card__fly-note');
  const flyButton = () =>
    [
      ...document.querySelectorAll(
        '#entity-card .entity-card__action-row button',
      ),
    ].find((button) => /Fly to/.test(button.textContent));
  assert.equal(note().getAttribute('role'), 'status');
  assert.equal(note().textContent, '');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let answer = 'tracking-holds-view';
  cards.flyTo = () => answer;
  flyButton().click();
  await nextTick();
  assert.equal(note().textContent, 'Tracking holds the view');
  answer = 'cockpit-active';
  flyButton().click();
  await nextTick();
  assert.equal(note().textContent, 'Cockpit is active');
  t.mock.timers.tick(4000);
  await nextTick();
  assert.equal(note().textContent, '', 'it goes by itself');
  flyButton().click();
  await nextTick();
  answer = true;
  flyButton().click();
  await nextTick();
  assert.equal(note().textContent, '', 'a flight that goes clears it');
});

test(
  'a focused Nearby row that drops out hands focus to the row in its place',
  { timeout: 10_000 },
  async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const flights = flightsOn([
      flight('near01', 30.28, -97.74),
      flight('near02', 30.29, -97.74),
      flight('near03', 30.3, -97.74),
    ]);
    const { $, cards } = fixture(t, [flights]);
    cards.setView({ center: HERE, heightM: 40_000 });
    await nextTick();
    const first = '.view-context .nearby-lists [data-row-key="flights:near01"]';
    const row = $(first);
    assert.ok(row, 'the nearest row shows');
    row.focus();
    assert.equal(document.activeElement?.dataset.rowKey, 'flights:near01');
    flights.records = flights.records.slice(1);
    flights.stats = {
      ...flights.stats,
      count: flights.records.length,
      lastUpdate: flights.stats.lastUpdate + 1,
    };
    t.mock.timers.tick(4000);
    await nextTick();
    await nextTick();
    assert.equal(Boolean($(first)), false, 'the row went');
    assert.equal(
      document.activeElement?.dataset.rowKey,
      'flights:near02',
      'focus moved to the row now first',
    );
  },
);

test('backgrounding pauses docked street playback and cockpit rendering', async (t) => {
  const priorHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
  const setHidden = (hidden) => {
    Object.defineProperty(document, 'hidden', {
      value: hidden,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  setHidden(false);
  t.after(() => {
    if (priorHidden) Object.defineProperty(document, 'hidden', priorHidden);
    else delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const active = [];
  const { $, cards, pinia } = fixture(
    t,
    [
      {
        id: 'street-level',
        name: 'Street Level',
        enabled: true,
        records: [
          { id: 'mapillary:1', name: 'Congress Ave', lat: 30.27, lon: -97.74 },
        ],
        stats: { count: 1 },
      },
      flightsOn([flight('near01', 30.28, -97.74)]),
    ],
    {
      previews: {
        cockpit: () => ({
          setActive: (value) => active.push(value),
          update() {},
          destroy() {},
        }),
      },
    },
  );
  const streetLevel = useStreetLevelStore(pinia);
  const actions = [];
  streetLevel.act = (name) => actions.push(name);
  const docked = useDockedStore(pinia);
  cards.select(
    { layerId: 'street-level', id: 'mapillary:1' },
    { follow: false },
  );
  await nextTick();
  docked.dock({
    key: cards.card.key,
    kind: 'street',
    title: 'Congress Ave',
    identity: cards.card.identity,
  });
  await nextTick();
  assert.ok(
    $('.entity-hero--docked'),
    'the selected card hands its photo to the dock',
  );
  docked.setStowed(true);
  await nextTick();
  assert.ok(
    actions.includes('stopPlayback'),
    'the stowed sequence stops even with its own card selected',
  );
  docked.setStowed(false);
  await nextTick();
  actions.length = 0;
  setHidden(true);
  await nextTick();
  assert.ok(actions.includes('stopPlayback'), 'a hidden street sequence stops');
  setHidden(false);
  await nextTick();
  docked.dock({
    key: 'flights:near01',
    kind: 'cockpit',
    title: 'NEAR01',
    identity: { layerId: 'flights', id: 'near01' },
  });
  await nextTick();
  assert.equal(active.at(-1), true, 'the visible cockpit renders');
  setHidden(true);
  await nextTick();
  assert.equal(active.at(-1), false, 'the background cockpit is inactive');
  setHidden(false);
  await nextTick();
  assert.equal(active.at(-1), true, 'the cockpit resumes when visible');
});

test('the card store hears layer changes from a data manager that arrives after it connects, and Radio attaches', async (t) => {
  // The app connects the store before its data manager exists.
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  let manager = null;
  cards.connect({ dataManager: () => manager });
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp({
    setup() {
      const { ui } = useRadioLayer();
      return () =>
        h('p', { id: 'radio-probe' }, ui.value?.enabled ? 'on' : 'off');
    },
  }).use(pinia);
  app.mount(host);
  t.after(() => {
    app.unmount();
    host.remove();
    cards.connect(null);
  });
  assert.equal(document.querySelector('#radio-probe').textContent, 'off');
  const listeners = new Set();
  const radio = {
    id: 'radio',
    name: 'Radio',
    enabled: true,
    module: { subscribe: (fn) => (fn({ enabled: true }), () => {}) },
  };
  manager = {
    layers: new Map([['radio', radio]]),
    isEnabled: () => true,
    getAll: () => [radio],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  // Context reads the layers on its own tick; that read starts the listening.
  cards.allLayers();
  await Promise.resolve();
  await nextTick();
  assert.equal(listeners.size, 1, 'listening once the manager is there');
  assert.equal(
    document.querySelector('#radio-probe').textContent,
    'on',
    'Radio attaches without a layer change',
  );
  const before = cards.layerRevision;
  listeners.forEach((listener) =>
    listener({
      type: 'visibility',
      layerId: 'news',
      enabled: true,
      origin: 'user',
    }),
  );
  assert.ok(cards.layerRevision > before, 'a layer change is heard');
  assert.equal(cards.lastDirectOn?.layerId, 'news');
  cards.allLayers();
  assert.equal(listeners.size, 1, 'listened to once');
});
