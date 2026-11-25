import { readStylesheet } from './testSupport/readStylesheet.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('desktop side rails hide collapsed panels in every HUD layout, never on phones or beside Cockpit', () => {
  const right = readFileSync(
    new URL('./ui/rightPanelRail.js', import.meta.url),
    'utf8',
  );
  const left = readFileSync(
    new URL('./ui/leftPanelRail.js', import.meta.url),
    'utf8',
  );
  const css = readStylesheet(new URL('../style.css', import.meta.url));
  for (const ui of [right, left]) {
    assert.match(
      ui,
      /const isMobile = windowRef\.matchMedia\('\(max-width: 720px\)'\)\.matches/,
    );
    assert.match(
      ui,
      /if \(exclusive && panel\.classList\.contains\('collapsed'\)\)\s*panel\.setAttribute\('aria-hidden', 'true'\)/,
    );
    assert.doesNotMatch(ui, /hud\.variant === 'cyber'/);
  }
  assert.match(right, /const exclusive = !isMobile;/);
  // Cockpit keeps its collapsed Data Layers strip, which its layout aligns to.
  assert.match(
    left,
    /const exclusive =\s*!isMobile && !documentRef\?\.body\?\.classList\?\.contains\('cockpit-mode'\);/,
  );
  assert.match(
    css,
    /#right-context-rail\.layout-exclusive > \[data-panel-id\]\.collapsed \{/,
  );
  assert.match(
    css,
    /#left-panel-stack\.layout-exclusive > \[data-panel-id\]\.collapsed \{/,
  );
});

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

test('a lone panel lines up with the left column when it fits, else reaches up under the top-right row, over the rail gutter, and drops its edge switch', () => {
  const source = readFileSync(
    new URL('./ui/rightPanelRail.js', import.meta.url),
    'utf8',
  );
  // Level with the left column while nothing is docked and it fits there;
  // up under the top-right row otherwise, leaving that with a margin.
  assert.match(source, /let layout = layoutFrom\(alignedTop\);/);
  assert.match(
    source,
    /reserveNow === 0 && naturalHeight \+ margin <= layout\.maxHeight/,
  );
  assert.match(source, /if \(!fitsAligned\) layout = layoutFrom\(0\);/);
  assert.match(source, /laneRight: stackRect\.right \+ gutter/);
  const controller = readFileSync(
    new URL('./ui/panelLayoutController.js', import.meta.url),
    'utf8',
  );
  assert.match(controller, /'#gev-stories \.gs-entry'/);
  const css = readFileSync(
    new URL('./ui/styles/panel-edge.css', import.meta.url),
    'utf8',
  );
  assert.match(
    css,
    /#right-context-rail:has\(\.ui-rail--sole-open\)\s*> \.panel-collapsible:not\(\.collapsed\)\s*\.panel-header\s*\.ui-panel-edge\.panel-edge-btn \{\s*display: none;/,
  );
});
