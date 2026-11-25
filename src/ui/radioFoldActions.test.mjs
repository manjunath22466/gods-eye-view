// src/ui/radioFoldActions.test.mjs — the Radio fold's controls call
// RadioControls through the radio store.
import '../testSupport/registerDom.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { useRadioStore } from './stores/radio.js';
import RadioFold from './views/panels/RadioFold.vue';

function mount(t) {
  document.body.replaceChildren();
  const pinia = createPinia();
  const calls = [];
  useRadioStore(pinia).connect(
    new Proxy(
      {},
      {
        get:
          (_, name) =>
          (...args) => {
            calls.push([name, ...args]);
            return undefined;
          },
      },
    ),
  );
  const app = createApp(RadioFold).use(pinia);
  app.mount(document.body.appendChild(document.createElement('div')));
  t.after(() => app.unmount());
  return calls;
}
const $ = (id) => document.getElementById(id);
test('the fold’s transport and volume call RadioControls', (t) => {
  const calls = mount(t);
  for (const id of [
    'radio-prev-btn',
    'radio-play-btn',
    'radio-next-btn',
    'radio-stop-btn',
  ]) {
    $(id).disabled = false;
    $(id).click();
  }
  $('radio-volume').disabled = false;
  $('radio-volume').value = '35';
  $('radio-volume').dispatchEvent(new Event('input', { bubbles: true }));
  assert.deepEqual(calls, [
    ['cycleRadio', -1],
    ['toggleRadioPlayback'],
    ['cycleRadio', 1],
    ['stopRadio'],
    ['setRadioVolume', 35],
  ]);
});
