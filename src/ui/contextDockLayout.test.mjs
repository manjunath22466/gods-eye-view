// The expanded Context column starts below the top-right row, so the
// Stories button and the ACTIVE STYLE readout never draw over its header.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const px = (css, pattern, what) => {
  const found = css.match(pattern);
  assert.ok(found, `${what} is set`);
  return Number(found[1]);
};

test('the expanded Context column starts below the Stories button and the style readout', () => {
  const dock = read('./styles/context-dock.css');
  const foundation = read('./styles/foundation.css');
  const stories = read('./styles/stories-entry.css');
  const dockTop = px(dock, /--context-dock-top:\s*(\d+)px/, 'the column top');
  const rule =
    dock.match(/body\.context-docked #right-context-rail \{([^}]*)\}/)?.[1] ||
    '';
  assert.match(rule, /top:\s*var\(--context-dock-top\)/, 'the column uses it');
  assert.match(
    rule,
    /height:\s*calc\(100vh - var\(--context-dock-top\)\)/,
    'and fills the rest of the height',
  );
  // The row sits 32px down (the readout's top, which the Stories button
  // lines up with) and the Stories button is 36px tall.
  const rowTop = px(
    foundation,
    /#style-indicator \{[^}]*?top:\s*(\d+)px/,
    'the readout top',
  );
  const storiesHeight = px(
    stories,
    /#gev-stories \.gs-entry \{[^}]*?height:\s*(\d+)px/,
    'the Stories height',
  );
  assert.ok(
    dockTop >= rowTop + storiesHeight + 8,
    `column top ${dockTop}px clears the row (${rowTop + storiesHeight}px)`,
  );
});

// Expanded, the column already stands at the screen edge: the shift that
// moves an open panel over the rail's gutter must not apply, or the panel's
// right edge passes the window's and its header buttons are cut off.
test("the expanded Context column ends at the window's right edge", () => {
  const dock = read('./styles/context-dock.css');
  const edge = read('./styles/panel-edge.css');
  const column =
    dock.match(/body\.context-docked #right-context-rail \{([^}]*)\}/)?.[1] ||
    '';
  assert.match(column, /right:\s*0\s*!important/, 'the column is at the edge');
  assert.match(
    column,
    /width:\s*var\(--context-dock-width\)\s*!important/,
    'as wide as the column',
  );
  const panel =
    dock.match(
      /body\.context-docked #right-context-rail > #global-context-panel \{([^}]*)\}/,
    )?.[1] || '';
  assert.match(panel, /width:\s*100%\s*!important/, 'the panel fills it');
  // The gutter shift is set without !important, so the expanded panel's
  // own none wins whichever mode or rail state applies.
  assert.match(
    edge,
    /translateX\(var\(--panel-rail-clearance/,
    'a shift exists',
  );
  assert.match(
    panel,
    /transform:\s*none\s*!important/,
    'and the expanded panel cancels it',
  );
  assert.doesNotMatch(
    edge,
    /transform:[^;]*!important/,
    'no gutter shift outranks it',
  );
});

// Expanded, the column keeps its size and the panel keeps its own glass,
// border, radius and glow, as the other panels have.
test('the expanded panel keeps its usual look', () => {
  const dock = read('./styles/context-dock.css');
  const inner =
    dock.match(
      /body\.context-docked #global-context-panel \.global-context-panel-inner \{([^}]*)\}/,
    )?.[1] ?? '';
  assert.match(inner, /height:\s*100%/);
  for (const prop of ['background', 'border', 'border-radius', 'box-shadow'])
    assert.doesNotMatch(
      inner,
      new RegExp(`(^|[;\\s])${prop}:`),
      `no ${prop} of its own`,
    );
  assert.doesNotMatch(
    dock,
    /body\.context-docked #global-context-panel \.panel-glow/,
    'its glow stays',
  );
});
