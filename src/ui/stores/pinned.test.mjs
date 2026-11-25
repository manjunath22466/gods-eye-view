import '../../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPinia } from 'pinia';
import { createApp, nextTick } from 'vue';
import PinUndoNotice from '../views/panels/PinUndoNotice.vue';
import { usePinnedStore } from './pinned.js';

function mount(t) {
  const pinia = createPinia();
  const host = document.createElement('div');
  document.body.append(host);
  const app = createApp(PinUndoNotice);
  app.use(pinia);
  app.mount(host);
  t.after(() => {
    app.unmount();
    host.remove();
  });
  return { host, pinned: usePinnedStore(pinia) };
}

test('Undo clicked with the mouse lets the next unpin notice time out', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { host, pinned } = mount(t);
  pinned.pin({ key: 'a', kind: 'item', title: 'A' });
  pinned.pin({ key: 'b', kind: 'item', title: 'B' });
  pinned.unpin('a');
  await nextTick();
  const notice = host.querySelector('.pin-undo-notice');
  assert.ok(notice);
  // The pointer moves onto the notice and clicks Undo; the notice leaves
  // under it, so no mouseleave follows.
  notice.dispatchEvent(new window.MouseEvent('mouseenter'));
  notice.querySelector('button').click();
  await nextTick();
  assert.equal(pinned.unpinned, null);
  assert.equal(pinned.isPinned('a'), true);
  pinned.unpin('b');
  await nextTick();
  assert.ok(pinned.unpinned);
  t.mock.timers.tick(8000);
  assert.equal(pinned.unpinned, null, 'the next notice still goes');
});
