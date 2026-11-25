import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { useEntityCardStore } from './stores/entityCard.js';
import { _setAirportsFetchForTest } from '../data/airports.js';
import { announcePlacePick, installPlacePick } from './placePick.js';

const AIRPORTS = [
  [
    'EGLL',
    'LHR',
    'London Heathrow Airport',
    51.4707,
    -0.4599,
    'large',
    'London',
    'GB',
    83,
    2,
  ],
];
const settle = () => new Promise((resolve) => setImmediate(resolve));

function setup(t, { heldPack = false } = {}) {
  const pack = Promise.withResolvers();
  _setAirportsFetchForTest(async () => {
    if (heldPack) await pack.promise;
    return new Response(JSON.stringify({ meta: {}, rows: AIRPORTS }));
  });
  const pinia = createPinia();
  const cards = useEntityCardStore(pinia);
  const dataManager = {
    layers: new Map(),
    isEnabled: () => false,
    getAll: () => [],
    subscribe: () => () => {},
  };
  const flown = [];
  cards.connect({
    dataManager: () => dataManager,
    canFollow: () => false,
    flyTo: (card) => flown.push(card.key),
    previews: () => null,
  });
  const off = installPlacePick({ pinia, getDataManager: () => dataManager });
  t.after(() => {
    off();
    cards.connect(null);
    _setAirportsFetchForTest(null);
  });
  return { cards, flown, release: pack.resolve };
}

test('a current place pick opens its card after the airport pack loads', async (t) => {
  const { cards, release } = setup(t, { heldPack: true });
  announcePlacePick({
    name: 'Austin',
    latitude: 30.2672,
    longitude: -97.7431,
    query: 'Austin',
    isCurrent: () => true,
  });
  assert.equal(cards.card, null);
  release();
  await settle();
  assert.ok(cards.card, 'card opens');
});

test('a voice flight that already reached Heathrow opens the airport card without a second flight', async (t) => {
  const { cards, flown } = setup(t);
  announcePlacePick({
    name: 'London Heathrow Airport',
    latitude: 51.4707,
    longitude: -0.4599,
    query: 'LHR',
    framed: true,
    isCurrent: () => true,
  });
  await settle();
  assert.equal(cards.card?.place?.airport?.ident, 'EGLL');
  assert.deepEqual(
    flown,
    [],
    `card navigation started a second flight: ${JSON.stringify(flown)}`,
  );
});
