/**
 * Space Missions roster entries in time order, as Inspect lists them: those
 * launching at or after `now` soonest first, then past ones newest first,
 * then any without a launch time. Entries with the same time keep the
 * roster's order. The entries are not changed.
 * @param {{launchAt: ?number}[]} entries Roster entries.
 * @param {number} now The time in ms.
 * @param {number} [limit] How many to return; all of them by default.
 * @returns {{entry: object, upcoming: boolean}[]}
 */
export function missionsByTime(entries, now, limit = Infinity) {
  const upcoming = [];
  const past = [];
  const undated = [];
  for (const entry of entries || []) {
    if (!Number.isFinite(entry.launchAt)) undated.push(entry);
    else if (entry.launchAt >= now) upcoming.push(entry);
    else past.push(entry);
  }
  upcoming.sort((a, b) => a.launchAt - b.launchAt);
  past.sort((a, b) => b.launchAt - a.launchAt);
  return [
    ...upcoming.map((entry) => ({ entry, upcoming: true })),
    ...[...past, ...undated].map((entry) => ({ entry, upcoming: false })),
  ].slice(0, limit);
}
