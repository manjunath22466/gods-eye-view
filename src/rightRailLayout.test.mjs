import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('the right column keeps room under Context for the dock and the mini player', () => {
  const source = readFileSync(
    new URL('./ui/rightPanelRail.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /getPropertyValue\('--right-stack-reserve'\)/);
  assert.match(source, /const safeBottom = layout\.safeBottom - reserve;/);
  // In the column the dock is that room, not an obstacle the column stops
  // above.
  const controller = readFileSync(
    new URL('./ui/panelLayoutController.js', import.meta.url),
    'utf8',
  );
  assert.match(
    controller,
    /'\.context-corner:not\(\.context-corner--column\)'/,
  );
});
