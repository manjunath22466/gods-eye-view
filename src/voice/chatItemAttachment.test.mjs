import test from 'node:test';
import assert from 'node:assert/strict';
import { bindChatAttachments } from './chatAttachments.js';

// The card's Ask icon attaches the picked item to the chat draft; nothing is
// sent until the person writes and sends.
function fakeUi() {
  const handlers = new Map();
  const state = { chat: { attachMenuOpen: false, attachments: [] } };
  const focused = [];
  return {
    state,
    focused,
    on: (name, fn) => (handlers.set(name, fn), () => handlers.delete(name)),
    emit: (name, value) => handlers.get(name)?.(value),
    update: (key, patch) => Object.assign(state[key], patch),
    focus: async (ids) => focused.push(...ids),
    element: () => null,
  };
}

test('chat-item attaches the picked item once, as data, and focuses the input', () => {
  const ui = fakeUi();
  const attachments = bindChatAttachments({
    ui,
    dataManager: null,
    onChange() {},
    setStatus() {},
  });
  ui.emit('chat-item', {
    key: 'flights:a1',
    name: 'UAL649',
    itemKind: 'aircraft',
    layer: 'Live Flights',
    lat: 30.123456,
    lon: -97.7,
  });
  ui.emit('chat-item', {
    key: 'flights:a1',
    name: 'UAL649',
    itemKind: 'aircraft',
    layer: 'Live Flights',
    lat: 30.123456,
    lon: -97.7,
  });
  assert.deepEqual(ui.state.chat.attachments, [
    { key: 'item:flights:a1', name: 'UAL649' },
  ]);
  assert.deepEqual(attachments.snapshot(), [
    {
      kind: 'map-item',
      name: 'UAL649',
      itemKind: 'aircraft',
      layer: 'Live Flights',
      lat: 30.1235,
      lon: -97.7,
    },
  ]);
  assert.deepEqual(ui.focused, ['chatInput', 'chatInput']);
});

test('an attached item’s text drops bidi and zero-width format characters', () => {
  const ui = fakeUi();
  const attachments = bindChatAttachments({
    ui,
    dataManager: null,
    onChange() {},
    setStatus() {},
  });
  ui.emit('chat-item', {
    key: 'ais:1',
    name: 'EVER\u202e\u200bGIV\u061cEN\u180e\u2066',
    itemKind: 'vessel\u200d',
    layer: 'Live\nVessels',
  });
  const [item] = attachments.snapshot();
  assert.equal(item.name, 'EVERGIVEN');
  assert.equal(item.itemKind, 'vessel');
  assert.equal(item.layer, 'Live Vessels');
});
