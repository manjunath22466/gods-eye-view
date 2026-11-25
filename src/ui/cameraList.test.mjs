// src/ui/cameraList.test.mjs — Context's Cameras list: the cameras within
// Context's radius of the view centre, in the order Nearby lists them and
// Prev/Next steps through them, over happy-dom.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import CameraList from './views/panels/CameraList.vue';
import NearbyLists from './views/panels/NearbyLists.vue';
import EntityCard from './views/panels/EntityCard.vue';
import { useEntityCardStore } from './stores/entityCard.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import {
  contextListPresence,
  contextListsActive,
  contextListChoice,
  resetContextLists,
} from './contextLists.js';
import { contextRadiusKm, setContextRadiusKm } from './contextRadius.js';
import {
  closeContextSearch,
  contextSearchOpen,
  contextSearchText,
} from './contextSearch.js';
import { greatCircleKm } from '../geoDistance.js';
import { CCTV_ACTIVATION_RESULT } from '../cctvFocusRequest.js';
import { createControls } from '../layers/cctv/controls.js';
import { createNavigation } from '../layers/cctv/navigation.js';

// Austin, Texas.
const HERE = { lat: 30.27, lon: -97.74 };

/**
 * The CCTV layer's own controls and navigation over the given cameras, with
 * `picked` listing every camera the layer was asked to make active, in order.
 */
function cctvModule(cameras) {
  const picked = [];
  const records = cameras.map((camera) => ({ camera }));
  const state = {
    _enabled: true,
    _records: records,
    _recordById: new Map(records.map((r) => [r.camera.id, r])),
    _activeCameraId: null,
    _cameraWalk: null,
    _nearbyArea: null,
    _listeners: new Set(),
    _viewer: null,
  };
  const parts = {
    model: {
      eyePose: () => null,
      haversineKm: (lat1, lon1, lat2, lon2) =>
        greatCircleKm({ lat: lat1, lon: lon1 }, { lat: lat2, lon: lon2 }),
    },
    selection: {
      setActiveCamera(id) {
        if (!state._recordById.has(id)) return CCTV_ACTIVATION_RESULT.NOT_FOUND;
        state._activeCameraId = id;
        picked.push(id);
        return CCTV_ACTIVATION_RESULT.ACTIVATED;
      },
    },
    presentation: { notifyListeners() {} },
  };
  const context = {
    state,
    services: {
      render: { holdContinuousRender() {}, releaseContinuousRender() {} },
      activation: { CCTV_ACTIVATION_RESULT },
    },
    parts,
    source: {},
  };
  parts.navigation = createNavigation(context);
  return { state, picked, methods: createControls(context).methods };
}

// Cameras north of Austin at growing distances, listed out of order, and one
// in Dallas, outside a 100 km radius.
const step = (i) => ({
  id: `cam${i}`,
  name: `Camera ${i}`,
  city: 'Austin',
  provider: 'TxDOT',
  lat: HERE.lat + i * 0.01,
  lon: HERE.lon,
});
const CAMERAS = [
  step(3),
  step(1),
  {
    id: 'dallas',
    name: 'Dallas cam',
    city: 'Dallas',
    provider: 'TxDOT',
    lat: 32.78,
    lon: -96.8,
  },
  step(5),
  step(2),
  step(4),
];

function fixture(t, cameras = CAMERAS, { withCard = false } = {}) {
  document.body.replaceChildren();
  resetContextLists();
  const radius = contextRadiusKm.value;
  setContextRadiusKm(100);
  const cctv = cctvModule(cameras);
  const layer = {
    id: 'cctv',
    name: 'Cameras',
    enabled: true,
    stats: { count: cameras.length },
    module: cctv.methods,
  };
  const pinia = createPinia();
  const host = document.body.appendChild(document.createElement('div'));
  const app = createApp({
    render: () => (withCard ? [h(CameraList), h(EntityCard)] : h(CameraList)),
  }).use(pinia);
  const store = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  chrome.publish(owner, 'global-context-panel', { collapsed: false });
  const listeners = new Set();
  const manager = {
    layers: new Map([['cctv', layer]]),
    isEnabled: (id) => id === 'cctv' && layer.enabled,
    getAll: () => [layer],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  store.connect({
    dataManager: () => manager,
    flyTo() {},
    canFollow: () => false,
  });
  store.setView({ center: { ...HERE } });
  app.mount(host);
  t.after(() => {
    app.unmount();
    store.connect(null);
    chrome.detach(owner);
    setContextRadiusKm(radius);
    closeContextSearch();
    contextSearchText.value = '';
    resetContextLists();
  });
  const changeLayers = () =>
    listeners.forEach((listener) => listener({ type: 'visibility' }));
  const names = () =>
    [...document.querySelectorAll('.camera-list li .nearby-lists__name')].map(
      (el) => el.textContent,
    );
  return { store, cctv, layer, pinia, changeLayers, names };
}

test("the Cameras list has every camera within the radius, nearest first, as Nearby's Cameras group counts and orders them", async (t) => {
  const { store, names } = fixture(t);
  await nextTick();
  assert.deepEqual(names(), [
    'Camera 1',
    'Camera 2',
    'Camera 3',
    'Camera 4',
    'Camera 5',
  ]);
  assert.deepEqual(
    { ...contextListPresence.cctv },
    { count: 5 },
    'the tab reads Cameras · 5',
  );
  const group = store
    .nearbyLayers(HERE.lat, HERE.lon, {
      radiusKm: contextRadiusKm.value,
      limit: 100,
    })
    .find((list) => list.layerId === 'cctv');
  assert.equal(group.count, 5);
  assert.deepEqual(
    group.items.map((item) => item.title),
    names(),
  );
  const first = document.querySelector('.camera-list li');
  assert.match(first.textContent, /Austin · TxDOT/);
  assert.match(first.textContent, /1\.1 km/);
});

test('the list narrows to the search, and says why it is empty', async (t) => {
  const { names } = fixture(t);
  contextSearchOpen.value = true;
  contextSearchText.value = 'camera 4';
  await nextTick();
  assert.deepEqual(names(), ['Camera 4']);
  contextSearchText.value = 'zzz';
  await nextTick();
  assert.match(
    document.querySelector('.camera-list__empty').textContent,
    /No cameras here match the search/,
  );
});

test('a row opens the camera on Inspect: the camera is picked and its card shows', async (t) => {
  const { store, cctv } = fixture(t);
  contextListChoice.value = 'cctv';
  contextListsActive.value = true;
  await nextTick();
  document.querySelectorAll('.camera-list li button')[1].click();
  await nextTick();
  assert.deepEqual(
    cctv.picked,
    ['cam2'],
    'picked in the layer, as a click on the globe picks it',
  );
  assert.equal(store.card?.key, 'cctv:cam2');
  assert.equal(contextListsActive.value, false, 'Inspect, not the list');
});

test('a row opened from the keyboard hands focus to the card that replaces the list', async (t) => {
  // The card asks for nothing over the network here.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  t.after(() => (globalThis.fetch = realFetch));
  const { store } = fixture(t, CAMERAS, { withCard: true });
  contextListChoice.value = 'cctv';
  contextListsActive.value = true;
  await nextTick();
  const row = document.querySelectorAll('.camera-list li button')[1];
  row.focus();
  row.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  await nextTick();
  assert.equal(store.card?.key, 'cctv:cam2');
  assert.ok(
    document.activeElement?.closest('#entity-card'),
    `focus is in the card, not on ${document.activeElement?.tagName}`,
  );
});

test('Prev/Next walk the same list in the same order', async (t) => {
  const { cctv, names } = fixture(t);
  await nextTick();
  const nameOf = (id) => CAMERAS.find((camera) => camera.id === id).name;
  const next = cctv.methods
    .getRowControls()
    .chips.find((chip) => chip.id === 'next-camera');
  const walked = [];
  for (let i = 0; i < names().length; i += 1) {
    next.onClick();
    walked.push(nameOf(cctv.picked.at(-1)));
  }
  assert.deepEqual(walked, names());
});

test('long lists show a page at a time', async (t) => {
  const many = Array.from({ length: 120 }, (_, i) => step(i / 100));
  fixture(t, many);
  await nextTick();
  const rows = () => document.querySelectorAll('.camera-list li').length;
  assert.equal(rows(), 50);
  const more = document.querySelector('.camera-list__more');
  assert.match(more.textContent, /Show 50 more cameras/);
  more.click();
  await nextTick();
  assert.equal(rows(), 100);
  assert.match(
    document.querySelector('.camera-list__more').textContent,
    /Show 20 more cameras/,
  );
  document.querySelector('.camera-list__more').click();
  await nextTick();
  assert.equal(rows(), 120);
  assert.equal(document.querySelector('.camera-list__more'), null);
});

test('the tab goes when Cameras turns off', async (t) => {
  const { layer, changeLayers, cctv } = fixture(t);
  await nextTick();
  assert.ok(contextListPresence.cctv);
  // Prev/Next walk this list: with no view to go by, a step takes its nearest.
  assert.equal(
    cctv.methods.stepNearbyCamera(1, { focus: false })?.cameraId,
    'cam1',
    'Prev/Next walk this list',
  );
  layer.enabled = false;
  cctv.state._enabled = false;
  changeLayers();
  await nextTick();
  assert.equal(contextListPresence.cctv, undefined);
  // The list let go of the walk: with no view either, a new walk finds nothing.
  cctv.state._enabled = true;
  cctv.state._activeCameraId = null;
  assert.equal(cctv.methods.stepNearbyCamera(1, { focus: false }), null);
});

test("Nearby's Cameras group links to the list while it has more than it shows", async (t) => {
  const { store, pinia } = fixture(t);
  await nextTick();
  const lists = store.nearbyLayers(HERE.lat, HERE.lon, {
    radiusKm: contextRadiusKm.value,
    limit: 3,
  });
  const host = document.body.appendChild(document.createElement('div'));
  const nearby = createApp({ render: () => h(NearbyLists, { lists }) }).use(
    pinia,
  );
  nearby.mount(host);
  t.after(() => nearby.unmount());
  const link = host.querySelector('.nearby-lists__all');
  assert.match(link.textContent, /Show all 5/);
  link.click();
  assert.equal(contextListsActive.value, true);
  assert.equal(contextListChoice.value, 'cctv');
});
