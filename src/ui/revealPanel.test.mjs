import assert from 'node:assert/strict';
import test from 'node:test';
import { StyleManager } from './applicationShell.js';

function reveal({
  phone,
  sheet = null,
  keepContextSheet,
  contextCollapsed = false,
  contextTab = 'view',
}) {
  const sheets = [];
  const scrolls = [];
  const panel = { scrollIntoView: (options) => scrolls.push(options) };
  const saved = globalThis.document;
  const savedMatchMedia = globalThis.matchMedia;
  const context = { id: 'global-context-panel', dataset: { contextTab } };
  globalThis.document = {
    getElementById: (id) =>
      ({ 'street-level-panel': panel, 'global-context-panel': context })[id] ??
      null,
  };
  globalThis.matchMedia = (query) => ({
    matches: phone && query === '(max-width: 720px)',
  });
  try {
    StyleManager.prototype.revealPanel.call(
      {
        _mobileShell: {
          getSheet: () => sheet,
          setSheet: (next) => sheets.push(next),
        },
        _panelChrome: { _shownPanel: () => ({ collapsed: contextCollapsed }) },
      },
      'street-level-panel',
      { keepContextSheet },
    );
  } finally {
    globalThis.document = saved;
    globalThis.matchMedia = savedMatchMedia;
  }
  return { sheets, scrolls };
}

test('revealing a panel opens its phone sheet and scrolls the panel into view', () => {
  const { sheets, scrolls } = reveal({ phone: true });
  assert.deepEqual(sheets, ['cameras']);
  // The panel sits below the sheet's first screen at 375×812.
  assert.deepEqual(scrolls, [{ block: 'nearest' }]);
});

test('revealing a panel above 720px neither opens a sheet nor scrolls the rail', () => {
  assert.deepEqual(reveal({ phone: false }), { sheets: [], scrolls: [] });
});

test('photo reveal keeps active phone Context and otherwise brings Cameras into view', () => {
  assert.deepEqual(
    reveal({ phone: true, sheet: 'context', keepContextSheet: true }),
    { sheets: [], scrolls: [] },
  );
  assert.deepEqual(
    reveal({ phone: true, sheet: 'layers', keepContextSheet: true }),
    { sheets: ['cameras'], scrolls: [{ block: 'nearest' }] },
  );
  assert.deepEqual(
    reveal({
      phone: true,
      sheet: 'context',
      keepContextSheet: true,
      contextCollapsed: true,
    }),
    { sheets: ['cameras'], scrolls: [{ block: 'nearest' }] },
  );
  assert.deepEqual(
    reveal({
      phone: true,
      sheet: 'context',
      keepContextSheet: true,
      contextTab: 'props',
    }),
    { sheets: ['cameras'], scrolls: [{ block: 'nearest' }] },
  );
  assert.deepEqual(reveal({ phone: true, sheet: 'context' }), {
    sheets: ['cameras'],
    scrolls: [{ block: 'nearest' }],
  });
});
