// src/ui/dockedCamera.test.mjs — the docked view says "live" only over a
// picture that moves or a frame that loaded: a video camera keeps playing its
// own stream after Cameras goes off (shared with the map while it is on, held
// by the dock after, one connection at a time), and shows only its own last
// frame, paused, when the stream cannot go on; a still camera is loading,
// live or failed as its frames load, fail or come back blank.
import '../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertSameNode } from '../testSupport/domAssert.mjs';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { useCctvStore } from './stores/cctv.js';
import { useEntityCardStore } from './stores/entityCard.js';
import { useDockedStore } from './stores/docked.js';
import {
  _setBlankFrameCheckForTest,
  _setFrameStillCaptureForTest,
} from './frameStill.js';
import { presentCctvPanel } from './cctvPresentation.js';
import DockedView from './views/panels/DockedView.vue';

const frames = () => new Promise((resolve) => setTimeout(resolve, 60));

const camera = {
  id: 'deldot-7',
  name: 'DE 7 @ VALLEY RD',
  lat: 39.7749,
  lon: -75.7154,
};
const KEY = `cctv:${camera.id}`;
const STREAM = { url: `/api/cctv/media/${camera.id}?ts=1`, feedType: 'hls' };

function decoded(video) {
  for (const [name, value] of Object.entries({
    readyState: 4,
    videoWidth: 1280,
    videoHeight: 720,
  }))
    Object.defineProperty(video, name, { value, configurable: true });
  let time = 0;
  Object.defineProperty(video, 'currentTime', {
    get: () => (time += 1),
    configurable: true,
  });
}

// Cameras with one docked camera; the layer module as the dock reads it.
function dock(
  t,
  {
    stream = STREAM,
    frameUrl = `/api/cctv/frame/${camera.id}`,
    refreshMs = 10_000,
  } = {},
) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const mapVideo = {
    readyState: 0,
    videoWidth: 0,
    videoHeight: 0,
    currentTime: 0,
  };
  const layer = { enabled: true };
  const attached = [];
  const frameReads = [];
  const module = {
    getActiveVideoElement: () => (layer.enabled ? mapVideo : null),
    streamSourceForCamera: () => stream,
    attachCameraStream(video, source, { onFailure }) {
      const hold = {
        video,
        source,
        onFailure,
        disposed: false,
        dispose: () => (hold.disposed = true),
      };
      attached.push(hold);
      return hold;
    },
    frameUrlForCamera: (id) => {
      frameReads.push(id);
      return frameUrl ? { url: frameUrl, refreshMs } : null;
    },
    cameraDetails: () => ({ refreshMs: 10_000 }),
  };
  const cards = useEntityCardStore(pinia);
  const manager = {
    layers: new Map([['cctv', { module }]]),
    isEnabled: (id) => id === 'cctv' && layer.enabled,
  };
  cards.connect({
    dataManager: () => manager,
  });
  const draws = [];
  const realGetContext = globalThis.HTMLCanvasElement.prototype.getContext;
  globalThis.HTMLCanvasElement.prototype.getContext = () => ({
    drawImage: (source) => draws.push(source),
    clearRect() {},
  });
  const kept = [];
  _setFrameStillCaptureForTest(async ({ shown }) => {
    kept.push(shown);
    return `data:image/jpeg;base64,KEPT${kept.length}`;
  });
  const cctv = useCctvStore(pinia);
  const app = createApp(DockedView).use(pinia);
  t.after(() => {
    app.unmount();
    cards.connect(null);
    _setFrameStillCaptureForTest(null);
    _setBlankFrameCheckForTest(null);
    globalThis.HTMLCanvasElement.prototype.getContext = realGetContext;
  });
  const docked = useDockedStore(pinia);
  const open = () => {
    docked.dock({
      key: KEY,
      kind: 'camera',
      title: camera.name,
      identity: { layerId: 'cctv', id: camera.id },
    });
    app.mount(document.body.appendChild(document.createElement('div')));
  };
  // Cameras on with this camera active and playing on the map, or off.
  const camerasOn = (on, { video = true } = {}) => {
    layer.enabled = on;
    const active = { id: camera.id, isVideo: video };
    cctv.publish(
      presentCctvPanel(
        on
          ? {
              enabled: true,
              count: 1,
              cameraIndex: [active],
              activeCameraId: camera.id,
              activeCamera: active,
            }
          : { enabled: false, count: 1, cameraIndex: [] },
        on,
      ),
    );
    cctv.setLive(on && video);
  };
  return {
    open,
    camerasOn,
    cctv,
    mapVideo,
    attached,
    frameReads,
    draws,
    kept,
    docked,
  };
}

const $ = (selector) => document.querySelector(selector);
const tag = () => $('.docked-view__tag')?.textContent || '';
const dot = () => $('.docked-view .feed-dot')?.dataset.state;
const wait = () => $('.docked-view .docked-view__wait')?.textContent || '';
async function settle() {
  await nextTick();
  await frames();
  await nextTick();
}

test('a docked stream camera keeps playing its own stream after Cameras goes off, never another picture', async (t) => {
  const scene = dock(t);
  scene.camerasOn(true);
  scene.open();
  await settle();
  const canvas = $('canvas.docked-view__stream');
  assert.ok(canvas, 'the stream plays in the dock');
  assert.equal(tag(), 'Docked · loading', 'not live before a frame is drawn');
  assert.equal(dot(), 'loading');
  assert.equal(wait(), 'Acquiring frame…');
  assert.equal(
    scene.attached.length,
    0,
    'shared with the map: no second connection',
  );

  decoded(scene.mapVideo);
  await settle();
  assert.equal(tag(), 'Docked · live');
  assert.equal(wait(), '');
  assert.ok(
    scene.draws.length > 0 &&
      scene.draws.every((source) => source === scene.mapVideo),
  );

  // Cameras off: the map lets its decoder go; the dock holds the stream.
  scene.camerasOn(false);
  await settle();
  assert.equal(scene.attached.length, 1, 'one connection of its own');
  assert.deepEqual(scene.attached[0].source, STREAM);
  assertSameNode(
    $('canvas.docked-view__stream'),
    canvas,
    'the same canvas, its last frame kept',
  );
  assertSameNode($('.docked-view img'), null, 'no other picture');
  assert.equal(
    tag(),
    'Docked · loading',
    'loading again, not live over a held frame',
  );
  assert.equal(wait(), '', 'its last frame stays drawn meanwhile');

  decoded(scene.attached[0].video);
  const before = scene.draws.length;
  await settle();
  assert.ok(
    scene.draws.length > before &&
      scene.draws
        .slice(before)
        .every((source) => source === scene.attached[0].video),
  );
  assert.equal(tag(), 'Docked · live');
  assert.deepEqual(
    scene.frameReads,
    [],
    'its frame URL (another picture altogether) is never read',
  );

  // Clear all, a later tick: still the one hold, still live.
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(scene.attached.length, 1);
  assert.equal(scene.attached[0].disposed, false);
  assert.equal(tag(), 'Docked · live');

  // Cameras back on: the map's decoder again, and the dock lets its own go.
  scene.camerasOn(true);
  await settle();
  assert.equal(scene.attached[0].disposed, true, 'never two connections');

  // Closing the dock releases everything.
  scene.camerasOn(false);
  await settle();
  assert.equal(scene.attached.length, 2);
  scene.docked.close();
  await settle();
  assert.equal(scene.attached[1].disposed, true, 'released with the dock');
});

test('a docked stream that cannot go on shows only its own last frame, paused', async (t) => {
  const scene = dock(t);
  scene.camerasOn(true);
  scene.open();
  decoded(scene.mapVideo);
  await settle();
  await settle();
  assert.equal(scene.kept.length, 1, 'its drawn frame is kept');
  scene.camerasOn(false);
  await settle();
  scene.attached[0].onFailure();
  await settle();
  assertSameNode($('canvas.docked-view__stream'), null, 'no stream left');
  assert.equal(
    $('.docked-view img')?.getAttribute('src'),
    'data:image/jpeg;base64,KEPT1',
    'that camera’s own last frame',
  );
  assert.equal(tag(), 'Docked · paused');
  assert.equal(dot(), 'paused');
  assert.deepEqual(scene.frameReads, [], 'never another source');
});

test('a docked still camera is live only once a real frame has loaded', async (t) => {
  const scene = dock(t, { stream: null });
  scene.camerasOn(true, { video: false });
  scene.open();
  await settle();
  const frame = $('.docked-view__frame');
  assert.ok(frame, 'the 16:9 box is there before the first frame');
  const image = $('.docked-view img');
  assert.equal(image.getAttribute('src'), `/api/cctv/frame/${camera.id}`);
  assert.equal(tag(), 'Docked · loading');
  assert.equal(dot(), 'loading');
  assert.equal(wait(), 'Acquiring frame…');

  image.dispatchEvent(new Event('load'));
  await settle();
  assert.equal(tag(), 'Docked · live');
  assert.equal(dot(), 'live');
  assert.equal(wait(), '');

  // An upstream that answers with an error, or a black frame (rate limited).
  image.dispatchEvent(new Event('error'));
  await settle();
  assert.equal(tag(), 'Docked · frame unavailable');
  assert.equal(dot(), 'lost');
  assert.equal(wait(), 'Frame unavailable');
  _setBlankFrameCheckForTest(() => true);
  const keptBefore = scene.kept.length;
  image.dispatchEvent(new Event('load'));
  await settle();
  assert.equal(
    tag(),
    'Docked · frame unavailable',
    'a black frame is not live',
  );
  assert.equal(scene.kept.length, keptBefore, 'and is never kept for the pin');
  _setBlankFrameCheckForTest(() => false);
  image.dispatchEvent(new Event('load'));
  await settle();
  assert.equal(tag(), 'Docked · live');
});

test('the dock publishes what it says, so a stalled stream is never live on its pin or card', async (t) => {
  // A clock the test moves, read by the dock's painter.
  let clock = 0;
  const realFrame = globalThis.requestAnimationFrame;
  const realCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (paint) =>
    setTimeout(() => paint((clock += 16)), 5);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
  t.after(() => {
    globalThis.requestAnimationFrame = realFrame;
    globalThis.cancelAnimationFrame = realCancel;
  });
  const scene = dock(t);
  scene.camerasOn(true);
  scene.open();
  await settle();
  const published = () => scene.docked.feedOf(KEY);
  assert.deepEqual(
    { ...published() },
    { key: KEY, dot: 'loading', text: 'Docked · loading' },
  );

  decoded(scene.mapVideo);
  await settle();
  assert.equal(tag(), 'Docked · live');
  assert.deepEqual(
    { ...published() },
    { key: KEY, dot: 'live', text: 'Docked · live' },
  );

  // The decoder stops giving new frames: past the stall time it is stalled.
  Object.defineProperty(scene.mapVideo, 'currentTime', {
    value: 1,
    configurable: true,
  });
  await settle();
  clock += 20_000;
  await settle();
  assert.equal(tag(), 'Docked · stalled');
  assert.equal(dot(), 'paused');
  assert.deepEqual(
    { ...published() },
    { key: KEY, dot: 'paused', text: 'Docked · stalled' },
  );

  // Its own hold fails once Cameras is off: paused on its last frame.
  scene.camerasOn(false);
  await settle();
  scene.attached[0].onFailure();
  await settle();
  assert.equal(tag(), 'Docked · paused');
  assert.equal(published().dot, 'paused');
  assert.equal(published().text, 'Docked · paused');

  // Closed: nothing is published for it.
  scene.docked.close();
  await settle();
  assert.equal(scene.docked.feedOf(KEY), null);
});

test('while Context is the full-height column the dock is hidden and paused, and shrinking brings it back live', async (t) => {
  const scene = dock(t);
  scene.camerasOn(false);
  scene.open();
  await settle();
  decoded(scene.attached[0].video);
  await settle();
  assert.equal(tag(), 'Docked · live');
  const view = $('.docked-view');

  // Expanded: hidden, its own stream let go, nothing painted.
  scene.docked.setStowed(true);
  await settle();
  assert.equal(view.style.display, 'none', 'hidden');
  assert.equal(scene.attached[0].disposed, true, 'no stream of its own');
  const draws = scene.draws.length;
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(scene.draws.length, draws, 'no painting');
  assert.equal(scene.attached.length, 1, 'no new hold while hidden');
  assert.deepEqual(scene.frameReads, []);
  assert.equal(scene.docked.feedOf(KEY).text, 'Docked · paused');

  // Shrunk: shown, and the stream held and painted again.
  scene.docked.setStowed(false);
  await settle();
  assert.equal(view.style.display, '', 'shown again');
  assert.equal(scene.attached.length, 2, 'its stream held again');
  decoded(scene.attached[1].video);
  await settle();
  assert.ok(scene.draws.length > draws, 'painted again');
  assert.equal(tag(), 'Docked · live');
});

test('a docked still camera reads no frame while hidden under the column, and reads one when shown', async (t) => {
  const scene = dock(t, { stream: null });
  scene.camerasOn(false, { video: false });
  scene.open();
  await settle();
  const reads = scene.frameReads.length;
  assert.ok(reads > 0, 'read while shown');
  scene.docked.setStowed(true);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(scene.frameReads.length, reads, 'no frame request while hidden');
  scene.docked.setStowed(false);
  await settle();
  assert.equal(scene.frameReads.length, reads + 1, 'read again at once');
});

test('a still camera docked from its card shows the card’s frame first, then reads its own on its interval', async (t) => {
  const scene = dock(t, { stream: null, refreshMs: 0 });
  // The card showed a frame, then docking took its preview away.
  scene.cctv.setFrame({ cameraId: camera.id, src: '/card/last-frame.jpg' });
  scene.camerasOn(false, { video: false });
  scene.open();
  await settle();
  assert.equal(
    $('.docked-view img')?.getAttribute('src'),
    '/card/last-frame.jpg',
    'the card’s frame at once',
  );
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.ok(scene.frameReads.length > 0, 'the dock asks for a fresh frame');
  assert.equal(
    $('.docked-view img')?.getAttribute('src'),
    `/api/cctv/frame/${camera.id}`,
    'and shows it, not the card’s old one',
  );
});

test('a docked still camera reads no frame while the page is hidden, and reads one on return', async (t) => {
  const setHidden = (hidden) => {
    Object.defineProperty(document, 'hidden', {
      value: hidden,
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
  };
  t.after(() => setHidden(false));
  const scene = dock(t, { stream: null });
  scene.camerasOn(false, { video: false });
  scene.open();
  await settle();
  const reads = scene.frameReads.length;
  assert.ok(reads > 0, 'read while shown');
  setHidden(true);
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(
    scene.frameReads.length,
    reads,
    'no frame request in a background tab',
  );
  setHidden(false);
  await settle();
  assert.equal(scene.frameReads.length, reads + 1, 'read again at once');
});

for (const mode of ['cockpit-mode', 'ui-clean-view', 'recording-mode']) {
  test(`while ${mode} hides the corner the dock holds no stream, paints nothing and reads nothing`, async (t) => {
    t.after(() => document.body.classList.remove(mode));
    const scene = dock(t);
    scene.camerasOn(false);
    scene.open();
    await settle();
    decoded(scene.attached[0].video);
    await settle();
    assert.equal(tag(), 'Docked · live');

    document.body.classList.add(mode);
    await settle();
    assert.equal(scene.attached[0].disposed, true, 'its stream let go');
    const draws = scene.draws.length;
    await new Promise((resolve) => setTimeout(resolve, 2100));
    await settle();
    assert.equal(scene.draws.length, draws, 'no painting');
    assert.equal(scene.attached.length, 1, 'no new hold while hidden');
    assert.deepEqual(scene.frameReads, []);
    assert.equal(scene.docked.feedOf(KEY).text, 'Docked · paused');

    document.body.classList.remove(mode);
    await settle();
    assert.equal(scene.attached.length, 2, 'its stream held again');
    decoded(scene.attached[1].video);
    await settle();
    assert.ok(scene.draws.length > draws, 'painted again');
    assert.equal(tag(), 'Docked · live');
  });
}

test('a docked still camera reads no frame while clean view hides the corner', async (t) => {
  t.after(() => document.body.classList.remove('ui-clean-view'));
  const scene = dock(t, { stream: null });
  scene.camerasOn(false, { video: false });
  scene.open();
  await settle();
  const reads = scene.frameReads.length;
  document.body.classList.add('ui-clean-view');
  await new Promise((resolve) => setTimeout(resolve, 2100));
  await settle();
  assert.equal(scene.frameReads.length, reads, 'no frame request while hidden');
  document.body.classList.remove('ui-clean-view');
  await settle();
  assert.equal(scene.frameReads.length, reads + 1, 'read again at once');
});

test('docking another camera over a playing one never keeps the first camera’s frame as its still', async (t) => {
  const scene = dock(t);
  scene.camerasOn(true);
  scene.open();
  decoded(scene.mapVideo);
  await settle();
  await settle();
  assert.equal(scene.kept.length, 1, 'the first camera’s frame is kept');

  const OTHER = 'cctv:deldot-8';
  scene.docked.dock({
    key: OTHER,
    kind: 'camera',
    title: 'DE 8',
    identity: { layerId: 'cctv', id: 'deldot-8' },
  });
  await settle();
  assert.equal(scene.kept.length, 1, 'nothing kept before its own frame');
  assert.ok(!scene.docked.lastStillOf(OTHER), 'no still of another camera');

  decoded(scene.attached[0].video);
  await settle();
  await settle();
  assert.equal(scene.kept.length, 2, 'its own first frame is kept');
  assert.ok(scene.docked.lastStillOf(OTHER));
});

test('closing the dock while Context is folded moves focus to Context’s fold button', async (t) => {
  const scene = dock(t, { stream: null });
  const panel = document.body.appendChild(document.createElement('section'));
  panel.id = 'global-context-panel';
  panel.className = 'collapsed';
  const body = panel.appendChild(document.createElement('div'));
  body.className = 'cyber-panel-body';
  body.tabIndex = -1;
  const fold = panel.appendChild(document.createElement('button'));
  fold.className = 'panel-collapse-btn';
  fold.dataset.collapseTarget = 'global-context-panel';
  scene.camerasOn(false, { video: false });
  scene.open();
  await settle();
  $('[aria-label="Close the docked view"]').click();
  await settle();
  assertSameNode(
    document.activeElement,
    fold,
    'focus stays on something shown',
  );

  // Unfolded, its body takes focus as before.
  panel.className = '';
  scene.docked.dock({
    key: KEY,
    kind: 'camera',
    title: camera.name,
    identity: { layerId: 'cctv', id: camera.id },
  });
  await settle();
  $('[aria-label="Close the docked view"]').click();
  await settle();
  assertSameNode(document.activeElement, body);
});
