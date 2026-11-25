import { defineStore } from 'pinia';
import { markRaw, ref, shallowRef } from 'vue';

/** How long the notice that a pin went stays, once nothing holds it. */
const NOTICE_MS = 8000;

/**
 * What is pinned to Context's Pinned tab: camera feeds, Street View, radio
 * stations, places and any other picked item, oldest first. There is no
 * limit: the grid scrolls. Every pin is a still: a camera's last
 * frame, a photo's picture, a station's name, a moving item's last
 * position, a place's map. Nothing plays or polls from Pinned; tapping a pin
 * opens its card on Inspect. Unpinning says what went and offers Undo. Pins
 * stay until they are unpinned; nothing docks on the globe. The tabs
 * (Inspect and Pinned) show only while something is pinned.
 */
export const usePinnedStore = defineStore('gev-pinned', () => {
  /**
   * `[{key, kind, title, icon, identity, station?, pose?}]`, oldest first.
   * `kind` is 'camera', 'street', 'station', 'place', 'item' or 'view';
   * `identity` opens the item's card, and a view's `pose` is the camera it
   * flies back to.
   */
  const pins = ref([]);
  /** The tab Context shows while something is pinned. */
  const tab = ref('inspect');
  /**
   * The pin that was last unpinned, `{removed, index, still}`, or every pin
   * Clear all took, `{all: [{pin, still}]}`, while its Undo is offered;
   * null otherwise.
   */
  const unpinned = shallowRef(null);
  let noticeTimer = 0;

  const isPinned = (key) => pins.value.some((pin) => pin.key === key);

  /**
   * The still each pin shows, by pin key: the picture a camera or a photo
   * showed when it was pinned, so its tile never asks for a new one.
   */
  const stills = ref({});
  function setStill(key, url) {
    if (!key || !url || stills.value[key] === url || !isPinned(key)) return;
    stills.value = { ...stills.value, [key]: url };
  }
  const stillOf = (key) => stills.value[key] || '';
  function dropStill(key) {
    if (!stills.value[key]) return;
    const { [key]: _gone, ...rest } = stills.value;
    stills.value = rest;
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    unpinned.value = null;
  }

  /**
   * Pin an item, with the still its tile shows (`entry.still`), if any.
   * @returns {boolean} Whether it was added (false when already pinned).
   */
  function pin(entry) {
    if (!entry?.key || isPinned(entry.key)) return false;
    const { still, ...kept } = entry;
    pins.value = [...pins.value, markRaw(kept)];
    if (still) setStill(entry.key, still);
    // Pinning it again is its own undo.
    if (unpinned.value?.removed?.key === entry.key) clearNotice();
    return true;
  }

  /**
   * Hold the notice while the pointer or focus is on it (so Undo stays
   * reachable); it goes NOTICE_MS after both have left.
   * @param {'pointer'|'focus'} by
   * @param {boolean} held
   */
  const holds = new Set();
  function holdNotice(by, held) {
    if (held) holds.add(by);
    else holds.delete(by);
    if (!unpinned.value) return;
    clearTimeout(noticeTimer);
    if (!holds.size) noticeTimer = setTimeout(clearNotice, NOTICE_MS);
  }
  /** Drop every hold (the notice left the screen) and start its countdown. */
  function releaseNotice() {
    holds.clear();
    holdNotice('pointer', false);
  }

  /**
   * Put back what was last unpinned, where it was, with its still: one pin,
   * or every pin Clear all took.
   */
  function undo() {
    const last = unpinned.value;
    if (!last) return;
    // Undo leaves with its notice while the pointer or focus is on it, and
    // a browser may then send no pointerleave or focusout: a stale hold
    // would keep the next notice up for good.
    holds.clear();
    clearNotice();
    if (last.all) {
      const back = last.all.filter((entry) => !isPinned(entry.pin.key));
      pins.value = [...back.map((entry) => entry.pin), ...pins.value];
      for (const entry of back)
        if (entry.still) setStill(entry.pin.key, entry.still);
      return;
    }
    if (isPinned(last.removed.key)) return;
    const next = [...pins.value];
    next.splice(Math.min(last.index, next.length), 0, last.removed);
    pins.value = next;
    if (last.still) setStill(last.removed.key, last.still);
  }

  function unpin(key) {
    const index = pins.value.findIndex((pin) => pin.key === key);
    if (index < 0) return;
    const removed = pins.value[index];
    const still = stillOf(key);
    pins.value = pins.value.filter((pin) => pin.key !== key);
    dropStill(key);
    clearNotice();
    unpinned.value = { removed, index, still };
    if (!holds.size) noticeTimer = setTimeout(clearNotice, NOTICE_MS);
    if (!pins.value.length) tab.value = 'inspect';
  }

  /** Unpin everything at once; Undo puts it all back. */
  function clearAll() {
    if (!pins.value.length) return;
    const all = pins.value.map((entry) => ({
      pin: entry,
      still: stillOf(entry.key),
    }));
    for (const entry of all) dropStill(entry.pin.key);
    pins.value = [];
    clearNotice();
    unpinned.value = { all, removed: { title: '' } };
    if (!holds.size) noticeTimer = setTimeout(clearNotice, NOTICE_MS);
    tab.value = 'inspect';
  }

  /** Pin it, or unpin it when it is pinned already. */
  function toggle(entry) {
    if (isPinned(entry?.key)) unpin(entry.key);
    else pin(entry);
  }

  function show(which) {
    tab.value = which === 'pinned' && pins.value.length ? 'pinned' : 'inspect';
  }

  return {
    pins,
    tab,
    unpinned,
    isPinned,
    stillOf,
    setStill,
    pin,
    unpin,
    clearAll,
    toggle,
    undo,
    show,
    clearNotice,
    holdNotice,
    releaseNotice,
  };
});
