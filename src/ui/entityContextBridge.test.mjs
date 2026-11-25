import '../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, ref, watch } from 'vue';
import { installEntityContext } from './entityContextBridge.js';
import { createLayerCounts } from './layerCounts.js';
import { NavigationController } from './navigationController.js';
import { announcePlacePick, installPlacePick } from './placePick.js';
import { _setAirportsFetchForTest } from '../data/airports.js';
import { useCockpitStore } from './stores/cockpit.js';
import { useEntityCardStore } from './stores/entityCard.js';
import { useLayerCountsStore } from './stores/layerCounts.js';
import { useOmnibarStore } from './stores/omnibar.js';
import { useDockedStore } from './stores/docked.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { useSpaceMissionsStore } from './stores/spaceMissions.js';
import {
  STREET_LEVEL_PHOTO_EVENT,
  STREET_LEVEL_PHOTO_REQUEST_EVENT,
} from './streetLevelEvents.js';
import { fakeInput } from '../input/testDoubles.mjs';
import { fakeCameraPort } from '../testSupport/fakeCameraPort.mjs';
import { bindRenderer } from '../render/rendererOf.js';
import {
  registerPickOwner,
  setClickCardHitTest,
  unregisterPickOwner,
} from '../data/pickRegistry.js';

// The card or label painted on top takes the click: Context names nothing
// under it, exact or nearby, an acting owner's item or a passive one, and
// keeps its own card. On open map it names what the click found.
test('Context names nothing under a card painted on top, and keeps its card', (t) => {
  const previous = globalThis.matchMedia;
  globalThis.matchMedia = () => ({ matches: true });
  t.after(() => {
    if (previous) globalThis.matchMedia = previous;
    else delete globalThis.matchMedia;
  });
  const fire = { set: 'test-fires:1', id: 'fire:1' };
  const plane = { set: 'test-planes:1', id: 'plane:1' };
  const route = { set: 'test-route:1', id: 'route:line' };
  registerPickOwner('test-fires', (id) => id === fire.id);
  registerPickOwner('test-planes', (id) => id === plane.id);
  registerPickOwner('street-level', (id) => id.startsWith('kv:line:'));
  registerPickOwner('test-route', (id) => id.startsWith('route:'));
  let cardOnTop = false;
  // The card on top at a click, as the host answers the pick registry.
  setClickCardHitTest(() =>
    cardOnTop ? { sourceId: 'earthquake-card', entryId: 'q' } : null,
  );
  t.after(() => {
    setClickCardHitTest(null);
    unregisterPickOwner('test-fires');
    unregisterPickOwner('test-planes');
    unregisterPickOwner('test-route');
    unregisterPickOwner('street-level');
  });
  let exact = null;
  let near = null;
  const viewer = {
    scene: {
      pick: () => (exact ? { id: exact } : null),
      drillPick: () => (near ? [{ id: near }] : []),
    },
  };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const dataManager = {
    isEnabled: () => true,
    layers: new Map(),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const store = useEntityCardStore(pinia);
  const named = [];
  let clears = 0;
  store.select = (identity) => named.push(identity.id);
  store.clear = () => clears++;
  const tap = (hitExact, hitNear) => {
    exact = hitExact;
    near = hitNear;
    named.length = 0;
    input.click();
    return [...named];
  };
  assert.deepEqual(tap(null, fire), ['fire:1'], 'open map: a near fire');
  assert.deepEqual(tap(route, null), ['route:line'], 'open map: a route');
  assert.deepEqual(
    tap({ set: 'street-level:lines', id: 'kv:line:1' }, null),
    [],
    'a Street Level line must not open a card before the lookup finishes',
  );
  // With Context open, the line's lookup starts, then its photo opens.
  const chrome = usePanelChromeStore(pinia);
  chrome.publish(chrome.connect({}), 'global-context-panel', {
    collapsed: false,
  });
  document.dispatchEvent(
    new CustomEvent(STREET_LEVEL_PHOTO_REQUEST_EVENT, {
      detail: { requestId: 1 },
    }),
  );
  document.dispatchEvent(
    new CustomEvent(STREET_LEVEL_PHOTO_EVENT, {
      detail: { id: 'kartaview:42', lat: 38, lon: -121, requestId: 1 },
    }),
  );
  assert.deepEqual(
    named,
    ['kartaview:42'],
    'the resolved photo opens its card',
  );
  cardOnTop = true;
  assert.deepEqual(tap(null, fire), [], 'under a card: a near fire');
  assert.deepEqual(tap(fire, fire), [], 'under a card: an exact fire');
  assert.deepEqual(tap(plane, plane), [], 'under a card: an aircraft');
  assert.deepEqual(tap(route, null), [], 'under a card: a route');
  const cleared = clears;
  tap(null, null);
  assert.equal(clears, cleared, 'a card over open map is not open map');
});

// The card offers the orbital view only for a satellite that can be ridden;
// debris (a rocket body) leads with Follow instead. Aircraft keep the cockpit.
test('the satellite card offers and enters orbit only for its eligible subject', async (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const rideable = new Set(['25544']);
  const dataManager = {
    isEnabled: () => true,
    layers: new Map([
      [
        'satellites',
        { module: { cockpitEnterable: (id) => rideable.has(String(id)) } },
      ],
    ]),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const store = useEntityCardStore(pinia);
  const satellite = (id) => ({
    key: `satellites:${id}`,
    layerId: 'satellites',
    kind: 'satellite',
    identity: { layerId: 'satellites', id, record: { noradId: id } },
  });
  store.card = satellite('25544');
  assert.equal(store.canCockpit(), false, 'no action runner yet');
  useOmnibarStore(pinia).connectRunner(async () => ({ ok: true }));
  assert.equal(store.canCockpit(), true, 'the ISS can be ridden');
  assert.equal(store.canFollow(), true);
  store.card = satellite('26070');
  assert.equal(store.canCockpit(), false, 'debris cannot');
  assert.equal(store.canFollow(), true, 'debris is still followed');
  store.card = {
    key: 'flights:abc123',
    layerId: 'flights',
    kind: 'aircraft',
    identity: { layerId: 'flights', id: 'abc123' },
  };
  assert.equal(store.canCockpit(), true, 'an aircraft keeps its cockpit');

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cockpit = useCockpitStore(pinia);
  const entered = t.mock.fn();
  cockpit.connect({ enter: entered });
  const card = satellite('25544');
  store.card = card;
  const ready = (id) =>
    cockpit.publishPresence({
      entryAvailable: true,
      entryKind: 'satellite',
      entryId: id,
    });
  const poll = async () => {
    t.mock.timers.tick(100);
    await setImmediate();
  };

  ready('99999');
  store.cockpit();
  await setImmediate();
  await poll();
  assert.equal(entered.mock.callCount(), 0, 'another satellite is ready');
  ready('25544');
  await poll();
  assert.deepEqual(
    entered.mock.calls.map((call) => call.arguments),
    [[card.identity]],
  );

  ready('99999');
  store.cockpit();
  await setImmediate();
  store.card = satellite('26070');
  ready('25544');
  await poll();
  assert.equal(entered.mock.callCount(), 1, 'a new pick cancels the wait');
});

// A vessel, a train or a bus offers its own view (Bridge or Cab view) only
// while the Cockpit says that very item's layer can be entered; static items
// never do.
test('a moving item offers its own view only for the exact entry candidate', (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const dataManager = {
    isEnabled: () => true,
    layers: new Map(),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const store = useEntityCardStore(pinia);
  const cockpit = useCockpitStore(pinia);
  const item = (layerId, id) => ({
    key: `${layerId}:${id}`,
    layerId,
    kind: 'item',
    identity: { layerId, id },
  });
  store.card = item('ais-live-vessels', '366999000');
  cockpit.publishPresence({ entryAvailable: false, entryLayerId: null });
  assert.equal(
    store.canCockpit(),
    false,
    'not offered until it can be entered',
  );
  cockpit.publishPresence({
    entryAvailable: true,
    entryLayerId: 'ais-live-vessels',
    entryId: '366999000',
  });
  assert.equal(store.canCockpit(), true, 'the bridge view is offered');
  const asked = [];
  const identity = store.card.identity;
  cockpit.connect({ enter: (subject) => asked.push(subject) });
  store.cockpit();
  assert.deepEqual(asked, [identity], 'it asks Cockpit to enter this subject');
  store.card = item('ais-live-vessels', '366999001');
  assert.equal(
    store.canCockpit(),
    false,
    'another vessel in the same layer is not this item',
  );
  store.cockpit();
  assert.deepEqual(asked, [identity], 'the other vessel cannot request entry');
  store.card = item('rail', 'train-9');
  assert.equal(store.canCockpit(), false, 'another layer: not this item');
  cockpit.publishPresence({
    entryAvailable: true,
    entryLayerId: 'rail',
    entryId: 'train-9',
  });
  assert.equal(store.canCockpit(), true, 'the cab view is offered');
  store.card = item('fires', 'f1');
  assert.equal(store.canCockpit(), false, 'a fire never is');
});

// The card says Following only while the camera follows the card's own item,
// whoever started or ended the follow: taking hold shows at once, letting go
// once the follow has stayed off for a moment, and following something else
// is not following the card.
test("the card's Following matches what the camera follows", (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const { port } = fakeCameraPort();
  const listeners = new Set();
  let followed = null;
  const camera = {
    ...port,
    get followed() {
      return followed;
    },
    follow(target) {
      followed = target;
      for (const cb of [...listeners]) cb();
    },
    on(event, cb, options) {
      if (event !== 'followChanged') return port.on(event, cb, options);
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  const unbind = bindRenderer(viewer, { camera });
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const dataManager = {
    isEnabled: () => true,
    layers: new Map(),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
    unbind();
  });
  const store = useEntityCardStore(pinia);
  store.card = {
    key: 'flights:abc123',
    layerId: 'flights',
    identity: { id: 'abc123' },
    title: 'UPS668',
  };
  assert.equal(store.isFollowing(), false, 'not before the camera follows');

  camera.follow({ key: 'flights:abc123' });
  assert.equal(store.isFollowing(), true, 'the camera follows the card');

  camera.follow(null);
  assert.equal(store.isFollowing(), true, 'a moment to take hold again');
  t.mock.timers.tick(300);
  assert.equal(store.isFollowing(), false, 'the camera let go');

  camera.follow({ key: 'flights:abc123' });
  camera.follow({ key: 'flights:other9' });
  t.mock.timers.tick(300);
  assert.equal(store.isFollowing(), false, 'following another plane');
});

// A vessel's layer announces its selection with the context store's id; the
// card names it by the vessel's own id, as a click on it does.
test('a vessel announced by its layer is named by its own id', (t) => {
  // The page's events, which Node lacks.
  const events = new EventTarget();
  for (const name of [
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ])
    globalThis[name] = events[name].bind(events);
  t.after(() => {
    for (const name of [
      'addEventListener',
      'removeEventListener',
      'dispatchEvent',
    ])
      delete globalThis[name];
  });
  const pinia = createPinia();
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const dataManager = {
    isEnabled: () => true,
    layers: new Map(),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const store = useEntityCardStore(pinia);
  const named = [];
  store.select = (identity) => named.push(identity.id);
  globalThis.dispatchEvent(
    new CustomEvent('gev:entity-selected', {
      detail: {
        layerId: 'ais-live-vessels',
        id: 'ais-5fdca702',
        properties: { vesselId: '5fdca702' },
        latitude: 1,
        longitude: 2,
      },
    }),
  );
  globalThis.dispatchEvent(
    new CustomEvent('gev:entity-selected', {
      detail: { layerId: 'fires', id: 'fire:1', latitude: 1, longitude: 2 },
    }),
  );
  assert.deepEqual(named, ['5fdca702', 'fire:1']);
});

test('card Fly to uses the item selection owner and camera ownership policy', (t) => {
  const events = new EventTarget();
  for (const name of [
    'addEventListener',
    'removeEventListener',
    'dispatchEvent',
  ]) {
    const previous = globalThis[name];
    globalThis[name] = events[name].bind(events);
    t.after(() => {
      if (previous) globalThis[name] = previous;
      else delete globalThis[name];
    });
  }
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const { port } = fakeCameraPort();
  let followed = null;
  let navigationHandoffs = 0;
  const flown = [];
  const selected = [];
  const camera = {
    ...port,
    get followed() {
      return followed;
    },
    flyToBounds: (...args) => flown.push(args),
  };
  const unbind = bindRenderer(viewer, { camera });
  let enabled = true;
  const manager = {
    isEnabled: () => enabled,
    getAll: () => [],
    layers: new Map([
      [
        'ais-live-vessels',
        {
          module: {
            getAnalystRecords: () => [
              {
                id: 'item-B',
                vesselId: 'item-B',
                name: 'SHIP B',
                lat: 52,
                lon: 1,
              },
            ],
            selectById: (id) => {
              selected.push(['vessel', id]);
              globalThis.dispatchEvent(
                new CustomEvent('gev:entity-selected', {
                  detail: {
                    layerId: 'ais-live-vessels',
                    id: `ais-${id}`,
                    properties: { vesselId: id },
                    latitude: 52,
                    longitude: 1,
                  },
                }),
              );
            },
          },
        },
      ],
      ['rail', { module: { focusTrain: (id) => selected.push(['rail', id]) } }],
      [
        'transit',
        { module: { focusVehicle: (id) => selected.push(['transit', id]) } },
      ],
      [
        'cctv',
        {
          module: {
            focusCamera: (id) => {
              selected.push(['camera', id]);
              return id === 'missing' ? 'no-active-camera' : 'focused';
            },
          },
        },
      ],
    ]),
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => manager,
    pinia,
    supersedeDeferredNavigation: () => {
      navigationHandoffs++;
    },
  });
  t.after(() => {
    disconnect();
    input.destroy();
    unbind();
    document.body.classList.remove('cockpit-mode');
  });
  const store = useEntityCardStore(pinia);
  const card = (layerId, id) => ({
    key: `${layerId}:${id}`,
    layerId,
    kind: 'item',
    identity: { layerId, id },
    lat: 52,
    lon: 1,
  });
  for (const layer of ['ais-live-vessels', 'rail', 'transit']) {
    store.card = card(layer, 'item-B');
    store.flyTo();
  }
  assert.deepEqual(
    selected,
    [
      ['vessel', 'item-B'],
      ['rail', 'item-B'],
      ['transit', 'item-B'],
    ],
    'a Nearby/pinned card selects its own item before a ride is offered',
  );
  assert.equal(flown.length, 2, 'rail already focuses through its layer');
  manager.layers.get('rail').module.focusTrain = () => false;
  store.card = card('rail', 'missing');
  assert.equal(store.flyTo(), true);
  assert.equal(
    flown.length,
    3,
    'a missing train still flies to its saved position',
  );
  assert.equal(
    store.open(
      { layerId: 'ais-live-vessels', id: 'item-B' },
      { fromPin: true },
    ),
    true,
  );
  assert.equal(store.card.identity.id, 'item-B');
  assert.equal(
    store.fromPin,
    true,
    'the layer announcement preserves the pin ownership',
  );
  selected.length = 0;
  flown.length = 0;
  store.card = card('cctv', 'camera-B');
  navigationHandoffs = 0;
  followed = { key: 'flights:aircraft-A' };
  assert.equal(store.flyTo(), 'tracking-holds-view');
  followed = null;
  document.body.classList.add('cockpit-mode');
  assert.equal(store.flyTo(), 'cockpit-active');
  document.body.classList.remove('cockpit-mode');
  assert.deepEqual(
    selected,
    [],
    'refused focus does not call the camera layer',
  );
  assert.deepEqual(flown, [], 'refused focus never reaches the generic flight');
  assert.equal(
    navigationHandoffs,
    0,
    'a refused camera cannot take over navigation',
  );
  assert.equal(store.flyTo(), 'focused');
  assert.equal(
    navigationHandoffs,
    1,
    'a successful camera flight supersedes older work',
  );
  assert.deepEqual(
    selected,
    [['camera', 'camera-B']],
    'the live camera owns free-view focus',
  );
  store.card = card('cctv', 'missing');
  assert.equal(store.flyTo(), true);
  assert.equal(
    flown.length,
    1,
    'a missing camera still flies to its saved position',
  );
  selected.length = 0;
  flown.length = 0;
  enabled = false;
  store.flyTo();
  assert.equal(
    selected.length,
    0,
    'a pin with its layer off does not wake the camera',
  );
  assert.equal(
    flown.length,
    1,
    'an off-layer pin can still fly to its saved location',
  );
});

test('aircraft card entry requires successful tracking and keeps the exact subject', async (t) => {
  const settle = () => setImmediate();
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => null,
  });
  const store = useEntityCardStore(pinia);
  const asked = [];
  const otherPinia = createPinia();
  const other = t.mock.fn();
  useCockpitStore(pinia).connect({ enter: (subject) => asked.push(subject) });
  useCockpitStore(otherPinia).connect({ enter: other });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const identity = { layerId: 'flights', id: 'aabbcc' };
  const card = { key: 'flights:aabbcc', layerId: 'flights', identity };
  store.card = card;
  const commands = [];
  let result = { ok: false };
  useOmnibarStore(pinia).connectRunner(async (name) => {
    commands.push(name);
    return result;
  });
  store.cockpit();
  await settle();
  assert.deepEqual(commands, ['track_entity']);
  assert.deepEqual(asked, []);

  let finish;
  result = new Promise((resolve) => {
    finish = resolve;
  });
  store.cockpit();
  store.card = null;
  finish({ ok: true });
  await settle();
  assert.deepEqual(asked, [], 'closing the card cancels entry');

  store.card = card;
  const tracked = Promise.withResolvers();
  result = tracked.promise;
  store.cockpit();
  setActivePinia(otherPinia);
  tracked.resolve({ ok: true });
  await settle();
  assert.deepEqual(asked, [identity], 'entry carries the card identity');
  assert.equal(
    other.mock.callCount(),
    0,
    'entry belongs to the originating app',
  );
});

test('an explicit Context card flight supersedes an airport pick still resolving', async (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const { port } = fakeCameraPort();
  const flown = [];
  const unbind = bindRenderer(viewer, {
    camera: { ...port, flyToBounds: (bounds) => flown.push(bounds) },
  });
  const navigation = new NavigationController({
    viewer,
    tracking: {},
    clearLocation() {},
    cancelShareSelection: () => true,
    isCockpitActive: () => false,
  });
  const manager = {
    isEnabled: () => false,
    getAll: () => [],
    layers: new Map(),
  };
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => manager,
    supersedeDeferredNavigation: () => navigation._stampNavigation(),
  });
  const stopPlacePick = installPlacePick({
    pinia,
    subscribeCameraHandoff: (listener) =>
      navigation.subscribeCameraHandoff(listener),
    getDataManager: () => manager,
  });
  let started;
  let release;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const airportReply = () =>
    new Response(
      JSON.stringify({
        rows: [
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
        ],
      }),
    );
  _setAirportsFetchForTest(async () => {
    started();
    await pending;
    return airportReply();
  });
  t.after(() => {
    release();
    _setAirportsFetchForTest(null);
    stopPlacePick();
    disconnect();
    navigation.stop();
    input.destroy();
    unbind();
  });
  const cards = useEntityCardStore(pinia);
  const key = 'places:current';
  cards.card = {
    key,
    layerId: 'places',
    kind: 'place',
    identity: { id: 'current' },
    lat: 48,
    lon: 2,
  };
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await requested;

  assert.equal(cards.flyTo(), true);
  release();
  await setImmediate();
  assert.equal(cards.card.key, key);
  assert.equal(flown.length, 1);
});

test('Locate flying to a vessel it found supersedes an airport pick still resolving', async (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const { port } = fakeCameraPort();
  const flown = [];
  const unbind = bindRenderer(viewer, {
    camera: { ...port, flyToBounds: (bounds) => flown.push(bounds) },
  });
  const navigation = new NavigationController({
    viewer,
    tracking: {},
    clearLocation() {},
    cancelShareSelection: () => true,
    isCockpitActive: () => false,
  });
  // One vessel that leaves its feed; its layer finds it on its track.
  let inFeed = true;
  const vessel = { id: 'v1', name: 'ARCADIA', lat: 1, lon: 10 };
  const module = {
    getAnalystRecords: () => (inFeed ? [{ ...vessel }] : []),
    referenceOf: () => null,
    selectById() {},
    locate: async () => ({ status: 'found', lat: 5, lon: 50 }),
  };
  const manager = {
    isEnabled: (id) => id === 'ais-live-vessels',
    getAll: () => [],
    layers: new Map([['ais-live-vessels', { module }]]),
  };
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => manager,
    supersedeDeferredNavigation: () => navigation._stampNavigation(),
  });
  const stopPlacePick = installPlacePick({
    pinia,
    subscribeCameraHandoff: (listener) =>
      navigation.subscribeCameraHandoff(listener),
    getDataManager: () => manager,
  });
  let started;
  let release;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  _setAirportsFetchForTest(async () => {
    started();
    await pending;
    return new Response(
      JSON.stringify({
        rows: [
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
        ],
      }),
    );
  });
  const cards = useEntityCardStore(pinia);
  // Context is open, so the card reads its feed.
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  t.after(() => {
    release();
    cards.clear();
    chrome.detach(owner);
    _setAirportsFetchForTest(null);
    stopPlacePick();
    disconnect();
    navigation.stop();
    input.destroy();
    unbind();
  });
  assert.equal(cards.select({ layerId: 'ais-live-vessels', id: 'v1' }), true);
  const key = cards.card.key;
  inFeed = false;
  cards.refresh();
  assert.equal(cards.lost, true, 'out of its feed');
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await requested;

  await cards.locate();
  assert.equal(flown.length, 1, 'Locate flies to where it was found');
  release();
  await setImmediate();
  assert.equal(
    cards.card.key,
    key,
    'the late airport pick does not take the card',
  );
  assert.equal(flown.length, 1, 'nor the camera');
});

test('Fly to on a train the rail layer focuses also supersedes an airport pick still resolving', async (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const { port } = fakeCameraPort();
  const flown = [];
  const unbind = bindRenderer(viewer, {
    camera: { ...port, flyToBounds: (bounds) => flown.push(bounds) },
  });
  const navigation = new NavigationController({
    viewer,
    tracking: {},
    clearLocation() {},
    cancelShareSelection: () => true,
    isCockpitActive: () => false,
  });
  const order = [];
  const manager = {
    isEnabled: (id) => id === 'rail',
    getAll: () => [],
    layers: new Map([
      [
        'rail',
        {
          module: {
            focusTrain: (id) => {
              order.push(['focus', id]);
              return true;
            },
          },
        },
      ],
    ]),
  };
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => manager,
    supersedeDeferredNavigation: () => {
      order.push(['supersede']);
      return navigation._stampNavigation();
    },
  });
  const stopPlacePick = installPlacePick({
    pinia,
    subscribeCameraHandoff: (listener) =>
      navigation.subscribeCameraHandoff(listener),
    getDataManager: () => manager,
  });
  let started;
  let release;
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  const airportReply = () =>
    new Response(
      JSON.stringify({
        rows: [
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
        ],
      }),
    );
  _setAirportsFetchForTest(async () => {
    started();
    await pending;
    return airportReply();
  });
  t.after(() => {
    release();
    _setAirportsFetchForTest(null);
    stopPlacePick();
    disconnect();
    navigation.stop();
    input.destroy();
    unbind();
  });
  const cards = useEntityCardStore(pinia);
  const key = 'rail:train-1';
  cards.card = {
    key,
    layerId: 'rail',
    kind: 'train',
    identity: { layerId: 'rail', id: 'train-1' },
    lat: 48,
    lon: 2,
  };
  announcePlacePick({
    name: 'AUS',
    airport: 'AUS',
    latitude: 30.19,
    longitude: -97.67,
  });
  await requested;

  assert.equal(cards.flyTo(), true);
  release();
  await setImmediate();
  assert.equal(cards.card.key, key, 'the late airport does not take over');
  assert.deepEqual(
    order,
    [['supersede'], ['focus', 'train-1']],
    'older navigation is retired before the train takes the camera, once',
  );
  assert.equal(flown.length, 0, 'the rail layer flies the camera itself');
});

test('a pick refused while the dock restores its photo is not reported as taken', (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  let restoring = true;
  const opened = [];
  const streetLevel = {
    getAnalystRecords: () => [
      { id: 'mapillary:A', name: 'A', lat: 47, lon: 2 },
      { id: 'mapillary:B', name: 'B', lat: 48, lon: 2 },
    ],
    hasDockedPhoto: () => true,
    dockedPhotoRestoring: () => restoring,
    openPhoto: (id) => {
      opened.push(id);
      return new Promise(() => {});
    },
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => ({
      isEnabled: () => true,
      layers: new Map([['street-level', { module: streetLevel }]]),
      getAll: () => [],
    }),
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const original = { layerId: 'street-level', id: 'mapillary:A' };
  const dock = useDockedStore(pinia);
  dock.dock({
    key: 'street-level:mapillary:A',
    kind: 'street',
    title: 'A',
    identity: original,
  });
  const store = useEntityCardStore(pinia);
  assert.equal(store.select(original, { reveal: false }), true);
  const selected = store.card;
  const generation = store.selectionGeneration();
  const pick = { layerId: 'street-level', id: 'mapillary:B' };
  assert.equal(store.open(pick, { follow: false }), false);
  assert.deepEqual(opened, [], 'the dock is not asked while it restores');
  assert.equal(dock.view?.key, selected.key);
  assert.equal(store.card, selected, 'the original card stays selected');
  assert.equal(store.selectionGeneration(), generation);

  restoring = false;
  assert.equal(store.open(pick), true);
  assert.deepEqual(opened, ['mapillary:B']);
  assert.equal(store.card, selected, 'the original card stays until commit');
});

// The map's Esc clears the pick only for an Esc nobody else took: not one
// already handled, not one from a control that takes its own Esc, and not
// while a dialog that owns its Esc is open.
test('the map’s Esc leaves the pick to an Esc another owner takes', (t) => {
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const dataManager = {
    isEnabled: () => true,
    layers: new Map(),
    getAll: () => [],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  const extra = [];
  t.after(() => {
    disconnect();
    input.destroy();
    for (const element of extra) element.remove();
  });
  const store = useEntityCardStore(pinia);
  const key = 'street-level:mapillary:A';
  store.card = {
    key,
    layerId: 'street-level',
    identity: { id: 'mapillary:A' },
  };
  const esc = (target, { handled = false } = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    if (handled) event.preventDefault();
    target.dispatchEvent(event);
    return event;
  };
  const add = (attributes) => {
    const element = document.createElement('div');
    for (const [name, value] of Object.entries(attributes))
      element.setAttribute(name, value);
    extra.push(document.body.appendChild(element));
    return element;
  };

  esc(document.body, { handled: true });
  assert.equal(store.card?.key, key, 'an Esc already handled');
  const owner = add({ 'data-owns-escape': '' });
  esc(owner);
  assert.equal(
    store.card?.key,
    key,
    'an Esc from a control that takes its own',
  );
  const popup = add({ role: 'dialog', 'data-owns-escape': '' });
  esc(document.body);
  assert.equal(
    store.card?.key,
    key,
    'an Esc on the page while such a dialog is open',
  );
  popup.remove();
  owner.remove();
  assert.equal(esc(document.body).defaultPrevented, true);
  assert.equal(store.card, null, 'an unowned Esc clears the photo card');
  assert.equal(store.wasDismissed(key), false, 'Esc keeps the photo open');
});

// Nearby opens a cable laid in pieces at its nearest piece: the card stays
// there and the camera flies there, not to the cable's first piece.
test('opening a far piece of a multi-piece cable from Nearby flies to that piece', async (t) => {
  const { readFileSync } = await import('node:fs');
  const { bindFakeDraw } = await import('../testSupport/fakeDrawPort.mjs');
  const { toLonLatH } = await import('../geo/ellipsoid.js');
  const { cableAnalystRecords } =
    await import('../layers/submarineCables/records.js');
  const { nearbyByLayer } = await import('../data/entityContext.js');
  const cableJson = JSON.parse(
    readFileSync(
      new URL(
        '../data/local_data/telegeography_submarine_cables/cable-geo.json',
        import.meta.url,
      ),
      'utf8',
    ),
  );
  const state = {
    _enabled: true,
    _loaded: true,
    _cachedCableJson: cableJson,
    _cachedLandingJson: { features: [] },
  };
  const layerId = 'telegeography-submarine-cables';
  const layer = {
    id: layerId,
    name: 'Submarine Cables',
    enabled: true,
    module: { getAnalystRecords: () => cableAnalystRecords(state) },
  };
  const dataManager = {
    isEnabled: () => true,
    layers: new Map([[layerId, layer]]),
    getAll: () => [layer],
  };
  const flown = [];
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const { unbind } = bindFakeDraw(viewer, {
    camera: {
      pose: () => ({ heading: 0, pitch: -1, roll: 0 }),
      on: () => () => {},
      followed: null,
      flyToBounds: (bounds) => flown.push(bounds),
    },
  });
  const input = fakeInput(viewer);
  const pinia = createPinia();
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  const store = useEntityCardStore(pinia);
  t.after(() => {
    store.clear();
    disconnect();
    input.destroy();
    unbind();
  });
  const topaz = cableAnalystRecords(state).find(
    (record) => record.name === 'Topaz',
  );
  const far = topaz.parts[1];
  assert.notDeepEqual(
    far,
    { lat: topaz.lat, lon: topaz.lon },
    'not its first piece',
  );
  const [list] = nearbyByLayer(dataManager, far, {
    radiusKm: 25,
    query: 'topaz',
  });
  assert.ok(store.select(list.items[0].identity, { fly: true }));
  assert.equal(store.card.lat, far.lat, 'the card stays at that piece');
  assert.equal(store.card.lon, far.lon);
  assert.equal(flown.length, 1, 'the camera flew once');
  const landed = toLonLatH(flown[0].center);
  assert.ok(Math.abs(landed.lat - far.lat) < 1e-6, `lat ${landed.lat}`);
  assert.ok(Math.abs(landed.lon - far.lon) < 1e-6, `lon ${landed.lon}`);
});

test('a quiet spell between thresholded changes keeps an active camera move unsettled', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = { scene: {} };
  const input = fakeInput(viewer);
  const events = new Map();
  const unbind = bindRenderer(viewer, {
    camera: {
      pose: () => ({ lat: 47, lon: -122, height: 40_000 }),
      viewRectangle: () => null,
      on(event, listener) {
        events.set(event, listener);
        return () => events.delete(event);
      },
    },
  });
  const pinia = createPinia();
  const store = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  const settled = [];
  store.setView = (_, options) => settled.push(options.settled);
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => null,
  });
  t.after(() => {
    disconnect();
    chrome.detach(owner);
    unbind();
    input.destroy();
  });
  t.mock.timers.tick(0);
  assert.deepEqual(settled, [true]);
  settled.length = 0;
  events.get('moveStart')?.();
  events.get('changed')();
  t.mock.timers.tick(1300);
  assert.ok(settled.length > 0);
  assert.ok(settled.every((value) => value === false));
  events.get('moveEnd')();
  assert.equal(settled.at(-1), true);

  events.get('changed')();
  t.mock.timers.tick(1300);
  assert.equal(
    settled.at(-1),
    true,
    'a jump without moveStart retains the quiet fallback',
  );
});

test('on a tilted globe view, what is in view is bounded by the camera, not the middle of the screen', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const viewer = { scene: {} };
  const input = fakeInput(viewer);
  // The camera is 5,000 km above (0, 0); the middle of the screen falls on
  // (0, 25).
  const unbind = bindRenderer(viewer, {
    camera: {
      pose: () => ({ lat: 0, lon: 0, height: 5_000_000 }),
      viewRectangle: () => null,
      on: () => () => {},
    },
  });
  const pinia = createPinia();
  const store = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  const layer = {
    id: 'flights',
    name: 'Flights',
    enabled: true,
    stats: { lastUpdate: 1 },
    module: {
      getAnalystRecords: () => [
        {
          id: 'visible',
          icao24: 'visible',
          callsign: 'VISIBLE',
          lat: 0,
          lon: 25,
        },
        {
          id: 'occulted',
          icao24: 'occulted',
          callsign: 'OCCULTED',
          lat: 0,
          lon: 70,
        },
      ],
    },
  };
  const manager = {
    layers: new Map([[layer.id, layer]]),
    getAll: () => [layer],
    isEnabled: () => true,
  };
  const disconnect = installEntityContext({
    viewer,
    pinia,
    getDataManager: () => manager,
    pickWorld: () => ({ lat: 0, lon: 25 }),
  });
  t.after(() => {
    disconnect();
    chrome.detach(owner);
    unbind();
    input.destroy();
  });

  t.mock.timers.tick(0);
  assert.deepEqual(store.view.center, { lat: 0, lon: 25 });
  const horizonDegrees = (Math.acos(6371 / (6371 + 5000)) * 180) / Math.PI;
  assert.ok(horizonDegrees > 55 && horizonDegrees < 57);
  // The camera sees the middle of the screen. A point 70 degrees from the
  // ground under it is behind the Earth at every heading and tilt.
  assert.deepEqual(
    store.inView()[0].items.map((item) => item.identity.id),
    ['visible'],
  );
});

// On a phone a camera stepped to from the Cameras sheet (its Next or
// Previous, or voice while it is shown) opens its card without pulling the
// person out of that sheet; a camera picked elsewhere shows Context.
test('a camera step made in the phone’s Cameras sheet keeps that sheet', async (t) => {
  const { CCTV_SELECTED_EVENT } = await import('./cctvEvents.js');
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const cameras = [
    { id: 'cam-a', name: 'A', lat: 30.2, lon: -97.7 },
    { id: 'cam-b', name: 'B', lat: 30.3, lon: -97.7 },
  ];
  const cctv = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    module: { getAnalystRecords: () => cameras },
  };
  const pinia = createPinia();
  let reveals = 0;
  const dataManager = {
    isEnabled: (id) => id === 'cctv',
    layers: new Map([['cctv', cctv]]),
    getAll: () => [cctv],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
    revealContext: () => reveals++,
  });
  t.after(() => {
    disconnect();
    input.destroy();
    document.body.removeAttribute('data-mobile-sheet');
  });
  const store = useEntityCardStore(pinia);
  const pick = (cameraId) =>
    document.dispatchEvent(
      new CustomEvent(CCTV_SELECTED_EVENT, { detail: { cameraId } }),
    );
  document.body.setAttribute('data-mobile-sheet', 'cameras');
  pick('cam-a');
  assert.equal(store.card?.key, 'cctv:cam-a', 'the card opens');
  assert.equal(reveals, 0, 'the Cameras sheet stays up');
  document.body.removeAttribute('data-mobile-sheet');
  pick('cam-b');
  assert.equal(store.card?.key, 'cctv:cam-b');
  assert.equal(reveals, 1, 'picked elsewhere, Context shows');
});

// A camera opened from a list makes it the active camera; the layer's notice
// of that pick comes back to the bridge, which finds its card already
// showing and leaves it: the card is selected once, not twice.
test('a camera opened from a list is selected once', async (t) => {
  const { CCTV_SELECTED_EVENT } = await import('./cctvEvents.js');
  const viewer = { scene: { pick: () => null, drillPick: () => [] } };
  const input = fakeInput(viewer);
  const cameras = [{ id: 'cam-a', name: 'A', lat: 30.2, lon: -97.7 }];
  const cctv = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    module: {
      getAnalystRecords: () => cameras,
      // The layer announces a pick at once, as its notify does.
      selectCamera: (cameraId) =>
        document.dispatchEvent(
          new CustomEvent(CCTV_SELECTED_EVENT, { detail: { cameraId } }),
        ),
    },
  };
  const pinia = createPinia();
  const dataManager = {
    isEnabled: (id) => id === 'cctv',
    layers: new Map([['cctv', cctv]]),
    getAll: () => [cctv],
  };
  const disconnect = installEntityContext({
    viewer,
    getDataManager: () => dataManager,
    pinia,
  });
  t.after(() => {
    disconnect();
    input.destroy();
  });
  const store = useEntityCardStore(pinia);
  // The bridge's own selects: none, since the card is already showing.
  const select = store.select;
  let bridgeSelects = 0;
  store.select = (...args) => {
    bridgeSelects++;
    return select(...args);
  };
  assert.equal(store.open({ layerId: 'cctv', id: 'cam-a' }), true);
  assert.equal(store.card?.key, 'cctv:cam-a');
  assert.equal(bridgeSelects, 0, 'selected once, by open');
});

const countAnswer = (count) => ({
  counts: [{ layerId: 'flights', count, at: 10 }],
});
const reading = {
  temperatureC: 16,
  timeZone: 'America/Los_Angeles',
  utcOffsetSeconds: -28_800,
};

function inspectorFixture(
  t,
  { controlWeatherCompletion = false, onWeatherAbort } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pinia = createPinia();
  const store = useEntityCardStore(pinia);
  const countStore = useLayerCountsStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const missions = useSpaceMissionsStore(pinia);
  const panel = chrome.connect({});
  chrome.publish(panel, 'global-context-panel', { collapsed: false });
  const viewer = { scene: {} };
  const input = fakeInput(viewer);
  const pose = { lat: 47, lon: -122, height: 40_000 };
  const cameraEvents = new Map();
  const unbind = bindRenderer(viewer, {
    camera: {
      pose: () => pose,
      viewRectangle: () => null,
      on(event, listener) {
        cameraEvents.set(event, listener);
        return () => cameraEvents.delete(event);
      },
    },
  });
  const weatherRequests = [];
  const countRequests = [];
  const countUpdates = [];
  const visibilityListeners = new Set();
  const weatherTimers = new Set();
  let elapsed = 0;
  let samples = 0;
  function port(requests, fields) {
    const { promise, resolve } = Promise.withResolvers();
    requests.push({ ...fields, resolve });
    return promise;
  }
  const readWeather = (lat, lon, { signal }) => {
    if (onWeatherAbort)
      signal.addEventListener('abort', onWeatherAbort, { once: true });
    return port(weatherRequests, { lat, lon, signal });
  };
  // This fixture can resolve the exact promise awaited by the owner, before
  // the bridge's queued update. Other tests use the real store action.
  if (controlWeatherCompletion) store.readWeather = readWeather;
  function managerFor(rows) {
    const listeners = new Set();
    return {
      rows,
      getAll() {
        samples++;
        return this.rows;
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      revise(nextRows) {
        this.rows = nextRows;
        for (const notify of listeners) notify({ type: 'fixture' });
      },
    };
  }
  let manager = managerFor([]);
  let disconnect;
  function connect() {
    const counts = createLayerCounts({
      getCounts: ({ signal }) => port(countRequests, { signal }),
      readState: () => countStore.state,
      writeState: countStore.publish,
      readShown: () => store.inspector.shown,
      now: () => elapsed,
    });
    disconnect = installEntityContext({
      viewer,
      pinia,
      getDataManager: () => manager,
      spotWeather: readWeather,
      inspector: {
        counts: {
          ...counts,
          update(snapshot) {
            countUpdates.push(snapshot);
            return counts.update(snapshot);
          },
        },
        weatherClock: {
          nowMonotonic: () => elapsed,
          onPageVisibility(listener) {
            visibilityListeners.add(listener);
            return () => visibilityListeners.delete(listener);
          },
          setTimeout(callback, ms) {
            const timer = setTimeout(() => {
              weatherTimers.delete(timer);
              callback();
            }, ms);
            weatherTimers.add(timer);
            return timer;
          },
          clearTimeout(timer) {
            weatherTimers.delete(timer);
            clearTimeout(timer);
          },
        },
      },
    });
    return disconnect;
  }
  async function advance(ms) {
    elapsed += ms;
    t.mock.timers.tick(ms);
    await nextTick();
  }
  connect();
  t.after(() => {
    disconnect();
    chrome.detach(panel);
    unbind();
    input.destroy();
  });

  return {
    store,
    countStore,
    missions,
    pose,
    cameraEvents,
    weatherRequests,
    countRequests,
    countUpdates,
    visibilityListeners,
    weatherTimers,
    connect,
    get disconnect() {
      return disconnect;
    },
    setRows: (rows) => manager.revise(rows),
    replaceManager: (rows) => {
      manager = rows && managerFor(rows);
    },
    show: (shown) => store.setViewContextShown(shown, 1),
    get samples() {
      return samples;
    },
    advance,
    async openAndRead() {
      store.setViewContextShown(true, 1);
      await nextTick();
      await advance(0);
      await advance(400);
    },
  };
}

const enabled = (id, stats) => ({ id, enabled: true, stats });

test('a replacement bridge admits its initial count request after the mounted Inspector settles', async (t) => {
  const f = inspectorFixture(t);
  f.disconnect();
  f.show(true);
  const closeReplacement = f.connect();
  assert.equal(f.countRequests.length, 0, 'nothing asks during setup');
  f.show(false);
  await nextTick();
  assert.equal(f.countRequests.length, 0, 'a same-turn collapse wins');

  closeReplacement();
  f.show(true);
  f.connect();
  assert.equal(f.countRequests.length, 0);
  await nextTick();
  assert.equal(f.countRequests.length, 1, 'the unchanged shown view asks once');
});

test('the first Inspector read includes a manager attached during bridge setup', async (t) => {
  const f = inspectorFixture(t);
  f.disconnect();
  f.show(true);
  f.replaceManager(null);
  f.connect();
  f.replaceManager([
    enabled('flights', { count: 17, lastUpdate: 2, scope: 'worldwide' }),
  ]);
  await setImmediate();
  assert.equal(f.store.inspectorRows[0].id, 'flights');
  assert.equal(f.countRequests.length, 0);
  assert.equal(
    f.samples,
    1,
    'subscribing does not sample the same entry twice',
  );
  assert.deepEqual(
    f.countStore.state.counts,
    {},
    'subscribing is not a feed update',
  );
  f.setRows(f.store.inspectorRows);
  await nextTick();
  assert.equal(f.countStore.state.counts.flights.count, 17);
});

test('counts admit only the settled Inspector state, and Directions does not fill it', async (t) => {
  const f = inspectorFixture(t);
  await nextTick();
  f.show(true);
  f.setRows([enabled('flights')]);
  await nextTick();
  assert.equal(
    f.countRequests.length,
    0,
    'the layer turning on wins over reopening',
  );
  assert.equal(
    f.samples,
    1,
    'rendering and count admission share the metadata sample',
  );

  f.setRows([]);
  f.show(false);
  await nextTick();
  assert.equal(
    f.countRequests.length,
    0,
    'hiding wins over the last layer turning off',
  );
  assert.equal(f.samples, 1, 'the hidden revision does not sample the manager');

  f.setRows([enabled('directions')]);
  f.show(true);
  await nextTick();
  assert.equal(f.countRequests.length, 1);
});

test('count admission waits for matching metadata when an earlier post callback reveals the Inspector', async (t) => {
  const f = inspectorFixture(t);
  await nextTick();
  const reveal = ref(false);
  t.after(watch(reveal, () => f.show(true), { flush: 'post' }));
  reveal.value = true;
  f.setRows([enabled('satellites')]);
  await nextTick();
  assert.equal(f.store.inspectorRows[0].id, 'satellites');
  assert.equal(
    f.countRequests.length,
    0,
    'hidden metadata cannot cause an empty count ask',
  );
});

test('count admission uses a manager replaced after the Inspector reads its rows', async (t) => {
  const f = inspectorFixture(t);
  f.disconnect();
  const replace = ref(false);
  t.after(
    watch(replace, () => f.replaceManager([enabled('satellites')]), {
      flush: 'post',
    }),
  );
  f.connect();
  await nextTick();
  t.after(
    watch(
      () => f.store.inspectorRows,
      () => {},
    ),
  );

  replace.value = true;
  f.show(true);
  await setImmediate();

  assert.equal(f.countRequests.length, 0);
  assert.equal(f.store.inspectorRows[0].id, 'satellites');
});

test('count admission follows the final visibility when post callbacks hide and reopen the Inspector', async (t) => {
  const f = inspectorFixture(t);
  await nextTick();
  const hide = ref(false);
  const reopen = ref(false);
  t.after(watch(hide, () => f.show(false), { flush: 'post' }));
  t.after(watch(reopen, () => f.show(true), { flush: 'post' }));
  hide.value = true;
  f.show(true);
  reopen.value = true;
  await nextTick();
  assert.equal(f.samples, 1, 'the net-visible state needs one metadata sample');
  assert.equal(
    f.countRequests.length,
    1,
    'the eligible sample needs no next pulse',
  );
});

test('a reopened Inspector uses the current globe rows when deciding whether to request counts', async (t) => {
  const f = inspectorFixture(t);
  await nextTick();
  const hide = ref(false);
  const reopen = ref(false);
  t.after(watch(hide, () => f.show(false), { flush: 'post' }));
  t.after(
    watch(
      reopen,
      () => {
        f.replaceManager([enabled('satellites')]);
        f.store.setView({ center: { lat: 0, lon: 0 }, heightM: 20_000_000 });
        f.show(true);
      },
      { flush: 'post' },
    ),
  );
  hide.value = true;
  f.show(true);
  reopen.value = true;
  await nextTick();
  assert.equal(f.store.inspectorRows[0].id, 'satellites');
  assert.equal(
    f.countRequests.length,
    0,
    'the updated metadata wins before admission',
  );
});

test('Radio and the Missions roster prevent a counts request; a pulse finds a silent manager replacement', async (t) => {
  const f = inspectorFixture(t);
  f.setRows([enabled('radio')]);
  f.show(true);
  await nextTick();
  assert.equal(f.countRequests.length, 0, 'Radio alone fills the Inspector');

  f.setRows([]);
  f.missions.setEnabled(true);
  await nextTick();
  assert.equal(
    f.countRequests.length,
    0,
    'the roster alone fills the Inspector',
  );

  f.setRows([enabled('flights')]);
  f.missions.setEnabled(false);
  await nextTick();
  f.replaceManager([]);
  await nextTick();
  assert.equal(f.countRequests.length, 0);
  assert.deepEqual(
    f.store.inspectorRows.map((row) => row.id),
    ['flights'],
  );

  f.store.pulseInspector();
  await nextTick();
  assert.deepEqual(f.store.inspectorRows, []);
  assert.equal(f.countRequests.length, 1);
  f.store.pulseInspector();
  await nextTick();
  assert.equal(
    f.countRequests.length,
    1,
    'an unchanged eligible pulse does not ask again',
  );
});

test('a same-center globe crossing refreshes metadata and pauses weather without admitting counts', async (t) => {
  const f = inspectorFixture(t);
  f.setRows([enabled('flights')]);
  await f.openAndRead();
  assert.equal(f.weatherRequests.length, 1);
  assert.equal(f.countRequests.length, 0);

  f.replaceManager([]);
  f.pose.height = 5_000_000;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  assert.deepEqual(f.store.inspectorRows, []);
  assert.ok(f.weatherRequests[0].signal.aborted);
  assert.equal(f.countRequests.length, 0);
  f.store.pulseInspector();
  await nextTick();
  await f.advance(400);
  assert.equal(f.countRequests.length, 1);
  assert.equal(f.weatherRequests.length, 1);
});

test('counts recover from an observed coalesced hide; a delivered hide aborts pending weather', async (t) => {
  const f = inspectorFixture(t);
  await f.openAndRead();
  const [weather] = f.weatherRequests;
  const [count] = f.countRequests;
  count.resolve(countAnswer(700));
  // Settle the count while hidden, then reopen before Vue flushes the hide.
  queueMicrotask(() => f.show(true));
  f.show(false);
  await nextTick();

  assert.ok(count.signal.aborted);
  assert.equal(f.countStore.state.lastAttemptAt, null);
  assert.deepEqual(f.countStore.state.counts, {});
  assert.deepEqual(f.countUpdates, [{ shown: true, nothingOn: true }]);
  assert.equal(
    f.countRequests.length,
    1,
    'the completion cannot start its own retry',
  );

  f.store.pulseInspector();
  await nextTick();
  assert.equal(f.countRequests.length, 2, 'the next visible pulse can retry');
  f.store.pulseInspector();
  await nextTick();
  assert.equal(f.countRequests.length, 2);
  f.countRequests[1].resolve(countAnswer(900));
  await Promise.resolve();
  assert.equal(f.countStore.state.counts.flights.count, 900);

  weather.resolve({ weather: reading });
  f.show(false);
  await setImmediate();
  assert.ok(weather.signal.aborted);
  assert.equal(f.store.viewWeather?.reading ?? null, null);
  assert.equal(f.store.viewWeather?.zone ?? null, null);
  f.show(true);
  f.store.pulseInspector();
  await nextTick();
  await f.advance(400);
  assert.equal(f.countRequests.length, 2);
  assert.equal(f.weatherRequests.length, 2);
});

test('a weather result is fenced by live camera motion or a changed cell before Vue flushes', async (t) => {
  t.mock.method(performance, 'now', () => 100);
  const f = inspectorFixture(t, { controlWeatherCompletion: true });
  await f.openAndRead();
  const [moving] = f.weatherRequests;
  const published = f.store.view;
  moving.resolve({ weather: reading });
  f.pose.lat += 0.2;
  f.cameraEvents.get('changed')();
  assert.equal(
    f.store.view,
    published,
    'the camera snapshot is still throttled',
  );
  await nextTick();
  assert.ok(moving.signal.aborted);
  assert.equal(f.store.viewWeather?.reading ?? null, null);

  f.cameraEvents.get('moveEnd')();
  await nextTick();
  await f.advance(400);
  const [, oldCell] = f.weatherRequests;
  oldCell.resolve({ weather: reading });
  f.pose.lat += 0.2;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  assert.ok(oldCell.signal.aborted);
  assert.equal(f.store.viewWeather?.zone ?? null, null);

  await f.advance(400);
  const [, , current] = f.weatherRequests;
  assert.equal(current.lat, f.pose.lat);
  // A round trip coalesced before any owner callback preserves this request.
  f.pose.lat -= 0.2;
  f.cameraEvents.get('moveEnd')();
  f.pose.lat += 0.2;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  assert.equal(f.weatherRequests.length, 3);
  assert.equal(current.signal.aborted, false);
  current.resolve({ weather: reading });
  await setImmediate();
  assert.deepEqual(f.store.viewWeather.reading, reading);
});

test('invalid camera poses cannot restart weather after quiet or moveEnd', async (t) => {
  t.mock.method(performance, 'now', () => 100);
  const f = inspectorFixture(t);
  await f.openAndRead();
  const [oldWeather] = f.weatherRequests;
  const previous = f.store.view;
  f.pose.lat = NaN;
  f.cameraEvents.get('changed')();
  await nextTick();
  assert.ok(oldWeather.signal.aborted);
  await f.advance(1200);
  await f.advance(400);
  assert.equal(f.store.view, previous);
  assert.equal(
    f.weatherRequests.length,
    1,
    'quiet did not publish a usable pose',
  );

  f.cameraEvents.get('moveEnd')();
  await nextTick();
  await f.advance(400);
  assert.equal(f.weatherRequests.length, 1, 'moveEnd still has no usable pose');

  f.pose.lat = 48;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  await f.advance(400);
  assert.equal(f.weatherRequests.length, 2);
  assert.equal(f.weatherRequests[1].lat, 48);
});

test('a weather completion that sees cell B releases its slot even when delivery coalesces back to A', async (t) => {
  const f = inspectorFixture(t, { controlWeatherCompletion: true });
  await f.openAndRead();
  const [first] = f.weatherRequests;
  const a = f.pose.lat;
  const b = a + 0.2;
  const delivered = [];
  const published = [];
  t.after(
    watch(
      () => f.store.view,
      (view) => delivered.push(view.center.lat),
      { flush: 'post' },
    ),
  );
  t.after(
    watch(
      () => f.store.viewWeather,
      (weather) => published.push(weather),
      { flush: 'sync' },
    ),
  );

  let beforeDelivery;
  first.resolve({ weather: reading });
  queueMicrotask(() => {
    beforeDelivery = {
      lat: f.store.view.center.lat,
      aborted: first.signal.aborted,
      pending: f.store.viewWeather.pending,
    };
    f.pose.lat = a;
    f.cameraEvents.get('moveEnd')();
  });
  f.pose.lat = b;
  f.cameraEvents.get('moveEnd')();
  await nextTick();

  assert.deepEqual(beforeDelivery, { lat: b, aborted: true, pending: false });
  assert.deepEqual(delivered, [a]);
  assert.deepEqual(
    published.filter((snapshot) => snapshot.reading || snapshot.zone),
    [],
    'there is no transient reading or zone',
  );
  assert.equal(
    f.weatherRequests.length,
    1,
    'no request for the transient cell',
  );

  await f.advance(400);
  assert.deepEqual(
    f.weatherRequests.map(({ lat }) => lat),
    [a, a],
  );
  const [, retry] = f.weatherRequests;
  retry.resolve({ weather: reading });
  await Promise.resolve();
  assert.deepEqual(f.store.viewWeather.reading, reading);
});

test('an abort listener that disposes the bridge cannot restore its previous weather', async (t) => {
  let dispose;
  const f = inspectorFixture(t, { onWeatherAbort: () => dispose() });
  dispose = f.disconnect;
  await f.openAndRead();
  f.weatherRequests[0].resolve({ weather: reading });
  await setImmediate();
  assert.deepEqual(f.store.viewWeather.reading, reading);
  await f.advance(11 * 60_000);
  f.store.pulseInspector();
  await nextTick();
  await f.advance(400);
  assert.equal(f.weatherRequests.length, 2);
  assert.equal(f.store.viewWeather.pending, true);

  f.cameraEvents.get('moveStart')();
  await nextTick();
  assert.equal(f.weatherRequests[1].signal.aborted, true);
  assert.equal(f.store.viewWeather, null);
  assert.equal(f.cameraEvents.size, 0);
});

test('bridge replacement keeps saved counts, cancels both old requests, and waits for its own camera', async (t) => {
  const f = inspectorFixture(t);
  const disposeOld = f.disconnect;
  f.setRows([
    enabled('flights', { count: 900, lastUpdate: 2, scope: 'worldwide' }),
  ]);
  await nextTick();
  await f.openAndRead();
  assert.deepEqual(
    f.countStore.state.counts,
    {},
    'entry alone does not save live totals',
  );
  f.store.pulseInspector();
  await nextTick();
  assert.equal(f.countStore.state.counts.flights.count, 900);
  f.setRows([]);
  await nextTick();
  const [oldWeather] = f.weatherRequests;
  const [oldCount] = f.countRequests;
  f.disconnect();
  assert.ok(oldWeather.signal.aborted);
  assert.ok(oldCount.signal.aborted);
  assert.equal(f.visibilityListeners.size, 0);
  assert.equal(f.cameraEvents.size, 0);
  assert.equal(f.store.viewWeather, null);
  assert.deepEqual(f.store.inspectorRows, []);
  assert.equal(f.countStore.state.counts.flights.count, 900);
  assert.equal(f.countStore.state.lastAttemptAt, null);

  f.pose.lat = NaN;
  f.connect();
  await f.advance(1000);
  assert.equal(
    f.weatherRequests.length,
    1,
    'a stale camera snapshot cannot admit weather',
  );
  assert.equal(
    f.countRequests.length,
    2,
    'the replacement can begin its own counts ask',
  );
  f.pose.lat = 48;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  await f.advance(400);
  const [, newWeather] = f.weatherRequests;
  const [, newCount] = f.countRequests;
  assert.equal(newWeather.lat, 48);
  newWeather.resolve({ weather: reading });
  newCount.resolve(countAnswer(1000));
  await setImmediate();

  oldWeather.resolve({ weather: { temperatureC: -99 } });
  oldCount.resolve(countAnswer(700));
  disposeOld();
  await setImmediate();
  assert.deepEqual(f.store.viewWeather.reading, reading);
  assert.equal(f.countStore.state.counts.flights.count, 1000);

  f.pose.lat = 49;
  f.cameraEvents.get('moveEnd')();
  await nextTick();
  assert.equal(f.weatherTimers.size, 1, 'new cell has a queued settle timer');
  f.disconnect();
  assert.equal(f.weatherTimers.size, 0);
  assert.equal(f.visibilityListeners.size, 0);
  const completedAttempt = f.countStore.state.lastAttemptAt;
  assert.notEqual(completedAttempt, null);
  f.connect();
  await nextTick();
  assert.equal(
    f.countRequests.length,
    2,
    'replacement respects the completed cooldown',
  );
  assert.equal(f.countStore.state.lastAttemptAt, completedAttempt);
  assert.equal(f.countStore.state.counts.flights.count, 1000);
});
