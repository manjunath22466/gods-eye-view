// A street-level photo's picture away from its viewer (its card's still, a
// place card's photo) carries its provider's credit, with who took it and
// its licence when known, for as long as the picture shows.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { useStreetLevelStore } from './stores/streetLevel.js';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { streetPhotoCredit } from './streetPhotoCredit.js';
import { createPhotoHistory } from '../layers/streetLevel/photos.js';
import { createStreetLevelLayer } from '../layers/streetLevel/index.js';
import { KARTAVIEW_CREDIT_HTML } from '../layers/streetLevel/providers/kartaview/policy.js';
import { fakeStreetLevelProvider } from '../testSupport/streetLevelFakes.mjs';
import StreetViewHero from './views/panels/StreetViewHero.vue';
import { useEntityCardStore } from './stores/entityCard.js';

const KARTAVIEW_TEXT =
  'Street Level: imagery © KartaView contributors, CC BY-SA 4.0';

const record = (overrides = {}) => ({
  id: 'kartaview:42',
  providerId: 'kartaview',
  provider: 'KartaView',
  creator: null,
  license: null,
  still: 'https://example.org/42.jpg',
  ...overrides,
});

/** A Street Level module as the card reads it: its photos and credits. */
const streetModule = (photos, credits = { kartaview: KARTAVIEW_TEXT }) => ({
  getAnalystRecords: () => [],
  photo: (id) => photos[id] || null,
  providerCredit: (id) => credits[id] || '',
});

test('the credit is the provider’s own, then who took it and the picture’s licence', () => {
  const photos = {
    'kartaview:42': record({ creator: 'mapfool' }),
    'panoramax:7': record({
      id: 'panoramax:7',
      providerId: 'panoramax',
      provider: 'Panoramax',
      via: 'panoramax.ign.fr',
      license: 'CC-BY-SA-4.0',
    }),
  };
  const module = streetModule(photos, {
    kartaview: KARTAVIEW_TEXT,
    panoramax:
      'Street Level: imagery © Panoramax contributors, licence per picture',
  });
  assert.equal(
    streetPhotoCredit(module, 'kartaview:42'),
    `${KARTAVIEW_TEXT} · Image by mapfool`,
  );
  assert.equal(
    streetPhotoCredit(module, 'panoramax:7'),
    'Street Level: imagery © Panoramax contributors, licence per picture · via panoramax.ign.fr · CC-BY-SA-4.0',
  );
  // A photo the layer no longer remembers is still credited to its source,
  // named in its id.
  assert.equal(streetPhotoCredit(module, 'kartaview:99'), KARTAVIEW_TEXT);
  // Without the provider's credit, its name, as the card's source line has it.
  assert.equal(
    streetPhotoCredit(streetModule(photos, {}), 'kartaview:42'),
    'KartaView · Image by mapfool',
  );
  assert.equal(streetPhotoCredit(null, 'kartaview:42'), '');
  assert.equal(streetPhotoCredit(streetModule({}, {}), 'nowhere'), '');
});

test('the layer hands out a provider’s credit as plain text, and remembers a picture’s licence', () => {
  const layer = createStreetLevelLayer({
    providers: [
      fakeStreetLevelProvider({
        id: 'kartaview',
        pickPrefix: 'kv:',
        html: KARTAVIEW_CREDIT_HTML,
      }),
    ],
  });
  assert.equal(layer.providerCredit('kartaview'), KARTAVIEW_TEXT);
  assert.equal(layer.providerCredit('nowhere'), '');
  const history = createPhotoHistory();
  const kept = history.remember({
    open: true,
    providerId: 'panoramax',
    providerName: 'Panoramax',
    imageId: '7',
    position: { lat: 48.85, lon: 2.35 },
    creator: 'someone',
    license: 'CC-BY-SA-4.0',
  });
  assert.equal(kept.license, 'CC-BY-SA-4.0');
});

function connect(cards, module, { streetOn = true } = {}) {
  const layer = {
    id: 'street-level',
    name: 'Street Level',
    enabled: streetOn,
    module,
  };
  cards.connect({
    dataManager: () => ({
      layers: new Map([[layer.id, layer]]),
      isEnabled: (id) => (id === layer.id ? layer.enabled : true),
      getAll: () => [layer],
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

test('a waiting street card credits its own still', async (t) => {
  const {
    host,
    cards,
    pinia,
    mount: go,
  } = mount(t, {
    render: () =>
      h(StreetViewHero, {
        card: {
          key: 'street-level:kartaview:42',
          layerId: 'street-level',
          identity: { layerId: 'street-level', id: 'kartaview:42' },
        },
      }),
  });
  connect(
    cards,
    streetModule({
      'kartaview:42': record({ creator: 'mapfool', license: 'CC BY-SA 4.0' }),
    }),
  );
  useStreetLevelStore(pinia).publish({
    enabled: true,
    viewer: { open: false, photo: null },
  });
  go();
  await nextTick();
  assert.equal(
    host.querySelector('.sl-hero__still img')?.getAttribute('src'),
    'https://example.org/42.jpg',
  );
  const foot = host.querySelector('.sl-hero__foot');
  assert.equal(
    foot?.querySelector('.sl-hero__credit')?.textContent,
    `${KARTAVIEW_TEXT} · Image by mapfool · CC BY-SA 4.0`,
  );
});
