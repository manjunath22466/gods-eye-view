// src/ui/contextCardFrame.test.mjs — the camera card's still and its bigger
// view. The camera tools live in Context's Camera settings tab, and in a
// hidden home while that tab is not shown; Context's camera card shows the
// same still, so the card keeps it refreshing whatever the tools do, and
// asks for it only while it can show it.
import '../testSupport/registerDom.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import { CctvControls } from './cctvControls.js';
import {
  placeCctvTools,
  registerCctvToolsHome,
  returnCctvToolsHome,
} from './cctvToolsPlacement.js';
import { useCctvStore } from './stores/cctv.js';
import CctvPreview from './views/panels/CctvPreview.vue';
import CctvTools from './views/panels/CctvTools.vue';

const settle = () => new Promise((r) => setTimeout(r, 0));
const camera = {
  id: 'a',
  city: 'Austin',
  name: 'Congress Ave',
  headingDeg: 91.6,
  fovDeg: 60,
  rangeM: 120.4,
  sourceLabel: 'Configured Source',
  calBadge: 'curated',
};
const stillState = (frameUrl, id = 'a') => ({
  enabled: true,
  count: 2,
  cameraIndex: [camera, { ...camera, id: 'b' }],
  activeCameraId: id,
  activeCamera: { ...camera, id, frameUrl, sourceKind: 'snapshot' },
});

/**
 * Context as the tools see it: its panel, the Camera settings tab's slot
 * while that tab shows, and the tools' hidden home; the camera card beside.
 */
function fixture(t, { card = true } = {}) {
  document.body.replaceChildren();
  const context = document.body.appendChild(document.createElement('aside'));
  context.id = 'global-context-panel';
  const tabPanel = context.appendChild(document.createElement('div'));
  tabPanel.className = 'context-camera-settings';
  const home = document.body.appendChild(document.createElement('div'));
  home.className = 'cctv-tools-home';
  home.hidden = true;
  const cardHost = document.body.appendChild(document.createElement('div'));
  const pinia = createPinia();
  const app = createApp(CctvTools).use(pinia);
  app.mount(home);
  registerCctvToolsHome(home);
  let preview;
  function mountCard() {
    preview = createApp(CctvPreview, { cameraId: 'a' }).use(pinia);
    preview.mount(cardHost);
  }
  function unmountCard() {
    preview?.unmount();
    preview = null;
  }
  if (card) mountCard();
  const store = useCctvStore(pinia);
  const controls = new CctvControls({
    elements: {
      _cctvPanel: document.getElementById('cctv-tools'),
      _cctvFrame: document.getElementById('cctv-frame'),
      _cctvFrameWrap: document.getElementById('cctv-frame-wrap'),
    },
    cctv: {},
    actions: {
      isEnabled: () => true,
      setPanelCollapsed() {},
      syncViewport() {},
    },
    store,
  });
  /** Context shows the Camera settings tab: the tools move into its slot. */
  function showTab() {
    if (!document.getElementById('cctv-tools-slot')) {
      const slot = tabPanel.appendChild(document.createElement('div'));
      slot.id = 'cctv-tools-slot';
    }
    placeCctvTools();
  }
  /** Context shows another tab (Inspect): the tools go back to their home. */
  function leaveTab() {
    returnCctvToolsHome();
    document.getElementById('cctv-tools-slot')?.remove();
  }
  t.after(() => {
    controls.destroy();
    leaveTab();
    registerCctvToolsHome(null);
    app.unmount();
    preview?.unmount();
  });
  return {
    controls,
    cardHost,
    mountCard,
    unmountCard,
    store,
    context,
    home,
    showTab,
    leaveTab,
    toolsEl: document.getElementById('cctv-tools'),
  };
}

function mockImages(t) {
  const prior = globalThis.Image;
  const requests = [];
  globalThis.Image = class {
    constructor() {
      requests.push(this);
    }
  };
  t.after(() => {
    globalThis.Image = prior;
  });
  return requests;
}

test('desktop: the Context card keeps refreshing while the Camera settings tab is not shown', async (t) => {
  const requests = mockImages(t);
  const { controls, cardHost, toolsEl, home, showTab, leaveTab, context } =
    fixture(t);
  showTab();
  assert.equal(toolsEl.closest('#cctv-tools-slot')?.id, 'cctv-tools-slot');
  controls._renderCctvState(stillState('a1.jpg'));
  assert.equal(requests.length, 1);
  requests[0].onload();
  await settle();
  await nextTick();
  assert.equal(cardHost.querySelector('img')?.getAttribute('src'), 'a1.jpg');
  // Inspect again: the tools go back to their hidden home.
  leaveTab();
  assert.equal(toolsEl.closest('.cctv-tools-home[hidden]'), home);
  await settle();
  controls._renderCctvState(stillState('a2.jpg'));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].src, 'a2.jpg');
  requests[1].onload();
  controls._renderCctvState(stillState('a3.jpg'));
  assert.equal(requests.length, 3);
  assert.equal(requests[2].src, 'a3.jpg');
  requests[2].onload();
  await settle();
  await nextTick();
  assert.equal(cardHost.querySelector('img')?.getAttribute('src'), 'a3.jpg');
  // The tab shown in a folded Context is not on screen either.
  showTab();
  context.classList.add('collapsed');
  await settle();
  controls._renderCctvState(stillState('a4.jpg'));
  assert.equal(requests.length, 4);
  assert.equal(requests[3].src, 'a4.jpg');
});

test('phone: a camera picked with the Context sheet open gets its still', async (t) => {
  const requests = mockImages(t);
  t.after(() => {
    document.body.classList.remove('mobile-shell');
    document.body.removeAttribute('data-mobile-sheet');
  });
  const { controls, cardHost, showTab } = fixture(t);
  document.body.classList.add('mobile-shell');
  document.body.setAttribute('data-mobile-sheet', 'context');
  showTab();
  controls._renderCctvState(stillState('a1.jpg'));
  controls._renderCctvState(stillState('a2.jpg'));
  await settle();
  await nextTick();
  assert.equal(
    requests.length,
    1,
    'the Context card on the Context sheet requests the still',
  );
  assert.equal(requests[0].src, 'a1.jpg');
  requests.at(-1).onload();
  await settle();
  await nextTick();
  assert.ok(
    cardHost.querySelector('.cctv-preview__expand'),
    'the card shows a frame, not Acquiring frame…',
  );
});

test('phone: the card on a closed Context sheet waits', async (t) => {
  const requests = mockImages(t);
  const { controls, toolsEl } = fixture(t);
  assert.ok(toolsEl.closest('.cctv-tools-home[hidden]'), 'the tools are home');
  document.body.classList.add('mobile-shell');
  document.body.setAttribute('data-mobile-sheet', 'layers');
  t.after(() => {
    document.body.classList.remove('mobile-shell');
    document.body.removeAttribute('data-mobile-sheet');
  });
  controls._renderCctvState(stillState('a1.jpg'));
  assert.equal(requests.length, 0);
  document.body.setAttribute('data-mobile-sheet', 'context');
  await settle();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].src, 'a1.jpg');
});

test('phone: the bigger view keeps refreshing after the layout turns phone, and stops once closed', async (t) => {
  const requests = mockImages(t);
  t.after(() => {
    document.body.classList.remove('mobile-shell');
    document.body.removeAttribute('data-mobile-sheet');
  });
  const { controls, cardHost, toolsEl } = fixture(t);
  assert.ok(toolsEl.closest('.cctv-tools-home[hidden]'), 'the tools are home');
  controls._renderCctvState(stillState('a1.jpg'));
  assert.equal(requests.length, 1);
  requests[0].onload();
  await settle();
  await nextTick();
  cardHost.querySelector('.cctv-preview__expand').click();
  await settle();
  await nextTick();
  const popup = document.body.querySelector('.cctv-popup');
  assert.ok(popup);
  assert.equal(popup.querySelector('img').getAttribute('src'), 'a1.jpg');

  document.body.classList.add('mobile-shell');
  await settle();
  controls._renderCctvState(stillState('a2.jpg'));
  await settle();
  await nextTick();
  assert.ok(document.body.contains(popup));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].src, 'a2.jpg');
  requests[1].onload();
  await settle();
  await nextTick();
  assert.equal(popup.querySelector('img').getAttribute('src'), 'a2.jpg');

  popup.querySelector('.cctv-popup__close').click();
  await settle();
  await nextTick();
  assert.equal(document.body.querySelector('.cctv-popup'), null);
  controls._renderCctvState(stillState('a3.jpg'));
  await settle();
  assert.equal(requests.length, 2);
});

test('desktop: a card that mounts asks for the still', async (t) => {
  const requests = mockImages(t);
  const { controls, toolsEl, mountCard } = fixture(t, { card: false });
  assert.ok(toolsEl.closest('.cctv-tools-home[hidden]'), 'the tools are home');
  controls._renderCctvState(stillState('a1.jpg'));
  await settle();
  assert.equal(requests.length, 0);
  mountCard();
  await settle();
  await nextTick();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].src, 'a1.jpg');
});

test('desktop: a card that unmounts stops the still, and a remount resumes it', async (t) => {
  const requests = mockImages(t);
  const { controls, toolsEl, mountCard, unmountCard, store } = fixture(t);
  assert.ok(toolsEl.closest('.cctv-tools-home[hidden]'), 'the tools are home');
  controls._renderCctvState(stillState('a1.jpg'));
  assert.equal(requests.length, 1);
  requests[0].onload();
  await settle();
  await nextTick();

  unmountCard();
  await settle();
  await nextTick();
  assert.equal(store.previewCards, 0);
  controls._renderCctvState(stillState('a2.jpg'));
  await settle();
  assert.equal(requests.length, 1);

  mountCard();
  await settle();
  await nextTick();
  assert.equal(requests.length, 2);
  assert.equal(requests[1].src, 'a2.jpg');
});

test('desktop: the bigger view is released when the card unmounts, also in the tick it closes', async (t) => {
  const requests = mockImages(t);
  const { controls, cardHost, toolsEl, mountCard, unmountCard, store } =
    fixture(t);
  assert.ok(toolsEl.closest('.cctv-tools-home[hidden]'), 'the tools are home');
  controls._renderCctvState(stillState('a1.jpg'));
  requests[0].onload();
  await settle();
  await nextTick();
  const openPopup = async () => {
    cardHost.querySelector('.cctv-preview__expand').click();
    await nextTick();
    assert.equal(store.previewPopups, 1);
  };

  await openPopup();
  unmountCard();
  await nextTick();
  assert.equal(document.body.querySelector('.cctv-popup'), null);
  assert.equal(store.previewPopups, 0);

  mountCard();
  await nextTick();
  await openPopup();
  // Closed and unmounted before the watcher runs, as when one Escape closes
  // the phone's Context sheet and the popup.
  document.body.querySelector('.cctv-popup__close').click();
  unmountCard();
  await settle();
  await nextTick();
  assert.equal(store.previewPopups, 0);
  assert.equal(store.previewCards, 0);
  const before = requests.length;
  controls._renderCctvState(stillState('a3.jpg'));
  await settle();
  assert.equal(requests.length, before);
});
