// src/ui/missionPanels.test.mjs — the Space Missions roster and selected
// mission render what the launches layer publishes (`subscribePanel()`),
// over happy-dom.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, h, nextTick } from 'vue';
import { usePinnedStore } from './stores/pinned.js';
import { useSpaceMissionsStore } from './stores/spaceMissions.js';
import MissionDetail from './views/panels/MissionDetail.vue';
import MissionRoster from './views/panels/MissionRoster.vue';
import SpaceMissionsPanel from './views/panels/SpaceMissionsPanel.vue';

function fixture(t) {
  document.body.replaceChildren();
  // The scroller that holds the Missions list.
  const scroller = document.body.appendChild(document.createElement('div'));
  scroller.setAttribute('data-rail-scroller', '');
  const host = scroller.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp({
    render: () => [h(MissionRoster), h(MissionDetail)],
  }).use(pinia);
  app.mount(host);
  t.after(() => app.unmount());
  const store = useSpaceMissionsStore(pinia);
  const calls = [];
  const record =
    (name) =>
    (...args) =>
      calls.push([name, ...args]);
  store.connect({
    selectMissionAt: record('select'),
    deselectMission: record('deselect'),
    focusSelectedLaunchSite: record('focus'),
    startSelectedReplay: record('replay'),
    toggleReplayPause: record('toggle'),
    cancelReplay: record('cancel'),
    setReplaySpeed: record('speed'),
    rosterPointerEnter: record('pointer-enter'),
    rosterPointerLeave: record('pointer-leave'),
    rosterFocus: record('focus-row'),
    rosterBlur: record('blur-row'),
  });
  const $ = (selector) => document.querySelector(selector);
  const publish = async (view) => {
    store.publish(view);
    await nextTick();
    await nextTick();
  };
  return { $, publish, calls, scroller, pinia };
}

const entry = (id, index, label = id.toUpperCase()) => ({
  index,
  id,
  color: 'rgb(1, 2, 3)',
  label,
  ariaLabel: `Select ${label}`,
  provider: 'SpaceX',
  date: '2026-11-01',
});

const roster = (entries) => ({
  count: `${entries.length} / 30D`,
  entries,
  empty: 'NONE IN WINDOW',
});

const replay = (extra = {}) => ({
  available: true,
  active: false,
  paused: false,
  toggleText: 'Ⅱ',
  toggleLabel: 'Pause replay',
  transportLabel: null,
  speed: '1',
  speedText: '1×',
  speedProgress: '20%',
  ...extra,
});

const mission = (extra = {}) => ({
  id: 'starlink-12-3',
  scrollRequest: 1,
  lat: 28.56,
  lon: -80.58,
  title: 'STARLINK 12-3',
  provider: 'SpaceX',
  status: 'Go for Launch',
  site: null,
  time: '2026-11-01T10:00:00Z',
  when: 'Nov 1, 2026, 10:00 AM UTC',
  orbit: 'LEO',
  ascent: 'ESTIMATED',
  distance: '410 KM',
  speed: '7.66 KM/S',
  speedTitle: '27,576 km/h',
  payloads: [],
  payloadsMore: null,
  stages: [],
  replay: replay(),
  ...extra,
});

test('before the layer presents, the roster loads and no mission shows', (t) => {
  const { $ } = fixture(t);
  assert.equal($('[data-mission-roster-count]').textContent, '—');
  assert.equal(
    $('.space-mission-roster-empty').textContent,
    'LOADING 30-DAY MISSION INDEX',
  );
  assert.equal($('#space-mission-panel').hidden, true);
  assert.equal($('[data-mission-replay-speed-output]').textContent, '1×');
  assert.equal($('[data-mission-replay-speed]').value, '1');
});

test('the roster lists missions and drives selection and preview', async (t) => {
  const { $, publish, calls } = fixture(t);
  await publish({
    roster: roster([entry('a', 0), entry('b', 3)]),
    mission: null,
  });
  assert.equal($('[data-mission-roster-count]').textContent, '2 / 30D');
  const [a, b] = document.querySelectorAll('.space-mission-roster-item');
  assert.equal(b.dataset.missionRosterIndex, '3');
  assert.equal(b.dataset.missionRosterId, 'b');
  assert.equal(b.getAttribute('aria-label'), 'Select B');
  assert.equal(b.querySelector('small').textContent, 'SpaceX · 2026-11-01');
  assert.equal(
    b
      .querySelector('.space-mission-roster-marker')
      .style.getPropertyValue('--mission-roster-color'),
    'rgb(1, 2, 3)',
  );
  b.click();
  b.dispatchEvent(new MouseEvent('mouseenter'));
  b.dispatchEvent(new MouseEvent('mouseleave'));
  a.dispatchEvent(new FocusEvent('blur', { relatedTarget: b }));
  a.dispatchEvent(new FocusEvent('blur', { relatedTarget: null }));
  assert.deepEqual(calls, [
    ['select', 3],
    ['pointer-enter', 3],
    ['pointer-leave'],
    ['blur-row', 3],
    ['blur-row', null],
  ]);
  await publish({ roster: roster([]), mission: null });
  assert.equal($('.space-mission-roster-empty').textContent, 'NONE IN WINDOW');
  assert.equal(
    document.querySelectorAll('.space-mission-roster-item').length,
    0,
  );
});

test('a roster refresh keeps keyboard focus and its preview on the same mission', async (t) => {
  const { publish, calls } = fixture(t);
  await publish({
    roster: roster([entry('a', 0), entry('b', 1), entry('c', 2)]),
    mission: null,
  });
  const list = document.querySelector('[data-mission-roster-list]');
  // Browsers drop focus from a node that is moved; happy-dom keeps it, so
  // any move drops it here.
  const insertBefore = list.insertBefore;
  list.insertBefore = function (node, ref) {
    if (list.contains(document.activeElement)) document.activeElement.blur();
    return insertBefore.call(this, node, ref);
  };
  document.querySelector('[data-mission-roster-id="b"]').focus();
  calls.length = 0;
  await publish({
    roster: roster([entry('b', 0), entry('c', 1), entry('a', 2)]),
    mission: null,
  });
  const focused = document.activeElement;
  assert.equal(focused?.dataset?.missionRosterId, 'b');
  assert.deepEqual(calls.at(-1), ['focus-row', 0]);
});

test('a departed focused mission continues focus beyond the list', async (t) => {
  const { publish } = fixture(t);
  await publish({
    roster: roster([entry('a', 0), entry('b', 1)]),
    mission: null,
  });
  document.querySelector('[data-mission-roster-id="b"]').focus();
  await publish({ roster: roster([entry('a', 0)]), mission: null });
  assert.equal(
    document.activeElement ===
      document.querySelector('[data-mission-roster-focus-continuation]'),
    true,
  );
});

test('the selected mission reads as an item card: map, name and status, actions, figures, folded details', async (t) => {
  const { $, publish } = fixture(t);
  await publish({ roster: null, mission: mission() });
  const panel = $('#space-mission-panel');
  assert.equal(panel.hidden, false);
  // The top image is the launch site's close-up map.
  assert.equal($('.entity-hero').dataset.hero, 'map');
  assert.notEqual($('.entity-hero .close-up-map'), null);
  assert.equal($('.close-up-map__icon').textContent, 'rocket_launch');
  assert.equal($('[data-mission-title]').textContent, 'STARLINK 12-3');
  assert.equal($('[data-mission-provider]').textContent, 'SpaceX');
  assert.equal($('[data-mission-status]').textContent, 'Go for Launch');
  assert.deepEqual(
    [...panel.querySelectorAll('.entity-card__action-row > button')].map(
      (button) => button.textContent.replace(/^[a-z_]+/, ''),
    ),
    ['Replay', 'Fly to', 'Pin'],
  );
  assert.deepEqual(
    [...panel.querySelectorAll('[data-mission-tile]')].map((tile) => [
      tile.dataset.missionTile,
      tile.querySelector('span').textContent,
      tile.querySelector('strong').textContent,
    ]),
    [
      ['time', 'Launch time', 'Nov 1, 2026, 10:00 AM UTC'],
      ['orbit', 'Orbit', 'LEO'],
      ['status', 'Status', 'Go for Launch'],
    ],
  );
  // The card has no stepping of its own: the Data Layers row steps.
  assert.equal(
    panel.querySelector('[data-mission-prev], [data-mission-next]'),
    null,
  );
  assert.equal(panel.querySelector('[data-mission-index]'), null);
  // Payloads and stages fold under More details, folded at first.
  const more = $('[data-mission-more]');
  assert.equal(more.open, false);
  assert.equal(more.querySelector('summary').textContent, 'More details');
  assert.equal($('[data-mission-site]'), null);
  assert.equal($('[data-mission-speed]').title, '27,576 km/h');
  assert.equal(
    $('[data-mission-payloads]').textContent,
    'PAYLOAD DATA UNAVAILABLE',
  );
  assert.equal($('[data-mission-stages-section]'), null);
  await publish({
    roster: null,
    mission: mission({
      site: 'SLC-40',
      distance: null,
      when: null,
      orbit: null,
      payloads: [
        {
          name: 'Sat ×2',
          detail: 'Maker · 500 KG',
          type: 'Comms',
          destination: 'GTO',
        },
      ],
      payloadsMore: '+1 additional payload records',
      stages: [
        {
          name: 'B1080',
          detail: 'FLIGHT 9',
          status: 'Landed',
          destination: 'ASOG',
          position: '28.40, -77.10 · DRONESHIP',
        },
      ],
    }),
  });
  assert.equal($('[data-mission-site]').textContent, 'SLC-40');
  assert.equal($('[data-mission-distance]'), null);
  // A missing figure drops its tile; the raw time stands in for the formatted one.
  assert.deepEqual(
    [...panel.querySelectorAll('[data-mission-tile]')].map(
      (tile) => tile.querySelector('strong').textContent,
    ),
    ['2026-11-01T10:00:00Z', 'Go for Launch'],
  );
  const rows = [...$('[data-mission-payloads]').querySelectorAll('tr')].map(
    (row) => row.textContent,
  );
  assert.deepEqual(rows, [
    'Sat ×2Maker · 500 KGCommsGTO',
    '+1 additional payload records',
  ]);
  assert.equal(
    $('[data-mission-stages]').textContent,
    'B1080FLIGHT 9LandedASOG28.40, -77.10 · DRONESHIP',
  );
  // A launch with no site position has no map and nothing to pin.
  await publish({ roster: null, mission: mission({ lat: null, lon: null }) });
  assert.equal($('.entity-hero'), null);
  assert.equal($('[data-mission-pin]'), null);
  await publish({ roster: null, mission: null });
  assert.equal(panel.hidden, true);
});

test('Pin keeps the launch site as a place on the Pinned tab', async (t) => {
  const { $, publish, pinia } = fixture(t);
  const pinned = usePinnedStore(pinia);
  await publish({ roster: null, mission: mission({ site: 'SLC-40' }) });
  const pin = $('[data-mission-pin]');
  assert.equal(pin.getAttribute('aria-pressed'), 'false');
  pin.click();
  await nextTick();
  assert.equal(pinned.pins.length, 1);
  const [entry] = pinned.pins;
  assert.equal(entry.kind, 'place');
  assert.equal(entry.title, 'SLC-40');
  assert.equal(entry.identity.layerId, 'place');
  assert.equal(entry.identity.lat, 28.56);
  assert.equal(entry.identity.lon, -80.58);
  assert.equal(pin.getAttribute('aria-pressed'), 'true');
  assert.match(pin.textContent, /Pinned$/);
  pin.click();
  await nextTick();
  assert.equal(pinned.pins.length, 0);
  assert.equal(pin.getAttribute('aria-pressed'), 'false');
});

test('the replay controls follow the layer and call its commands', async (t) => {
  const { $, publish, calls } = fixture(t);
  await publish({
    roster: null,
    mission: mission({ replay: replay({ available: false }) }),
  });
  assert.equal($('[data-mission-replay]'), null);
  assert.equal($('.mission-replay-speed-control').hidden, true);
  await publish({ roster: null, mission: mission() });
  assert.equal($('[data-mission-replay-transport]'), null);
  $('[data-mission-replay]').click();
  await publish({
    roster: null,
    mission: mission({
      replay: replay({
        active: true,
        paused: true,
        toggleText: '▶',
        toggleLabel: 'Resume replay',
        transportLabel: 'Liftoff, paused',
        speed: '2.5',
        speedText: '2.50×',
        speedProgress: '60%',
      }),
    }),
  });
  // While it runs, the replay is the top image and pause and cancel take
  // Replay's place.
  assert.equal($('.entity-hero').dataset.hero, 'replay');
  assert.match($('[data-mission-replay-hero]').textContent, /Liftoff, paused/);
  assert.match(
    $('[data-mission-replay-hero]').textContent,
    /410 KM · 7.66 KM\/S/,
  );
  assert.equal($('[data-mission-replay]'), null);
  const transport = $('[data-mission-replay-transport]');
  assert.equal(transport.classList.contains('is-paused'), true);
  assert.equal(transport.getAttribute('aria-label'), 'Liftoff, paused');
  assert.equal($('.mission-replay-speed-control').hidden, false);
  const toggle = $('[data-mission-replay-toggle]');
  assert.equal(toggle.textContent, '▶');
  assert.equal(toggle.getAttribute('aria-label'), 'Resume replay');
  const speed = $('[data-mission-replay-speed]');
  assert.equal(speed.value, '2.5');
  assert.equal(speed.style.getPropertyValue('--replay-speed-progress'), '60%');
  assert.equal($('[data-mission-replay-speed-output]').textContent, '2.50×');
  toggle.click();
  $('[data-mission-replay-cancel]').click();
  speed.value = '3';
  speed.dispatchEvent(new Event('input'));
  $('[data-mission-focus]').click();
  $('[data-mission-close]').click();
  assert.deepEqual(calls, [
    ['replay'],
    ['toggle'],
    ['cancel'],
    ['speed', 3],
    ['focus'],
    ['deselect'],
  ]);
});

test('closing from the keyboard hands focus to the mission in the roster', async (t) => {
  const { $, publish, calls } = fixture(t);
  await publish({
    roster: roster([entry('a', 0), entry('starlink-12-3', 1)]),
    mission: mission(),
  });
  const close = $('[data-mission-close]');
  close.focus();
  // A keyboard press clicks with no pointer count.
  close.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  await publish({
    roster: roster([entry('a', 0), entry('starlink-12-3', 1)]),
    mission: null,
  });
  assert.deepEqual(calls[0], ['deselect']);
  assert.equal(
    document.activeElement?.dataset?.missionRosterId,
    'starlink-12-3',
  );
  // A pointer close leaves focus where it is.
  await publish({
    roster: roster([entry('a', 0), entry('starlink-12-3', 1)]),
    mission: mission(),
  });
  close.focus();
  close.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await publish({
    roster: roster([entry('a', 0), entry('starlink-12-3', 1)]),
    mission: null,
  });
  assert.equal(document.activeElement, close);
});

test('in the panel, a keyboard close focuses the closed mission, not the first row', async (t) => {
  document.body.replaceChildren();
  const host = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp({ render: () => h(SpaceMissionsPanel) }).use(pinia);
  const store = useSpaceMissionsStore(pinia);
  const rows = roster([entry('a', 0), entry('starlink-12-3', 1)]);
  store.setEnabled(true);
  // Deselecting publishes at once, as the launches layer does.
  store.connect({
    deselectMission: () => store.publish({ roster: rows, mission: null }),
  });
  store.publish({ roster: rows, mission: mission() });
  app.mount(host);
  t.after(() => app.unmount());
  await nextTick();
  await nextTick();
  const close = document.querySelector('[data-mission-close]');
  close.focus();
  close.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
  for (let i = 0; i < 5; i += 1) await nextTick();
  assert.equal(
    document.activeElement?.dataset?.missionRosterId,
    'starlink-12-3',
  );
});

test('each newly presented selection returns the list it shows in to the top', async (t) => {
  const { publish, scroller } = fixture(t);
  scroller.scrollTop = 120;
  await publish({ roster: null, mission: mission({ scrollRequest: 4 }) });
  assert.equal(scroller.scrollTop, 0);
  scroller.scrollTop = 80;
  await publish({
    roster: null,
    mission: mission({ scrollRequest: 4, distance: '412 KM' }),
  });
  assert.equal(scroller.scrollTop, 80);
  await publish({ roster: null, mission: mission({ scrollRequest: 5 }) });
  assert.equal(scroller.scrollTop, 0);
});

test('a roster refresh lets the row under the pointer take the preview back on its next movement', async (t) => {
  const { publish, calls } = fixture(t);
  await publish({
    roster: roster([entry('a', 0), entry('b', 1)]),
    mission: null,
  });
  const row = document.querySelector('[data-mission-roster-id="a"]');
  row.dispatchEvent(new MouseEvent('mouseenter'));
  row.dispatchEvent(new MouseEvent('mousemove'));
  await publish({
    roster: roster([entry('a', 0, 'RENAMED'), entry('b', 1)]),
    mission: null,
  });
  assert.equal(
    document.querySelector('[data-mission-roster-id="a"]') === row,
    true,
  );
  row.dispatchEvent(new MouseEvent('mousemove'));
  row.dispatchEvent(new MouseEvent('mousemove'));
  assert.deepEqual(calls, [
    ['pointer-enter', 0],
    ['pointer-enter', 0],
  ]);
});

test('a layer that stops presenting returns the roster to loading and hides the mission', async (t) => {
  const { $, publish } = fixture(t);
  await publish({ roster: roster([entry('a', 0)]), mission: mission() });
  await publish({ roster: null, mission: null });
  assert.equal($('[data-mission-roster-count]').textContent, '—');
  assert.equal(
    $('.space-mission-roster-empty').textContent,
    'LOADING 30-DAY MISSION INDEX',
  );
  assert.equal($('#space-mission-panel').hidden, true);
});
