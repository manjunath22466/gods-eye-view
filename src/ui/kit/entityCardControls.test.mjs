// The entity card's buttons and Material glyphs are the kit's: neither its
// template nor the hero preview, camera preview, place details and nearby
// lists it renders hand-writes a <button> or a Material Symbols span. The Ask GEV button's chat bubble is
// not a Material symbol the page loads, so it stays drawn as inline SVG; the
// hero views (model, route globe, cockpit view, ground view, graphs) draw
// their own pictures and have no controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/** A view's template block: everything outside script and style. */
function template(file) {
  const source = readFileSync(
    new URL(`../views/panels/${file}`, import.meta.url),
    'utf8',
  );
  return source.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/g, '');
}
const card = template('EntityCard.vue');
// The card's hero image and its preview switch live in their own view.
const preview = template('EntityPreview.vue');
// A place's details, its coordinates line and its nearby lists.
const places = ['PlaceDetails.vue', 'PlaceLine.vue', 'NearbyLists.vue'].map(
  template,
);
const camera = template('CctvPreview.vue');
const nearby = template('SpotConditions.vue');
const heroViews = [
  'AircraftModelHero.vue',
  'RouteGlobe.vue',
  'FlightCockpitView.vue',
  'SatelliteGroundView.vue',
  'PreviewHud.vue',
  'AltitudeGraph.vue',
].map(template);

test('the entity card hand-writes no button; each is a UiButton', () => {
  for (const markup of [card, preview, camera, nearby, ...places, ...heroViews])
    assert.deepEqual(markup.match(/<button\b/gi) ?? [], []);
  // Find it, the cockpit entry, Follow, Fly to and Ask GEV. The preview
  // switch moved to the hero preview's own view.
  assert.equal(card.match(/<UiButton\b/g)?.length, 5);
  assert.equal(card.match(/<UiCloseButton\b/g)?.length, 1);
  // Photos, Route, 3D, Cockpit view, Map, Play/Pause, a satellite's
  // Play/Pause, a place's Street View photo and TR-3B.
  assert.equal(preview.match(/<UiButton\b/g)?.length, 9);
  // A camera's bigger view and More info; its popup closes with a
  // UiCloseButton.
  assert.equal(camera.match(/<UiButton\b/g)?.length, 2);
  assert.equal(camera.match(/<UiCloseButton\b/g)?.length, 1);
  // The hazard row and the alert row; the traffic and other nearby rows are
  // the shared nearby lists now (a row).
  assert.equal(nearby.match(/<UiButton\b/g)?.length, 2);
  assert.equal(places[2].match(/<UiButton\b/g)?.length, 1);
});

test('the preview switch and Follow are pressed toggles with their classes', () => {
  // Photos, Route, 3D, Cockpit view and Map; the map view and the Play/Pause
  // toggle sit at the end of the switch.
  const previews =
    preview.match(
      /<UiButton v-if="views\.includes\('\w+'\)" :pressed[^>]*>/g,
    ) ?? [];
  assert.equal(previews.length, 5);
  for (const button of previews) {
    assert.match(button, /pressed-class="active"/);
    assert.doesNotMatch(button, /aria-pressed|:class=/);
  }
  assert.match(
    preview,
    /<UiButton class="entity-card__preview-play" :disabled="reducedMotion" :label=/,
  );
  assert.match(
    card,
    /<UiButton v-if="store\.canFollow\(\)" class="entity-card__action" :class="\{ 'entity-card__action--primary': [^"]*\}" :pressed="Boolean\(store\.isFollowing\(\)\)" pressed-class="entity-card__action--on"/,
  );
});

test('the entity card hand-writes no Material glyph; each is a UiIcon', () => {
  for (const markup of [card, preview, camera, nearby, ...places, ...heroViews])
    assert.deepEqual(markup.match(/material-symbols-outlined/g) ?? [], []);
  const counts = [
    // The hero glyph, Find it, the warning, the cockpit entry, Follow, Fly
    // to, the route's plane and the route note.
    [card, 8],
    // The preview switch's four glyphs, Play/Pause and a satellite's
    // Play/Pause.
    [preview, 6],
    // Bigger view, the popup's camera and More info.
    [camera, 3],
    // The Conditions here, hazard and alert headings and their rows; there
    // are no weather glyphs, and the other headings and rows are in the
    // shared nearby lists.
    [nearby, 6],
    // A list's heading and an item's motion.
    [places[2], 2],
  ];
  for (const [markup, count] of counts) {
    const icons = markup.match(/<UiIcon\b[^>]*>/g) ?? [];
    assert.equal(icons.length, count);
    // Without it the kit writes an 18px size that beats the card's own rules.
    for (const icon of icons) assert.match(icon, /:size="null"/);
  }
});

test('the only inline SVG glyph is the Ask GEV chat bubble', () => {
  const svgs = [...card.matchAll(/<svg\b[\s\S]*?<\/svg\s*>/g)].map((m) => m[0]);
  assert.equal(svgs.length, 1);
  assert.match(svgs[0], /<path d="M4 5h16v11H9l-5 4z" \/>/);
  for (const markup of [preview, camera, nearby, ...places])
    assert.deepEqual(markup.match(/<svg\b/gi) ?? [], []);
});
