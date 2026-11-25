// src/ui/itemCharts.test.mjs — a fire's chart says how many satellite hits
// it counts, worded for that count in every language (one hit, two hits).
import '../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { setLocale } from '../i18n/index.js';
import { useEntityCardStore } from './stores/entityCard.js';
import ItemCharts from './views/panels/ItemCharts.vue';

const FIRE = {
  key: 'local-firms:f1',
  layerId: 'local-firms',
  lat: 38.5,
  lon: -122.4,
};

async function chartLabel(t, hits) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  const now = Date.now();
  const records = Array.from({ length: hits }, (_, index) => ({
    record: { acqTime: now - (index + 1) * 60_000, frp: 10 },
  }));
  cards.recordsNear = () => records;
  const app = createApp({ render: () => h(ItemCharts, { card: FIRE }) }).use(
    pinia,
  );
  t.after(() => app.unmount());
  app.mount(document.body.appendChild(document.createElement('div')));
  await nextTick();
  return document
    .querySelector('.item-charts svg[role="img"]')
    ?.getAttribute('aria-label');
}

test('one satellite fire hit is one hit, two are hits', async (t) => {
  assert.equal(
    await chartLabel(t, 1),
    '1 satellite fire hit within 25 km in the last 24 hours',
  );
  assert.equal(
    await chartLabel(t, 2),
    '2 satellite fire hits within 25 km in the last 24 hours',
  );
});

test('each language words the count with its own plural form', async (t) => {
  t.after(() => setLocale('en'));
  setLocale('ru');
  assert.equal(
    await chartLabel(t, 1),
    '1 спутниковое обнаружение пожара в пределах 25 км за последние 24 часа',
  );
  assert.equal(
    await chartLabel(t, 2),
    '2 спутниковых обнаружения пожаров в пределах 25 км за последние 24 часа',
  );
  setLocale('de');
  assert.match(await chartLabel(t, 1), /^1 Satelliten-Feuermeldung im/);
  assert.match(await chartLabel(t, 2), /^2 Satelliten-Feuermeldungen im/);
});
