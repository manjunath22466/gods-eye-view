// src/ui/contextLists.test.mjs — layers with a list of their own (Space
// Missions, Weather, News, Recent Imagery) as tabs in Context while they
// are on, over happy-dom. With two or more on, they share the Lists tab
// with a sub-tab each.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import ContextView from './views/ContextView.vue';
import { useEntityCardStore } from './stores/entityCard.js';
import { usePanelChromeStore } from './stores/panelChrome.js';
import { usePinnedStore } from './stores/pinned.js';
import { useSpaceMissionsStore } from './stores/spaceMissions.js';
import {
  contextListsActive,
  listsOn,
  resetContextLists,
  setContextListPresence,
  showContextList,
  shownList,
} from './contextLists.js';
import { createGevActionRunner } from '../voice/gevActions.js';

const flight = (id) => ({
  id,
  icao24: id,
  callsign: id.toUpperCase(),
  lat: 30.3,
  lon: -97.7,
  altitudeM: 2500,
});

function fixture(t) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('', { status: 503 });
  resetContextLists();
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp(ContextView).use(pinia);
  app.mount(host);
  const cards = useEntityCardStore(pinia);
  const chrome = usePanelChromeStore(pinia);
  const owner = chrome.connect({});
  const rows = [
    {
      id: 'flights',
      name: 'Live Flights',
      enabled: true,
      records: [flight('test01')],
      stats: { count: 1, lastUpdate: Date.now() },
      module: { getAnalystRecords: () => [flight('test01')] },
    },
  ];
  // The data manager's layer changes: a test announces a layer turned on.
  const listeners = new Set();
  const turnOn = (layerId, origin = 'user') =>
    listeners.forEach((listener) =>
      listener({ type: 'visibility', layerId, enabled: true, origin }),
    );
  const manager = {
    layers: new Map(rows.map((row) => [row.id, row])),
    isEnabled: (id) => rows.some((row) => row.id === id && row.enabled),
    getAll: () => rows,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
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
  t.after(() => {
    cards.connect(null);
    chrome.detach(owner);
    app.unmount();
    resetContextLists();
    globalThis.fetch = realFetch;
  });
  const open = (yes = true) =>
    chrome.publish(owner, 'global-context-panel', { collapsed: !yes });
  open();
  const missions = useSpaceMissionsStore(pinia);
  const $ = (selector) => document.querySelector(selector);
  const shown = (selector) => {
    const node = $(selector);
    return Boolean(node) && node.closest('[style*="display: none"]') === null;
  };
  const tabs = () =>
    [
      ...document.querySelectorAll(
        '#context-body > [role="tablist"] [role="tab"]',
      ),
    ].map((tab) => tab.id);
  return { $, shown, tabs, cards, pinia, missions, open, turnOn };
}

const roster = (count) => ({
  count: String(count),
  entries: Array.from({ length: count }, (_, index) => ({
    id: `L${index}`,
    index,
    label: `Mission ${index}`,
    provider: 'Rocket Lab',
    date: '18 Nov',
    color: '#fff',
    ariaLabel: `Mission ${index}`,
  })),
});

test('the list helpers keep tab order and fall back to the first list that is on', () => {
  const presence = { news: { count: 30 }, 'space-missions': { count: 12 } };
  const lists = listsOn(presence);
  assert.deepEqual(
    lists.map(({ id, count }) => [id, count]),
    [
      ['space-missions', 12],
      ['news', 30],
    ],
  );
  assert.equal(shownList(lists, 'news'), 'news');
  assert.equal(shownList(lists, 'weather'), 'space-missions');
  assert.equal(shownList([], 'news'), '');
});

test('with Weather on too, Space Missions is a Lists sub-tab; turned off, Lists moves on and focus follows', async (t) => {
  const { $, shown, tabs, missions, turnOn } = fixture(t);
  turnOn('rocket-launches');
  missions.setEnabled(true);
  missions.publish({ roster: roster(12), mission: null });
  await nextTick();
  turnOn('wind');
  setContextListPresence('weather', { count: 3 });
  setContextListPresence('news', { count: 30 });
  await nextTick();
  await nextTick();
  assert.deepEqual(tabs(), ['context-tab-inspect', 'context-tab-lists']);
  assert.equal($('#context-tab-lists').textContent.trim(), 'Lists');
  const subTabs = () =>
    [...document.querySelectorAll('.context-list-tabs [role="tab"]')].map(
      (tab) => tab.textContent.trim(),
    );
  assert.deepEqual(subTabs(), [
    'Space Missions · 12',
    'Weather · 3',
    'News · 30',
  ]);
  // Weather, turned on last, shows.
  assert.equal(shown('#context-list-weather'), true);
  assert.equal(shown('#context-list-space-missions'), false);

  $('#context-list-tab-space-missions').click();
  await nextTick();
  assert.equal(
    $('#context-list-tab-space-missions').getAttribute('aria-selected'),
    'true',
  );
  assert.equal(shown('#context-list-space-missions'), true);
  assert.equal(shown('#context-list-weather'), false);

  // Missions going off while it shows: Lists moves to the next list, and
  // focus on its sub-tab moves to that list's sub-tab.
  $('#context-list-tab-space-missions').focus();
  missions.setEnabled(false);
  await nextTick();
  await nextTick();
  assert.deepEqual(tabs(), ['context-tab-inspect', 'context-tab-lists']);
  assert.equal(contextListsActive.value, true);
  assert.equal($('#context-list-tab-space-missions'), null);
  assert.equal(
    $('#context-list-tab-weather').getAttribute('aria-selected'),
    'true',
  );
  assert.equal(document.activeElement?.id, 'context-list-tab-weather');
});

test('with one other list left, focus in the Missions list moves to the Lists tab', async (t) => {
  const { $, shown, missions, turnOn } = fixture(t);
  turnOn('rocket-launches');
  missions.setEnabled(true);
  missions.publish({ roster: roster(2), mission: null });
  setContextListPresence('weather', { count: 3 });
  await nextTick();
  await nextTick();
  $('#context-list-tab-space-missions').click();
  await nextTick();
  const inside = $('#context-list-space-missions').appendChild(
    document.createElement('button'),
  );
  inside.focus();
  missions.setEnabled(false);
  await nextTick();
  await nextTick();
  assert.equal(Boolean($('.context-list-tabs')), false);
  assert.equal($('#context-tab-lists').textContent.trim(), 'Weather · 3');
  assert.equal(shown('#context-list-weather'), true);
  assert.equal(document.activeElement?.id, 'context-tab-lists');
});

test('turning News off with Weather left moves focus from its sub-tab to the Lists tab', async (t) => {
  const { $, shown } = fixture(t);
  setContextListPresence('weather', { count: 3 });
  setContextListPresence('news', { count: 30 });
  showContextList('news');
  await nextTick();
  await nextTick();
  $('#context-list-tab-news').focus();
  setContextListPresence('news', null);
  await nextTick();
  await nextTick();
  assert.equal($('#context-list-tab-news'), null);
  assert.equal($('#context-tab-lists').textContent.trim(), 'Weather · 3');
  assert.equal(shown('#context-list-weather'), true);
  assert.equal(document.activeElement?.id, 'context-tab-lists');
});

test('focus on the surviving list moves to the Lists tab when the strip goes', async (t) => {
  const { $ } = fixture(t);
  setContextListPresence('weather', { count: 3 });
  setContextListPresence('news', { count: 30 });
  showContextList('weather');
  await nextTick();
  $('#context-list-tab-weather').focus();
  setContextListPresence('news', null);
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement?.id, 'context-tab-lists');
});

test('turning News off with focus in its list moves focus to the Lists tab', async (t) => {
  const { $ } = fixture(t);
  setContextListPresence('weather', { count: 3 });
  setContextListPresence('news', { count: 30 });
  showContextList('news');
  await nextTick();
  await nextTick();
  const inside = $('#news-panel-body').appendChild(
    document.createElement('button'),
  );
  assert.ok(
    inside.closest('#context-list-news'),
    'the readout shows in Context',
  );
  inside.focus();
  setContextListPresence('news', null);
  await nextTick();
  await nextTick();
  assert.equal(document.activeElement?.id, 'context-tab-lists');
});

test('with two lists left, focus on a sub-tab that goes moves to the sub-tab that shows', async (t) => {
  const { $ } = fixture(t);
  setContextListPresence('weather', { count: 3 });
  setContextListPresence('news', { count: 30 });
  setContextListPresence('recent-imagery', { count: 2 });
  showContextList('news');
  await nextTick();
  await nextTick();
  $('#context-list-tab-news').focus();
  setContextListPresence('news', null);
  await nextTick();
  await nextTick();
  assert.equal(
    $('#context-list-tab-weather').getAttribute('aria-selected'),
    'true',
  );
  assert.equal(document.activeElement?.id, 'context-list-tab-weather');
});

test('opening a pin from the keyboard moves focus to its card', async (t) => {
  const { $, cards, pinia } = fixture(t);
  const pinned = usePinnedStore(pinia);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await nextTick();
  $('.entity-card__action--pin').click();
  pinned.show('pinned');
  await nextTick();
  const tile = $('.pinned-grid__open');
  tile.focus();
  tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await nextTick();
  await nextTick();
  assert.equal($('.pinned-grid'), null, 'Inspect replaced the grid');
  assert.ok(
    document.activeElement?.closest('#entity-card'),
    `focus is in the card, not on ${document.activeElement?.tagName}`,
  );
});

test('arrow keys walk the main tabs in order: Inspect, Lists, Pinned; and Lists sub-tabs in theirs', async (t) => {
  const { $, cards, pinia, missions, turnOn } = fixture(t);
  const pinned = usePinnedStore(pinia);
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await nextTick();
  $('.entity-card__action--pin').click();
  await nextTick();
  turnOn('rocket-launches', 'share-link');
  missions.setEnabled(true);
  missions.publish({ roster: roster(4), mission: null });
  setContextListPresence('weather', { count: 3 });
  await nextTick();
  await nextTick();
  const ids = () =>
    [
      ...document.querySelectorAll(
        '#context-body > [role="tablist"] [role="tab"]',
      ),
    ].map((tab) => tab.id);
  assert.deepEqual(ids(), [
    'context-tab-inspect',
    'context-tab-lists',
    'context-tab-pinned',
  ]);
  // A link turning Space Missions on adds its sub-tab without taking
  // Context over.
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  const selected = () =>
    [
      ...document.querySelectorAll(
        '#context-body [role="tab"][aria-selected="true"]',
      ),
    ]
      .filter((tab) => tab.closest('.context-pin-tabs--main'))
      .map((tab) => tab.id);
  const key = (id, name) =>
    document
      .getElementById(id)
      .dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      );
  const walk = [];
  for (let step = 0; step < 3; step += 1) {
    key(selected()[0], 'ArrowRight');
    await nextTick();
    walk.push(selected()[0]);
  }
  assert.deepEqual(walk, [
    'context-tab-lists',
    'context-tab-pinned',
    'context-tab-pinned',
  ]);
  assert.equal(pinned.tab, 'pinned');
  key(selected()[0], 'ArrowLeft');
  await nextTick();
  assert.deepEqual(selected(), ['context-tab-lists']);
  // Exactly one tab in the row is reachable with Tab.
  assert.deepEqual(
    [
      ...document.querySelectorAll(
        '.context-pin-tabs--main [role="tab"][tabindex="0"]',
      ),
    ].map((tab) => tab.id),
    ['context-tab-lists'],
  );
  // Esc on the Lists tab leaves the card that Inspect holds.
  key('context-tab-lists', 'Escape');
  await nextTick();
  assert.ok(cards.card, 'the card is kept');
  assert.deepEqual(selected(), ['context-tab-lists']);
  // The sub-tabs: Missions, then Weather.
  showContextList('space-missions');
  await nextTick();
  key('context-list-tab-space-missions', 'ArrowRight');
  await nextTick();
  await nextTick();
  assert.equal(
    $('#context-list-tab-weather').getAttribute('aria-selected'),
    'true',
  );
  assert.equal(document.activeElement?.id, 'context-list-tab-weather');
  key('context-tab-lists', 'Home');
  await nextTick();
  assert.deepEqual(selected(), ['context-tab-inspect']);
  key('context-tab-inspect', 'End');
  await nextTick();
  assert.deepEqual(selected(), ['context-tab-pinned']);
});

test('voice set_context_mode space-missions selects Missions inside Lists', async (t) => {
  const { $, missions, turnOn } = fixture(t);
  setContextListPresence('weather', { count: 3 });
  showContextList('weather');
  await nextTick();
  assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
  let on = false;
  const canvas = { addEventListener() {}, removeEventListener() {} };
  const runner = createGevActionRunner({
    viewer: {
      clock: { onTick: { addEventListener: () => () => {} } },
      canvas,
      scene: { canvas },
      camera: { moveEnd: { addEventListener() {} } },
    },
    styleManager: {
      getContextModeState: () => ({ mode: null, active: false }),
      getCockpitState: () => ({ active: false }),
      setPanelCollapsed() {},
      async setContextMode(mode) {
        return { ok: true, mode };
      },
    },
    dataManager: {
      layers: new Map([
        [
          'rocket-launches',
          { module: { id: 'rocket-launches', name: 'Space Missions' } },
        ],
      ]),
      getAll: () => [
        { id: 'rocket-launches', name: 'Space Missions', enabled: on },
      ],
      isEnabled: (id) => id === 'rocket-launches' && on,
      async setEnabled(id, enabled) {
        on = enabled;
        turnOn(id, 'voice');
        missions.setEnabled(enabled);
        missions.publish({ roster: roster(5), mission: null });
        return true;
      },
    },
  });
  const result = await runner('set_context_mode', { mode: 'space-missions' });
  await nextTick();
  await nextTick();
  assert.equal(result.ok, true);
  assert.equal(result.listShown, true);
  assert.equal(
    $('#context-list-tab-space-missions').getAttribute('aria-selected'),
    'true',
  );
  assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
  assert.equal(
    $('#context-list-tab-space-missions').textContent.trim(),
    'Space Missions · 5',
  );
});

test('a pick, a pin and Pinned leave the list tab; its tab sits between Inspect and Pinned', async (t) => {
  const { $, tabs, cards, pinia, turnOn } = fixture(t);
  const pinned = usePinnedStore(pinia);
  turnOn('wind');
  setContextListPresence('weather', { count: 3 });
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, true);
  assert.match($('#context-tab-lists').textContent, /Weather · 3/);

  // A new pick shows its card on Inspect.
  cards.select({ layerId: 'flights', id: 'test01' }, { follow: false });
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, false);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  assert.ok($('#entity-card'));

  $('.entity-card__action--pin').click();
  await nextTick();
  assert.deepEqual(tabs(), [
    'context-tab-inspect',
    'context-tab-lists',
    'context-tab-pinned',
  ]);
  showContextList('weather');
  await nextTick();
  assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
  // End goes to Pinned.
  $('#context-tab-lists').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'End', bubbles: true }),
  );
  await nextTick();
  assert.equal(pinned.tab, 'pinned');
  assert.equal(contextListsActive.value, false);
  assert.equal($('#context-tab-pinned').getAttribute('aria-selected'), 'true');
  // And back, one step left, to the list.
  $('#context-tab-pinned').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
  );
  await nextTick();
  assert.equal($('#context-tab-lists').getAttribute('aria-selected'), 'true');
});

test('the list bodies stay in the page while Context is closed, for their readouts', async (t) => {
  const { $, open } = fixture(t);
  open(false);
  await nextTick();
  for (const id of [
    'space-mission-panel-host',
    'weather-panel-body',
    'news-panel-body',
    'recent-imagery-panel-body',
  ])
    assert.ok($(`#${id}`), id);
  assert.equal(
    Boolean($('#context-body')),
    false,
    'closed, Context reads nothing',
  );
  // No right-rail panel of their own.
  for (const id of [
    'space-missions-panel',
    'weather-panel',
    'news-panel',
    'recent-imagery-panel',
  ])
    assert.equal($(`#${id}`), null, id);
});

test('a list layer a link or a restore turns on adds its tab but does not take Context over', async (t) => {
  const { $, tabs, turnOn } = fixture(t);
  await nextTick();
  // A share link or a restore turns News on: its tab appears, Inspect stays.
  turnOn('news', 'share-link');
  setContextListPresence('news', { count: 30 });
  await nextTick();
  await nextTick();
  assert.deepEqual(tabs(), ['context-tab-inspect', 'context-tab-lists']);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  assert.equal(contextListsActive.value, false);
  // A restore bringing Weather back is not a person's choice either.
  turnOn('wind', 'restore');
  setContextListPresence('weather', { count: 3 });
  await nextTick();
  assert.equal(contextListsActive.value, false);
  // A person turning Imagery on shows its list.
  turnOn('recent-imagery', 'user');
  setContextListPresence('recent-imagery', { count: 9 });
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, true);
});

test('every list tab names its count, or with nothing to count, why', async (t) => {
  const { $, turnOn } = fixture(t);
  turnOn('recent-imagery');
  setContextListPresence('recent-imagery', { count: null, reason: 'no area' });
  await nextTick();
  await nextTick();
  assert.equal($('#context-tab-lists').textContent.trim(), 'Imagery · no area');
  setContextListPresence('recent-imagery', { count: 4 });
  await nextTick();
  assert.equal($('#context-tab-lists').textContent.trim(), 'Imagery · 4');
});

test('turning Cameras on leaves Inspect open without adding a Cameras tab', async (t) => {
  const { $, turnOn } = fixture(t);
  turnOn('cctv');
  await nextTick();
  assert.equal($('#context-tab-lists'), null);
  assert.ok($('.view-context'));
});

test('with its last list gone, the list tab does not come back for a quiet or restored list', async (t) => {
  const { $, pinia, turnOn } = fixture(t);
  const pinned = usePinnedStore(pinia);
  pinned.pin({
    key: 'flights:test01',
    kind: 'item',
    title: 'TEST01',
    icon: 'flight',
    identity: { layerId: 'flights', id: 'test01' },
  });
  pinned.show('pinned');
  await nextTick();
  assert.equal($('#context-tab-pinned').getAttribute('aria-selected'), 'true');
  turnOn('wind');
  setContextListPresence('weather', { count: 3 });
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, true);
  // Weather goes off: no list is on.
  setContextListPresence('weather', null);
  await nextTick();
  assert.equal(contextListsActive.value, false);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  // Cameras turned on later stay quiet.
  turnOn('cctv');
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, false);
  assert.equal($('#context-tab-inspect').getAttribute('aria-selected'), 'true');
  // As does a list a share link restores.
  turnOn('rocket-launches', 'share-link');
  setContextListPresence('space-missions', { count: 4 });
  await nextTick();
  await nextTick();
  assert.equal(contextListsActive.value, false);
});

test('restoring a recently enabled list does not reuse the earlier user choice', async (t) => {
  const { turnOn } = fixture(t);
  turnOn('news', 'user');
  setContextListPresence('news', { count: 30 });
  await nextTick();
  assert.equal(contextListsActive.value, true);
  setContextListPresence('news', null);
  await nextTick();
  assert.equal(contextListsActive.value, false);
  turnOn('news', 'share-link');
  setContextListPresence('news', { count: 30 });
  await nextTick();
  assert.equal(
    contextListsActive.value,
    false,
    'restoration leaves Inspect selected',
  );
});

test('restoring a list leaves the visible fallback selected', async (t) => {
  const { $, turnOn } = fixture(t);
  setContextListPresence('weather', { count: 4 });
  await nextTick();
  turnOn('news', 'user');
  setContextListPresence('news', { count: 30 });
  await nextTick();
  assert.equal(
    $('#context-list-tab-news').getAttribute('aria-selected'),
    'true',
  );

  setContextListPresence('news', null);
  await nextTick();
  turnOn('news', 'share-link');
  setContextListPresence('news', { count: 30 });
  await nextTick();
  assert.equal(
    $('#context-list-tab-weather').getAttribute('aria-selected'),
    'true',
  );
});
