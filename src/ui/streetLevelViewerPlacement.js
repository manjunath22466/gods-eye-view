// Move the same provider-owned viewer between Context's home and photo slot.
import { isContextSurfaceVisible, MOBILE_SHEET_ATTR } from './mobileSheets.js';

let home = null;
let wrap = null;

let sheetWatch = null;

/**
 * Vue calls this as the home's function ref (ContextView.vue): with its
 * element on mount and on each update, and with null on unmount.
 * @param {HTMLElement|null} element The viewer's offscreen home.
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
 * Let the old home go: its viewer goes back under it, out of the card, and
 * the sheet watcher stops.
 */
function releaseHome() {
  sheetWatch?.disconnect();
  sheetWatch = null;
  if (home && wrap && wrap.parentElement !== home) home.appendChild(wrap);
  home = null;
  wrap = null;
}

/** A phone sheet switch moves the viewer between the card and its home. */
function watchSheets() {
  const body = home?.ownerDocument?.body;
  if (!home || !body || sheetWatch || typeof MutationObserver !== 'function')
    return;
  sheetWatch = new MutationObserver(() => placeStreetLevelViewer());
  sheetWatch.observe(body, {
    attributes: true,
    attributeFilter: [MOBILE_SHEET_ATTR, 'class'],
  });
  const rail = body.querySelector('#right-context-rail');
  if (rail)
    sheetWatch.observe(rail, { attributes: true, attributeFilter: ['class'] });
}

/** Whether the card's slot can be seen. */
function slotShown(slot) {
  if (slot.closest('[hidden]')) return false;
  for (let node = slot; node; node = node.parentElement)
    if (node.style?.display === 'none') return false;
  return isContextSurfaceVisible(slot.ownerDocument?.body);
}

/** Native fullscreen and an open popover must stay attached to their original parent. */
export function isStreetViewerExpanded(element = wrap) {
  return Boolean(
    element &&
    (element.ownerDocument.fullscreenElement === element ||
      (element.hasAttribute('popover') && element.matches(':popover-open'))),
  );
}
const lifted = () =>
  wrap.classList.contains('sl-viewer-wrap-embed') || isStreetViewerExpanded();

/** The card's slot while it can be seen, else home. */
export function placeStreetLevelViewer() {
  if (!home || !wrap || lifted()) return;
  const doc = home.ownerDocument;
  const card = doc.getElementById('sl-viewer-slot');
  const loading = doc.getElementById('sl-viewer-loading-slot');
  const target =
    [card, loading].find((slot) => slot && slotShown(slot)) ?? home;
  if (wrap.parentElement !== target) target.appendChild(wrap);
}

/**
 * Send the viewer home before its slot goes. Only from that slot: the
 * viewer may already be home.
 */
export function returnStreetLevelViewerHome() {
  if (!home || !wrap || lifted()) return;
  if (wrap.parentElement?.id !== 'sl-viewer-slot') return;
  home.appendChild(wrap);
}
