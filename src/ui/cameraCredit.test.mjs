// A camera's picture away from its card (the dock, a pinned tile) carries
// its provider and a partner feed's owner, as the card's source line names
// them, from the layer or, with Cameras off, from what its dock or pin kept.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { cameraCredit, cameraSource } from './cameraCredit.js';
import PinnedGrid from './views/panels/PinnedGrid.vue';
import DockedView from './views/panels/DockedView.vue';
import { usePinnedStore } from './stores/pinned.js';
import { useDockedStore } from './stores/docked.js';
import { useEntityCardStore } from './stores/entityCard.js';

test('the credit is the provider, then a partner feed’s owner; the layer’s details win over what was kept', () => {
  const live = {
    provider: 'TxDOT',
    credit: 'City of Austin',
    refreshMs: 10_000,
  };
  assert.deepEqual(cameraSource(live), {
    provider: 'TxDOT',
    credit: 'City of Austin',
  });
  assert.deepEqual(cameraSource({ provider: ' 511NY ', credit: '' }), {
    provider: '511NY',
    credit: '',
  });
  assert.equal(cameraSource({ provider: null, credit: '  ' }), null);
  assert.equal(cameraSource(null), null);
  assert.equal(cameraCredit(live), 'TxDOT · City of Austin');
  assert.equal(
    cameraCredit({ provider: 'TxDOT' }, { provider: 'Old' }),
    'TxDOT',
  );
  assert.equal(
    cameraCredit(null, { provider: 'TxDOT', credit: 'City of Austin' }),
    'TxDOT · City of Austin',
  );
  assert.equal(cameraCredit({ refreshMs: 10_000 }, null), '');
  assert.equal(cameraCredit(null, null), '');
});

function connect(cards, cctvModule) {
  const layers = new Map(
    cctvModule
      ? [
          [
            'cctv',
            { id: 'cctv', name: 'Cameras', enabled: true, module: cctvModule },
          ],
        ]
      : [],
  );
  cards.connect({
    dataManager: () => ({
      layers,
      isEnabled: (id) => layers.has(id),
      getAll: () => [...layers.values()],
      subscribe: () => () => {},
    }),
    regionalBrief: async () => null,
    previews: () => null,
    canFollow: () => false,
    follow() {},
    flyTo() {},
    ask() {},
  });
}

function mount(t, component) {
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  const app = createApp({ render: () => h(component) }).use(pinia);
  t.after(() => {
    app.unmount();
    cards.connect(null);
  });
  return { host, pinia, cards, mount: () => app.mount(host) };
}

const cameraPin = (id, extra = {}) => ({
  key: `cctv:${id}`,
  kind: 'camera',
  title: `Camera ${id}`,
  icon: 'videocam',
  identity: { layerId: 'cctv', id },
  ...extra,
});

test('a pinned camera still is credited on its tile, from the layer or from what the pin kept', async (t) => {
  const { host, pinia, cards, mount: go } = mount(t, PinnedGrid);
  const details = { live: { provider: 'TxDOT', credit: 'City of Austin' } };
  connect(cards, { cameraDetails: (id) => details[id] ?? null });
  const pinned = usePinnedStore(pinia);
  // Kept at pinning; the layer no longer holds the camera.
  pinned.pin(
    cameraPin('kept', {
      source: { provider: 'Caltrans', credit: '' },
      still: 'data:image/jpeg;base64,A',
    }),
  );
  // A pin that kept none, its camera known to the layer.
  pinned.pin(cameraPin('live', { still: 'data:image/jpeg;base64,B' }));
  // Nothing kept and nothing known: no credit to show.
  pinned.pin(cameraPin('unknown', { still: 'data:image/jpeg;base64,C' }));
  // No still yet: no picture, nothing to credit.
  pinned.pin(
    cameraPin('blank', { source: { provider: 'Caltrans', credit: '' } }),
  );
  go();
  await nextTick();
  const credits = [...host.querySelectorAll('.pinned-grid__tile')].map(
    (tile) =>
      tile.querySelector('.pinned-grid__photo-credit')?.textContent ?? null,
  );
  assert.deepEqual(credits, ['Caltrans', 'TxDOT · City of Austin', null, null]);
});

test('a docked camera is credited under its picture; with Cameras off, from what the dock kept', async (t) => {
  const { host, pinia, cards, mount: go } = mount(t, DockedView);
  // The layer still serves a frame but no longer knows the camera's details.
  connect(cards, {
    frameUrlForCamera: (id) => ({ url: `/frame/${id}.jpg`, refreshMs: 10_000 }),
  });
  const docked = useDockedStore(pinia);
  docked.dock({
    ...cameraPin('cam1'),
    source: { provider: 'TxDOT', credit: 'City of Austin' },
  });
  go();
  await nextTick();
  assert.equal(
    host.querySelector('.docked-view__frame img')?.getAttribute('src'),
    '/frame/cam1.jpg',
  );
  assert.equal(
    host.querySelector('.docked-view__credit')?.textContent,
    'TxDOT · City of Austin',
  );
  // A dock that kept nothing, for a camera the layer does not know, has
  // nothing to name.
  docked.dock(cameraPin('cam2'));
  await nextTick();
  assert.equal(host.querySelector('.docked-view__credit'), null);
});
