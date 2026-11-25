// Where the street-level viewer sits: in the Street Level panel, its home,
// on the card of the open photo (`#sl-viewer-slot`), or in the docked view
// (`#sl-docked-slot`) while the photo is docked and another card shows. The
// same element moves, so the viewer a provider mounted in it, and the
// controls StreetLevelControls read once at start-up, keep working. The
// panel registers the home; the card and the dock ask for a placement
// whenever their slot appears, and send the viewer home before their slot
// is removed, so it never leaves the page with it.

import { MOBILE_SHEET_ATTR, MOBILE_SHELL_CLASS } from './mobileSheets.js';

let home = null;
let wrap = null;

let sheetWatch = null;

/**
 * Vue calls this as the panel's function ref: with its element on mount and
 * on each update, and with null on unmount.
 * @param {HTMLElement|null} element The viewer's home in the Street Level panel.
 */
export function registerStreetLevelViewerHome(element) {
  const next = element || null;
  if (next !== home) {
    releaseHome();
    home = next;
    // Found once: while it sits in the card it is no longer under home.
    wrap = home?.querySelector('#sl-viewer-wrap') ?? null;
  }
  watchSheets();
  placeStreetLevelViewer();
}

/**
 * Let the old panel go: its viewer goes back under it, out of the card, and
 * the sheet watcher stops.
 */
function releaseHome() {
  sheetWatch?.disconnect();
  sheetWatch = null;
  if (home && wrap && wrap.parentElement !== home) home.appendChild(wrap);
  home = null;
  wrap = null;
}

/** A phone sheet switch changes whether the card can host the viewer. */
function watchSheets() {
  const body = globalThis.document?.body;
  if (!home || !body || sheetWatch || typeof MutationObserver !== 'function')
    return;
  sheetWatch = new MutationObserver(() => placeStreetLevelViewer());
  sheetWatch.observe(body, {
    attributes: true,
    attributeFilter: [MOBILE_SHEET_ATTR, 'class'],
  });
}

/** Whether the slot or any ancestor was hidden by its owner. */
function slotShown(slot) {
  if (slot.closest('[hidden]')) return false;
  for (let node = slot; node; node = node.parentElement)
    if (node.style?.display === 'none') return false;
  return true;
}

/** An embedded page lifts an open photo over its globe; it stays there. */
const lifted = () => wrap.classList.contains('sl-viewer-wrap-embed');

/** The visible card or dock slot, then the viewer's home. */
export function placeStreetLevelViewer() {
  if (!home || !wrap || lifted()) return;
  const doc = globalThis.document;
  const card = doc?.getElementById('sl-viewer-slot');
  const dock = doc?.getElementById('sl-docked-slot');
  const body = doc?.body;
  const contextShown =
    !body?.classList.contains(MOBILE_SHELL_CLASS) ||
    body.getAttribute(MOBILE_SHEET_ATTR) === 'context';
  const target =
    card && contextShown && slotShown(card)
      ? card
      : dock && slotShown(dock)
        ? dock
        : home;
  if (wrap.parentElement !== target) target.appendChild(wrap);
}

/**
 * Send the viewer home before its slot goes. Only from that slot: the
 * viewer may already sit in the other one.
 * @param {string} slotId `sl-viewer-slot` or `sl-docked-slot`.
 */
export function returnStreetLevelViewerHome(slotId) {
  if (!home || !wrap || lifted()) return;
  if (wrap.parentElement?.id !== slotId) return;
  home.appendChild(wrap);
}
