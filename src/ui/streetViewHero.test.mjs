// A street-level photo's card opens its photo again when picked from a list:
// it says so while the photo loads, and why when it cannot, with Retry.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSameNode } from '../testSupport/domAssert.mjs';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import StreetViewHero from './views/panels/StreetViewHero.vue';
import { useEntityCardStore } from './stores/entityCard.js';
import { useStreetLevelStore } from './stores/streetLevel.js';
import { presentStreetLevelPanel } from './streetLevelPresentation.js';
import { createStreetLevelLayer } from '../layers/streetLevel/index.js';
import {
  fakeCesiumViewer,
  fakeStreetLevelProvider,
} from '../testSupport/streetLevelFakes.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function mountHero(t, id) {
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  const layer = {
    id: 'street-level',
    name: 'Street Level',
    enabled: true,
    module: { photo: () => null },
  };
  const manager = {
    layers: new Map([[layer.id, layer]]),
    isEnabled: () => true,
    getAll: () => [layer],
    subscribe: () => () => {},
  };
  cards.connect({
    dataManager: () => manager,
    regionalBrief: async () => null,
    previews: () => null,
    canFollow: () => false,
    follow() {},
    flyTo() {},
    ask() {},
  });
  const street = useStreetLevelStore(pinia);
  const view = (error = null) => ({
    enabled: true,
    error,
    viewer: { open: false, photo: null },
  });
  street.publish(view());
  const asked = [];
  let answer = null;
  street.attach({
    openPhoto: (photoId) => {
      asked.push(photoId);
      return new Promise((resolve) => {
        answer = resolve;
      });
    },
  });
  const app = createApp({
    render: () =>
      h(StreetViewHero, {
        card: {
          key: `street-level:${id}`,
          layerId: 'street-level',
          identity: { layerId: 'street-level', id },
        },
      }),
  }).use(pinia);
  app.mount(host);
  t.after(() => {
    app.unmount();
    cards.connect(null);
  });
  return {
    host,
    asked,
    answer: async (value) => {
      answer(value);
      await settle();
      await nextTick();
    },
    fail: async (error) => {
      street.publish(view(error));
      answer(false);
      await settle();
      await nextTick();
    },
  };
}

test('a Nearby line’s card says its photo is loading, then why there is none, and Retry asks again', async (t) => {
  const id = 'near:kartaview:59.33,18.06';
  const { host, asked, fail } = mountHero(t, id);
  await nextTick();
  assert.deepEqual(asked, [id]);
  assert.equal(
    host.querySelector('.sl-hero__state[role="status"]')?.textContent,
    'Loading photo...',
  );
  await fail('No street-level imagery within 50 m of that point');
  const alert = host.querySelector('.sl-hero__state[role="alert"]');
  assert.match(alert?.textContent ?? '', /No street-level imagery within 50 m/);
  alert.querySelector('button').click();
  await nextTick();
  assert.deepEqual(asked, [id, id], 'Retry asks for the photo again');
  assert.ok(host.querySelector('.sl-hero__state[role="status"]'));
});

test('a photo that cannot open says so even without an error from the layer', async (t) => {
  const { host, fail } = mountHero(t, 'kartaview:42');
  await nextTick();
  await fail(null);
  assert.equal(
    host.querySelector('.sl-hero__state[role="alert"] span')?.textContent,
    'No imagery',
  );
});

test('after Retry, focus stays in the hero, and returns to Retry when the photo still cannot open', async (t) => {
  const { host, fail } = mountHero(t, 'kartaview:42');
  await nextTick();
  await fail(null);
  const hero = host.querySelector('.sl-hero');
  const retry = () => host.querySelector('.sl-hero__retry');
  retry().focus();
  retry().click();
  await nextTick();
  assert.ok(
    !host.querySelector('.sl-hero__retry'),
    'Retry is gone while loading',
  );
  assertSameNode(document.activeElement, hero, 'focus waits on the hero');
  await fail(null);
  await nextTick();
  assertSameNode(document.activeElement, retry(), 'focus is back on Retry');
});

test('a photo the viewer cannot load shows its failure and Retry in the card, not an empty viewer', async (t) => {
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  // A real layer whose viewer rejects every image.
  const provider = fakeStreetLevelProvider({ id: 'mapillary' });
  const create = provider.create;
  let opens = 0;
  provider.create = (context) => {
    const instance = create(context);
    instance.viewer.open = async () => {
      opens++;
      throw new Error('Image could not be opened');
    };
    return instance;
  };
  const viewer = fakeCesiumViewer();
  viewer.canvas = viewer.scene.canvas;
  const layer = createStreetLevelLayer({ providers: [provider] });
  layer.init(viewer);
  layer.enable(viewer);
  layer.attachViewerHost(
    document.body.appendChild(document.createElement('div')),
  );
  await settle();
  const street = useStreetLevelStore(pinia);
  const unsubscribe = layer.subscribe((state) =>
    street.publish(presentStreetLevelPanel(state)),
  );
  street.publish(presentStreetLevelPanel(layer.getUIState()));
  street.attach({ openPhoto: (id) => layer.openPhoto(id) });
  const cards = useEntityCardStore(pinia);
  const record = {
    id: 'street-level',
    name: 'Street Level',
    enabled: true,
    module: layer,
  };
  const manager = {
    layers: new Map([[record.id, record]]),
    isEnabled: () => true,
    getAll: () => [record],
    subscribe: () => () => {},
  };
  cards.connect({
    dataManager: () => manager,
    regionalBrief: async () => null,
    previews: () => null,
    canFollow: () => false,
    follow() {},
    flyTo() {},
    ask() {},
  });
  const id = 'mapillary:img-1';
  const app = createApp({
    render: () =>
      h(StreetViewHero, {
        card: {
          key: `street-level:${id}`,
          layerId: 'street-level',
          identity: { layerId: 'street-level', id },
        },
      }),
  }).use(pinia);
  app.mount(host);
  t.after(() => {
    app.unmount();
    unsubscribe?.();
    cards.connect(null);
    layer.destroy();
  });
  await settle();
  await nextTick();
  assert.equal(opens, 1);
  assert.ok(!host.querySelector('#sl-viewer-slot'), 'no empty viewer slot');
  const retry = () => host.querySelector('.sl-hero__retry');
  assert.match(
    host.querySelector('.sl-hero__state[role="alert"]')?.textContent ?? '',
    /Image could not be opened/,
  );
  retry().focus();
  retry().click();
  await settle();
  await nextTick();
  assert.equal(opens, 2, 'Retry asks again');
  assertSameNode(document.activeElement, retry(), 'focus is back on Retry');
});

test('a card whose request a newer one took over shows no failure of its own', async (t) => {
  const { host, answer } = mountHero(t, 'kartaview:42');
  await nextTick();
  await answer(null);
  assert.equal(host.querySelector('.sl-hero__state[role="alert"]'), null);
  assert.equal(host.querySelector('.sl-hero__state[role="status"]'), null);
});
