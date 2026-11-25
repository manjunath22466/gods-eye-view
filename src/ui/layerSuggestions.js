/**
 * What to suggest on the globe, in a zoomed-in view, or on a place card.
 */
const BY_VIEW = Object.freeze({
  globe: ['satellites', 'flights', 'ais-live-vessels'],
  local: [],
  place: ['flights', 'ais-live-vessels', 'satellites'],
});

/** With a layer on, what goes with it. */
const COMPANIONS = Object.freeze({
  flights: ['ais-live-vessels', 'satellites'],
  'ais-live-vessels': ['flights'],
  satellites: ['flights'],
  'local-firms': ['wind'],
  earthquakes: ['local-firms'],
});

export const MAX_SUGGESTIONS = 3;

/**
 * Up to `MAX_SUGGESTIONS` layer ids to suggest.
 * @param {object[]} rows The data manager's layer rows.
 * @param {{globe?: boolean, place?: boolean}} [view] Whether the view shows
 *   the whole globe, or the suggestions are for a place's card.
 * @returns {string[]}
 */
export function suggestLayers(rows, { globe = false, place = false } = {}) {
  const byId = new Map((rows || []).map((row) => [row.id, row]));
  const on = (rows || []).filter((row) => row.enabled).map((row) => row.id);
  const candidates = [
    ...on.flatMap((id) => COMPANIONS[id] || []),
    ...BY_VIEW[place ? 'place' : globe ? 'globe' : 'local'],
  ];
  const picked = [];
  for (const id of candidates) {
    if (picked.length >= MAX_SUGGESTIONS) break;
    const row = byId.get(id);
    if (
      !row ||
      row.enabled ||
      picked.includes(id) ||
      row.showInTogglePanel === false ||
      row.stats?.keyRequired === true ||
      row.stats?.sourceUnavailable === true ||
      // AIS and FIRMS use server-side keys. Before a successful update the
      // browser cannot distinguish a keyless host from an unused feed.
      ((id === 'ais-live-vessels' || id === 'local-firms') &&
        !row.stats?.lastUpdate)
    )
      continue;
    picked.push(id);
  }
  return picked;
}
