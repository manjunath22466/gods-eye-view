import { h, render as renderVue } from 'vue';
import NewsFeed from './news/NewsFeed.vue';
import { setContextListPresence } from './contextLists.js';

const LAYER_ID = 'news';
const LOAD_MORE_MARGIN_PX = 160;

/**
 * News's list in Context: it renders the `feed` view the news layer
 * publishes through its row controls, reports through `onPresence` while the
 * layer is on (so Context shows the list's tab only then), and acts only
 * through setLayerParams. Near the bottom of its scroller it asks for the
 * next older page, once per page; other filters or a failed read let it ask
 * again.
 */
export function createNewsPanel({
  container,
  setLayerParams = () => {},
  onPresence = (state) => setContextListPresence(LAYER_ID, state),
} = {}) {
  const document = container?.ownerDocument;
  if (!document?.createElement) return null;
  const onParams = (params) =>
    setLayerParams(LAYER_ID, params, { origin: 'user' });
  let view = null;
  let destroyed = false;
  let requestedAt = -1;
  let shownFilters = '';

  function restoreReportFocus(active, report) {
    const current = document.activeElement;
    if (
      current === active ||
      (current && current !== document.body && !container.contains(current))
    )
      return;
    const next = container.querySelector('.news-card.is-open');
    if (!next || next.dataset.reportId !== report.dataset.reportId) return;
    const control = next.contains(active)
      ? active
      : [...next.querySelectorAll('button, a[href], video[controls]')].find(
          (node) =>
            node.tagName === active.tagName &&
            node.className === active.className &&
            node.getAttribute('href') === active.getAttribute('href'),
        );
    (control ?? next.querySelector('.news-card__main'))?.focus();
  }

  function render() {
    if (destroyed) return;
    // A feed refresh can move the open detail between its row and the
    // lead card. Keep focus on the same action in the selected report.
    const active = document.activeElement;
    const report = container.contains(active)
      ? active.closest?.('.news-card.is-open')
      : null;
    renderVue(h(NewsFeed, { view, onParams }), container);
    if (report) restoreReportFocus(active, report);
    // The count is the reports the map shows (the layer's `mapCount`, which
    // is its getStats().count), so the tab and Context's News tile agree.
    // The feed's loaded pages would not: it holds as many as were scrolled.
    onPresence(view ? { count: view.mapCount ?? null } : null);
  }

  const onScroll = () => {
    if (!view?.hasMore || view.loading) return;
    const remaining =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (remaining > LOAD_MORE_MARGIN_PX) return;
    if (requestedAt === view.items.length) return;
    requestedAt = view.items.length;
    onParams({ loadMore: true });
  };
  container.addEventListener?.('scroll', onScroll, { passive: true });

  return {
    /** Show the layer's feed view, or report the list gone with null. */
    update(next) {
      const filters = JSON.stringify(next?.filters ?? null);
      // A new list (other filters or hotspot), or a read that failed, may stop
      // at the same length as the last request: let the next scroll ask.
      // A list started over is shorter than the one the last request saw.
      if (
        filters !== shownFilters ||
        (next?.error && !view?.error) ||
        (next?.items?.length ?? 0) < requestedAt
      )
        requestedAt = -1;
      shownFilters = filters;
      view = next || null;
      render();
    },
    destroy() {
      destroyed = true;
      container.removeEventListener?.('scroll', onScroll);
      renderVue(null, container);
      onPresence(null);
    },
  };
}
