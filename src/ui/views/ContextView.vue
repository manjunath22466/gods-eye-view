<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { formatNumber, t } from '../../i18n/index.js';
import RailPanel from '../rail/RailPanel.vue';
import { vClassToggle } from '../rail/classToggle.js';
import { useBhoteKoshiPanelStore } from '../stores/bhoteKoshiPanel.js';
import { usePanelChromeStore } from '../stores/panelChrome.js';
import { useEntityCardStore } from '../stores/entityCard.js';
import { useSceneStore } from '../stores/scenes.js';
import { usePinnedStore } from '../stores/pinned.js';
import { useCctvStore } from '../stores/cctv.js';
import { useDisplayStore } from '../stores/display.js';
import { useCockpitStore } from '../stores/cockpit.js';
import BhoteKoshiPanel from './panels/BhoteKoshiPanel.vue';
import EntityCard from './panels/EntityCard.vue';
import ViewContext from './panels/ViewContext.vue';
import PinnedGrid from './panels/PinnedGrid.vue';
import PinUndoNotice from './panels/PinUndoNotice.vue';
import RadioStations from './panels/RadioStations.vue';
import RadioMiniPlayer from './panels/RadioMiniPlayer.vue';
import LocalReceiverPlayer from './panels/LocalReceiverPlayer.vue';
import DockedView from './panels/DockedView.vue';
import CctvTools from './panels/CctvTools.vue';
import { placeCctvTools, registerCctvToolsHome, returnCctvToolsHome } from '../cctvToolsPlacement.js';
import { CAMERA_SETTINGS_EVENT, CONTEXT_NEARBY_EVENT, ESCAPE_OWNING_DIALOGS } from '../contextEvents.js';
import StreetLevelViewer from './panels/StreetLevelViewer.vue';
import { placeStreetLevelViewer, registerStreetLevelViewerHome } from '../streetLevelViewerPlacement.js';
import { useStreetLevelStore } from '../stores/streetLevel.js';
import { useDockedStore } from '../stores/docked.js';
import { useRadioLayer } from '../radioContext.js';
import { useSpaceMissionsStore } from '../stores/spaceMissions.js';
import MissionRoster from './panels/MissionRoster.vue';
import MissionDetail from './panels/MissionDetail.vue';
import {
  contextListChoice,
  contextListPresence,
  contextListsActive,
  leaveContextLists,
  listForLayer,
  listsOn,
  setContextListPresence,
  showContextList,
  shownList,
} from '../contextLists.js';
import RadioFold from './panels/RadioFold.vue';
import SdrCard from './panels/SdrCard.vue';
import CameraList from './panels/CameraList.vue';
import LivePanel from './panels/LivePanel.vue';
import StationPanel from './panels/StationPanel.vue';
import UiButton from '../kit/UiButton.vue';
import UiIcon from '../kit/UiIcon.vue';
import UiSearchField from '../kit/UiSearchField.vue';
import { closeContextSearch, contextNeedle, contextSearchOpen, contextSearchText } from '../contextSearch.js';

// While the Bhote Koshi event is on, its panel is the rail's only content.
const { panel: bhotePanel } = storeToRefs(useBhoteKoshiPanelStore());
// The Scene runtime chip SceneControls presents while a scene plays.
const { panel: scenePanel } = storeToRefs(useSceneStore());
const sceneRuntime = computed(() => scenePanel.value?.runtime ?? '');
// Context shows what is picked, led by its hero; with nothing picked, it
// summarises the layers that are on around the view.
const entityCards = useEntityCardStore();
const { card: entityCard } = storeToRefs(entityCards);
const cameraListHost = ref(null);
const inlineCameraId = computed(() => entityCard.value?.layerId === 'cctv' && !entityCards.fromPin && !entityCards.layerOff('cctv')
  ? entityCard.value.identity?.id ?? null : null);
const { phoneShell } = storeToRefs(useDisplayStore());
onMounted(() => {
  const body = globalThis.document?.body;
  if (body && globalThis.MutationObserver) {
    bodyWatch = new MutationObserver(() => {
      railCovered.value = isRailCovered();
      if (docked.value && (body.classList.contains('mobile-shell') || body.classList.contains('cockpit-mode'))) setDocked(false);
    });
    bodyWatch.observe(body, { attributeFilter: ['class', 'data-assistant-docked'] });
    railCovered.value = isRailCovered();
  }
  globalThis.document?.addEventListener('visibilitychange', updatePageVisibility);
  updatePageVisibility();
});
onBeforeUnmount(() => {
  bodyWatch?.disconnect();
  globalThis.document?.removeEventListener('visibilitychange', updatePageVisibility);
});
// What is pinned: with anything pinned, Context has two tabs, Inspect (the
// pick, or awareness) and Pinned (the grid); with nothing pinned, no tabs.
const pinned = usePinnedStore();
const { pins, tab: pinnedTab } = storeToRefs(pinned);
// A layer with a list of its own (Space Missions, Weather, News, Recent
// Imagery) adds a list while it is on. The list bodies stay mounted in
// Context so the readouts can retain their state while another tab shows.
const lists = computed(() => listsOn(contextListPresence));
const listShown = computed(() =>
  contextListsActive.value ? shownList(lists.value, contextListChoice.value) : '',
);
// A camera card adds a Camera settings tab while the Cameras layer is on.
const cameraSettingsAvailable = computed(() =>
  entityCard.value?.layerId === 'cctv' && Boolean(entityCard.value.identity?.id) && !entityCards.layerOff('cctv'),
);
const cameraSettingsChosen = ref(false);
const cameraSettingsShown = computed(() => cameraSettingsChosen.value && cameraSettingsAvailable.value);
const tab = computed(() =>
  listShown.value ? 'lists' : cameraSettingsShown.value ? 'camera' : pins.value.length ? pinnedTab.value : 'inspect',
);
const showInspect = computed(() => tab.value === 'inspect');
const tabIds = computed(() => [
  'inspect',
  ...(cameraSettingsAvailable.value ? ['camera'] : []),
  ...(lists.value.length ? ['lists'] : []),
  ...(pins.value.length ? ['pinned'] : []),
]);
// One rule for every list tab: its name and how many it holds, or, with
// nothing to count, why (as a tile says why it holds none).
const listLabel = (list) =>
  list.count !== null
    ? t('{name} · {count}', { name: t(list.label), count: formatNumber(list.count) })
    : list.reason
      ? t('{name} · {reason}', { name: t(list.label), reason: list.reason })
      : t(list.label);
const listTabLabel = computed(() => (lists.value.length > 1 ? t('Lists') : lists.value[0] ? listLabel(lists.value[0]) : ''));
function selectTab(id) {
  if (id === 'camera') return showCameraSettings();
  cameraSettingsChosen.value = false;
  if (id === 'lists') showContextList(shownList(lists.value, contextListChoice.value));
  else pinned.show(id);
}
// The tools act on the active camera, so showing them for a camera card that
// is not the active camera's makes it active first.
const cctvState = useCctvStore();
async function showCameraSettings() {
  if (!cameraSettingsAvailable.value) return;
  const card = entityCard.value;
  if (cctvState.view?.activeCameraId !== card.identity.id) {
    entityCards.open(card.identity, { fromPin: entityCards.fromPin });
    await nextTick();
    if (!cameraSettingsAvailable.value || entityCard.value.key !== card.key) return;
  }
  pinned.show('inspect');
  leaveContextLists();
  cameraSettingsChosen.value = true;
}
watch(cameraSettingsAvailable, (available) => available || (cameraSettingsChosen.value = false));
// Anything that shows Inspect or Pinned (a new pick, a station, a pin's
// tile) leaves the list tab.
onBeforeUnmount(
  pinned.$onAction(({ name }) => {
    if (name !== 'show') return;
    leaveContextLists();
    cameraSettingsChosen.value = false;
  }),
);
// A list shown (a layer turned on, voice) leaves Camera settings too.
watch(listShown, (shown, previous) => {
  if (shown) cameraSettingsChosen.value = false;
  else if (previous && !lists.value.length) pinned.show('inspect');
});
// A list layer a person turned on directly shows its list; one a link or a
// restore turned on does not take Context over.
const DIRECT_ON_MS = 15_000;
watch(
  () => lists.value.map((list) => list.id),
  (ids, before) => {
    const added = ids.find((id) => !before.includes(id));
    const direct = entityCards.lastDirectOn;
    if (added && direct && Date.now() - direct.at < DIRECT_ON_MS && listForLayer(direct.layerId) === added) {

      showContextList(added);
    }
  },
);
// Space Missions' list is on while its layer is; the others report from
// their readouts (contextLists.js). Turned off while its list shows, Lists
// moves to the next list that is on; with none left, Context goes to Inspect
// (never back to Pinned).
const { enabled: missionsOn, roster: missionRoster, mission: selectedMission } = storeToRefs(useSpaceMissionsStore());
watch(
  [missionsOn, () => missionRoster.value?.entries?.length],
  ([on, count]) => {
    setContextListPresence('space-missions', on ? { count: count ?? null } : null);
  },
  { immediate: true },
);
onBeforeUnmount(() => setContextListPresence('space-missions', null));
// Any list going while focus is on its sub-tab or in its list hands focus to
// the list that shows then: its sub-tab, or the Lists tab when it is the
// only one left. The Lists tab going is handled with the other tabs below.
watch(
  () => lists.value.map((list) => list.id),
  (ids, before) => {
    const doc = globalThis.document;
    const focused = doc?.activeElement;
    const gone = before.filter((id) => !ids.includes(id));
    const stripGone = ids.length === 1 && before.length > 1 && focused?.closest?.('.context-list-tabs');
    if (!ids.length || !(stripGone || gone.some((id) => focused?.closest?.(`#context-list-tab-${id}, #context-list-${id}`)))) return;
    void nextTick(() =>
      (doc.getElementById(`context-list-tab-${listShown.value}`) ?? doc.getElementById('context-tab-lists'))?.focus({ preventScroll: true }),
    );
  },
);
// Any other tab that goes while it has focus (Lists, when its last list
// layer goes off; Camera settings, when Cameras go off) hands focus to the
// tab that shows then, else Inspect, else Context's body.
watch(tabIds, (ids, before) => {
  const doc = globalThis.document;
  const gone = before.filter((id) => !ids.includes(id));
  const focused = doc?.activeElement;
  if (!gone.some((id) => focused?.closest?.(id === 'lists' ? '#context-tab-lists, #context-lists' : `#context-tab-${id}`))) return;
  void nextTick(() =>
    (doc.getElementById(`context-tab-${tab.value}`) ?? doc.getElementById('context-tab-inspect') ?? contextScroller.value)?.focus({ preventScroll: true }),
  );
});
// Keep focus in Missions when its detail replaces the roster or closes.
const missionHost = ref(null);
watch(
  () => Boolean(selectedMission.value),
  async (selected) => {
    const host = missionHost.value;
    if (!host?.contains(globalThis.document?.activeElement)) return;
    await nextTick();
    const active = globalThis.document?.activeElement;
    if (!selected && active?.closest('[data-mission-roster-id]') && host.contains(active)) return;
    host.querySelector(selected ? '[data-mission-close]' : '[data-mission-roster-id]')?.focus();
  },
);
// Radio: with the layer on, its stations show in Context while nothing is
// picked; the station selected or heard is in the mini player as well,
// whatever Context shows. Tapping a pinned station plays it and leaves
// Radio as it is (pinnedStation.js).
const { module: radioModule, ui: radioUi } = useRadioLayer();
// Whether Context is showing the station list right now.
// On a phone Context is on screen only while its sheet is open; the phone
// shell publishes whether it is on and its open sheet.
const contextOnScreen = computed(() => !phoneShell.value?.enabled || phoneShell.value.sheet === 'context');
const radioListShown = computed(() =>
  Boolean(contextOpen.value && showInspect.value && !entityCard.value && radioUi.value?.enabled && contextOnScreen.value),
);
// A station picked on the globe (or Radio just turned on) shows in the list:
// Inspect, with the pick let go so the list is in view.
function showStations() {

  entityCards.clear();
  pinned.show('inspect');
}
// Nearby releases the selected card as well: its undocked photo closes
// through the card watcher below, while a dock retains its visible photo.
// Radio turned on only brings Inspect forward: a picked (or followed) item
// stays, and its stations show once it is let go.
const showInspectTab = () => pinned.show('inspect');
onMounted(() => {
  globalThis.document?.addEventListener('gev:radio-selected', showStations);
  globalThis.document?.addEventListener('gev:radio-show-stations', showInspectTab);
  globalThis.document?.addEventListener(CONTEXT_NEARBY_EVENT, showStations);
  globalThis.document?.addEventListener(CAMERA_SETTINGS_EVENT, showCameraSettings);
});
onBeforeUnmount(() => {
  globalThis.document?.removeEventListener('gev:radio-selected', showStations);
  globalThis.document?.removeEventListener('gev:radio-show-stations', showInspectTab);
  globalThis.document?.removeEventListener(CONTEXT_NEARBY_EVENT, showStations);
  globalThis.document?.removeEventListener(CAMERA_SETTINGS_EVENT, showCameraSettings);
});
// A pinned station played with Radio on: the pick lets go so the station
// list (which shows the station, its stream and any error) is in view.
function openStation() {
  entityCards.clear();
}

// Arrow keys move between the tabs, as on any tab list: the next or the
// previous one, without wrapping; Home and End go to the first and the last.
function stepTab(event, ids, current) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return null;
  event.preventDefault();
  // The first tab comes first in reading order: left in left-to-right, right in RTL.
  const rtl = globalThis.getComputedStyle?.(event.currentTarget)?.direction === 'rtl';
  if (event.key === 'Home') return ids[0];
  if (event.key === 'End') return ids.at(-1);
  const step = event.key === (rtl ? 'ArrowRight' : 'ArrowLeft') ? -1 : 1;
  const at = Math.max(0, ids.indexOf(current));
  return ids[Math.min(ids.length - 1, Math.max(0, at + step))];
}
// The scrolling part of the tab row: its end fades while tabs are out of
// view there, and the selected tab is scrolled into view.
const tabStrip = ref(null);
const tabsClipped = ref(false);
function measureTabStrip() {
  const strip = tabStrip.value;
  // Right to left, scrollLeft runs from 0 down to negative values.
  tabsClipped.value = Boolean(strip && Math.abs(strip.scrollLeft) + strip.clientWidth < strip.scrollWidth - 1);
}
function onTabKey(event) {
  const next = stepTab(event, tabIds.value, tab.value);
  if (!next) return;
  selectTab(next);
  void nextTick(() => globalThis.document?.getElementById(`context-tab-${next}`)?.focus());
}
function onListKey(event) {
  const next = stepTab(event, lists.value.map((list) => list.id), listShown.value);
  if (!next) return;
  showContextList(next);
  void nextTick(() => globalThis.document?.getElementById(`context-list-tab-${next}`)?.focus());
}

// Esc anywhere in Context (its header, its search field, its body) clears
// the pick first while Inspect shows it, then closes the search (keeping the
// text); only then does the panel's own Esc collapse it. On the other tabs
// the pick is out of view, so Esc leaves it. It is caught on the way down,
// before the panel's handler. Focus stays in the panel, so the next Esc
// reaches it too. Pins stay until they are unpinned. One Esc does one thing:
// a control inside that has something of its own to close (marked
// data-owns-escape) takes it instead.
const contextScroller = ref(null);
// On a phone the search field's own Esc closes the search: the field stops
// the key, so the sheet never sees it.
function onSearchEscape() {
  if (!globalThis.document?.body?.classList.contains('mobile-shell')) return;
  closeContextSearch();
  contextScroller.value?.focus({ preventScroll: true });
}
function onEscape(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
  if (!event.target?.closest?.('#global-context-panel')) return;
  // Folded, Context shows no pick and no search: Esc leaves them.
  if (!contextOpen.value) return;
  // Inner owners go first: the radio tuner, and a control that handles Esc
  // itself (marked data-owns-escape, as a calibration value being typed, an
  // open volume slider, or Recent Imagery while it previews a day or draws
  // a box). This runs on the way down, before such a control can stop the
  // event, so it has to be asked here.
  if (event.target.closest('.radio-tuner, [data-owns-escape]')) return;
  // A full-screen street-level photo shrinks first (StreetLevelControls).
  if (streetLevel.expanded) return;
  // An open dialog keeps its Esc. A camera's enlarged view (CctvPreview)
  // takes it at the document, before this handler, and stops it; one still
  // open here is left alone all the same.
  if (globalThis.document?.querySelector(ESCAPE_OWNING_DIALOGS)) return;
  // On a phone, Esc (back) closes the sheet first, as every sheet does.
  if (globalThis.document?.body?.classList.contains('mobile-shell')) return;
  // Focus inside the card or the search goes with them; it moves to the
  // panel first, so the next Esc still reaches Context.
  const leaving = event.target.closest('#entity-card, .context-search');
  if (entityCard.value && showInspect.value) entityCards.clear();
  else if (contextSearchOpen.value) closeContextSearch();
  else return;
  event.preventDefault();
  if (leaving || !event.target.isConnected) contextScroller.value?.focus({ preventScroll: true });
}

// A new pick starts at the top of the panel, not wherever the last one was
// scrolled to, and shows on Inspect.
watch(
  [() => entityCard.value?.key, () => entityCards.selectionGeneration()],
  async ([key, generation], [previous, previousGeneration]) => {
    if (!key || generation === previousGeneration) return;
    pinned.show('inspect');
    if (key === previous) return;
    await nextTick();
    globalThis.document
      ?.getElementById('entity-card')
      ?.closest('[data-rail-scroller]')
      ?.scrollTo({ top: 0, behavior: 'smooth' });
  },
);

// Search in the header: a field that narrows what Context is showing, the
// selected item's details and every list of what is nearby or in view.
const searchInput = ref(null);
function toggleSearch() {
  if (contextSearchOpen.value) return closeContextSearch();
  contextSearchOpen.value = true;
  void nextTick(() => searchInput.value?.focus());
}
const searchHint = computed(() =>
  entityCard.value ? t('Search {name} and nearby', { name: entityCard.value.title }) : t('Search what is in view'),
);

// Expanded, Context becomes a full-height column over the right edge of the
// screen, with the globe left as it is underneath. It shrinks back when the
// panel closes.
const docked = ref(false);
const dockedViews = useDockedStore();
const { panels: chromePanels } = storeToRefs(usePanelChromeStore());
// The phone layout and Cockpit have no room for the column: either one
// arriving lets it go.
let bodyWatch = null;
function setDocked(next) {
  docked.value = next;
  // The column covers the corner: the docked view hides and pauses meanwhile.
  dockedViews.setStowed(next);
  const body = globalThis.document?.body;
  body?.classList.toggle('context-docked', next);
}
// These modes hide the rail or its Context panel without changing disclosure.
function isRailCovered() {
  const body = globalThis.document?.body;
  return Boolean(
    body?.classList.contains('ui-clean-view') ||
    body?.classList.contains('recording-mode') ||
    body?.classList.contains('stories-mode') ||
    body?.classList.contains('ui-embed') ||
    body?.dataset.assistantDocked === 'true',
  );
}
const railCovered = ref(isRailCovered());
const pageVisible = ref(globalThis.document?.visibilityState !== 'hidden');
function updatePageVisibility() {
  pageVisible.value = globalThis.document?.visibilityState !== 'hidden';
}
// A reply can arrive before the observer or visibility event updates Vue.
const readInspectorVisibility = () =>
  !isRailCovered() && globalThis.document?.visibilityState !== 'hidden';
// Only an open panel reads what is picked and in view; closed, it does no work.
const contextOpen = computed(() => chromePanels.value['global-context-panel']?.collapsed === false);
const { presence: cockpit } = storeToRefs(useCockpitStore());
const inspectorMount = ref(null);
const viewContextPresent = computed(() => showInspect.value && (!entityCard.value || Boolean(inlineCameraId.value)));
const inspectorShown = computed(() =>
  inspectorMount.value !== null &&
  contextOpen.value &&
  viewContextPresent.value &&
  pageVisible.value &&
  !railCovered.value &&
  !bhotePanel.value &&
  contextOnScreen.value &&
  !cockpit.value?.active,
);
watch(
  [inspectorShown, inspectorMount],
  ([shown, mountId]) => entityCards.setViewContextShown(shown, mountId, readInspectorVisibility),
  { immediate: true, flush: 'sync' },
);
// A later mount starts as the button says: not expanded.
onBeforeUnmount(() => setDocked(false));
onBeforeUnmount(() => entityCards.setViewContextShown(false, null));
const panelChrome = usePanelChromeStore();
// The folded name goes as the panel opens: opened from the keyboard, focus
// moves to the expanded header's fold button.
function openContext(event) {
  if (contextOpen.value) return;
  panelChrome.act('toggle', 'global-context-panel');
  if (event?.detail !== 0 || !contextOpen.value) return;
  void nextTick(() => globalThis.document?.querySelector('#global-context-panel .panel-collapse-btn')?.focus({ preventScroll: true }));
}
// A keyboard Close takes the mini player away: focus goes to Context's body,
// or folded, to its name.
function onMiniPlayerClosed(event) {
  if (event?.detail !== 0) return;
  void nextTick(() =>
    (contextOpen.value ? contextScroller.value : globalThis.document?.querySelector('#global-context-panel .context-title-open'))?.focus({ preventScroll: true }),
  );
}
watch(
  () => chromePanels.value['global-context-panel']?.collapsed,
  (collapsed) => {
    if (collapsed && docked.value) setDocked(false);
  },
);
// The fold's element moves between its hidden home and the slot under the
// station list, after each update; the same element stays, so the controls
// RadioControls holds keep working.
const radioFoldHome = ref(null);
// Held from the first mount: once moved, the element may be out of the page
// (the list it sat under closed), where no lookup by id finds it.
let radioFold = null;
function placeRadioFold() {
  const home = radioFoldHome.value;
  radioFold ??= home?.querySelector('#radio-panel') ?? null;
  const fold = radioFold;
  if (!home || !fold) return;
  const slot = radioListShown.value ? globalThis.document.getElementById('radio-fold-slot') : null;
  const target = slot || home;
  if (fold.parentElement !== target) target.appendChild(fold);
}
watch([radioListShown, () => entityCard.value?.key, tab], placeRadioFold, { flush: 'post' });
onMounted(placeRadioFold);

// A camera's tools (projection, coverage, auto-hop, calibration, summary)
// move the same way, into the Camera settings tab while it shows; the
// standalone CCTV panel is retired (cctvToolsPlacement). They go home before
// the tab's slot leaves the page, and come in once it is there.
const cctvToolsHome = ref(null);
onMounted(() => registerCctvToolsHome(cctvToolsHome.value));
const cctvToolsSlotShown = computed(() => contextOpen.value && tab.value === 'camera' && !contextNeedle.value);
watch(cctvToolsSlotShown, (shown) => shown || returnCctvToolsHome(), { flush: 'pre' });
watch([cctvToolsSlotShown, () => entityCard.value?.key], placeCctvTools, { flush: 'post' });
onBeforeUnmount(returnCctvToolsHome);

// The card's × closes its photo. During other navigation, the photo stays
// in the dock or goes back to the viewer's offscreen home.
const streetLevelHome = ref(null);
const streetLevel = useStreetLevelStore();
onMounted(() => registerStreetLevelViewerHome(streetLevelHome.value));
onBeforeUnmount(() => registerStreetLevelViewerHome(null));
watch([() => entityCard.value?.key, tab, contextOpen], placeStreetLevelViewer, { flush: 'post' });
watch(entityCard, (next, previous) => {
  if (previous?.layerId !== 'street-level' || next?.key === previous.key) return;
  const dismissed = entityCards.wasDismissed(previous.key);
  if (dockedViews.isDocked(previous.key)) {
    if (dismissed) dockedViews.close();
    return;
  }
  streetLevel.act('closePhoto', previous.identity?.id, { pendingOnly: !dismissed });
});
// The docked view and the radio mini player are part of the right column:
// at its foot under an open Context, with the panel's edges and width; the
// column's layout keeps room for them (--right-stack-reserve,
// rightPanelRail.js), so Context gives up that height and the whole column
// stays clear of the corner buttons and the HUD readouts. Folded, they sit
// under Context's tab, across the column.
const contextCorner = ref(null);
let cornerObserver = null;
/** The longest the dock and the mini player wait unseen for room. */
const SETTLING_MAX_MS = 600;
let settlingTimer = 0;
let liftFrame = 0;
function clearColumn(corner, stack) {
  corner.classList.remove('context-corner--column', 'context-corner--mini-first', 'context-corner--settling');
  for (const prop of ['inset-inline-end', 'width', 'top', 'bottom']) corner.style.removeProperty(prop);
  if (stack?.style.getPropertyValue('--right-stack-reserve')) {
    stack.style.removeProperty('--right-stack-reserve');
    globalThis.dispatchEvent?.(new Event('resize'));
  }
}
// With Context closed and no docked view, the radio mini player stands in
// the clear space above the bottom-right HUD readout: the column's width
// and right edge, one gap above the readout, so it covers neither the
// readout nor the corner buttons below it. False when there is no readout
// to stand on.
function aboveHudReadout(corner, stack) {
  const hud = globalThis.document.querySelector('#intel-hud .hud-bottom-right')?.getBoundingClientRect();
  const across = stack.getBoundingClientRect();
  if (!hud?.height || !across.width) return false;
  const gap = parseFloat(globalThis.getComputedStyle?.(stack)?.rowGap) || 8;
  const rtl = globalThis.getComputedStyle?.(corner)?.direction === 'rtl';
  const end = rtl ? across.left : globalThis.innerWidth - across.right;
  corner.classList.add('context-corner--column');
  corner.style.setProperty('inset-inline-end', `${Math.round(end)}px`);
  corner.style.setProperty('width', `${Math.round(across.width)}px`);
  corner.style.setProperty('top', 'auto');
  corner.style.setProperty('bottom', `${Math.round(globalThis.innerHeight - hud.top + gap)}px`);
  if (stack.style.getPropertyValue('--right-stack-reserve')) {
    stack.style.removeProperty('--right-stack-reserve');
    globalThis.dispatchEvent?.(new Event('resize'));
  }
  return true;
}
// With Context closed and a docked view, the dock keeps its own place (the
// corner's usual spot) and the mini player fits around it, the same width,
// one gap away: under the dock while that leaves it clear of the HUD
// readout, otherwise above the dock.
function besideDock(corner, dock, mini) {
  const style = globalThis.getComputedStyle?.(corner);
  const gap = parseFloat(style?.rowGap) || 6;
  const dockBottom = globalThis.innerHeight - (parseFloat(style?.bottom) || 0);
  const dockTop = dockBottom - dock.offsetHeight;
  const hud = globalThis.document.querySelector('#intel-hud .hud-bottom-right')?.getBoundingClientRect();
  const limit = hud?.height ? hud.top - gap : globalThis.innerHeight;
  if (dockBottom + gap + mini.offsetHeight <= limit) {
    corner.style.setProperty('top', `${Math.round(dockTop)}px`);
    corner.style.setProperty('bottom', 'auto');
  } else corner.classList.add('context-corner--mini-first');
}
function alignCorner() {
  const doc = globalThis.document;
  const corner = contextCorner.value;
  if (!corner || !doc) return;
  const panel = doc.getElementById('global-context-panel');
  const stack = doc.getElementById('right-context-rail');
  // A phone: a smaller tile just above the voice bar and the tab bar
  // (entity-card.css reads --phone-dock-bottom), clear of the rail and the
  // timeline.
  if (doc.body.classList.contains('mobile-shell')) {
    clearColumn(corner, stack);
    const bar = doc.getElementById('command-dock')?.getBoundingClientRect();
    if (bar?.height) corner.style.setProperty('--phone-dock-bottom', `${Math.round(globalThis.innerHeight - bar.top + 8)}px`);
    else corner.style.removeProperty('--phone-dock-bottom');
    return;
  }
  const panelBox = panel?.getBoundingClientRect();
  const open = Boolean(panelBox?.height) && !panel.classList.contains('collapsed');
  const mini = corner.querySelector('.radio-mini');
  const dock = corner.querySelector('.docked-view');
  if (stack && !open && mini) {
    if (!dock && aboveHudReadout(corner, stack)) return;
    if (dock) {
      clearColumn(corner, stack);
      return besideDock(corner, dock, mini);
    }
  }
  if (!stack || !panelBox?.height) return clearColumn(corner, stack);
  const across = open ? panelBox : stack.getBoundingClientRect();
  const gap = parseFloat(globalThis.getComputedStyle?.(stack)?.rowGap) || 8;
  const rtl = globalThis.getComputedStyle?.(corner)?.direction === 'rtl';
  const end = rtl ? across.left : globalThis.innerWidth - across.right;
  corner.classList.add('context-corner--column');
  corner.style.setProperty('inset-inline-end', `${Math.round(end)}px`);
  corner.style.setProperty('width', `${Math.round(across.width)}px`);
  // Under an open panel the dock and the mini player stand at the foot of
  // the column (where it could end, clear of the HUD readout and the corner
  // buttons), and the panel gives up their height above them. Their place
  // depends on nothing the panel does, and the panel's height only on
  // theirs, so a dock arriving lays the column out once instead of the two
  // measuring each other until they settle. Expanded, the column is the
  // full height and they go under it, as before.
  const foot = parseFloat(stack.dataset.columnBottom);
  if (open && !docked.value && Number.isFinite(foot)) {
    corner.style.setProperty('top', 'auto');
    corner.style.setProperty('bottom', `${Math.round(globalThis.innerHeight - foot)}px`);
  } else {
    corner.style.setProperty('top', `${Math.round(panelBox.bottom + gap)}px`);
    corner.style.setProperty('bottom', 'auto');
  }
  const reserve = open && corner.offsetHeight ? `${Math.round(corner.offsetHeight + gap)}px` : '';
  // Until the column has given up their room, the panel still runs down
  // over them: they wait unseen for that one layout instead of showing over
  // the panel's last rows (the column's style change measures again).
  // A panel that cannot shrink that far (a very short window) shows them
  // anyway after a moment, so they never stay hidden.
  const over = open && corner.offsetHeight && panelBox.bottom > corner.getBoundingClientRect().top;
  if (!over) {
    clearTimeout(settlingTimer);
    settlingTimer = 0;
    corner.classList.remove('context-corner--settling');
  } else if (!settlingTimer) {
    corner.classList.add('context-corner--settling');
    settlingTimer = setTimeout(() => contextCorner.value?.classList.remove('context-corner--settling'), SETTLING_MAX_MS);
  }
  if (stack.style.getPropertyValue('--right-stack-reserve') !== reserve) {
    if (reserve) stack.style.setProperty('--right-stack-reserve', reserve);
    else stack.style.removeProperty('--right-stack-reserve');
    globalThis.dispatchEvent?.(new Event('resize'));
  }
}
function liftHudCorner() {
  liftFrame = 0;
  alignCorner();
}
// After the layout settles; a timer, not a frame, so a background tab
// measures too.
// Measured once more after the column's top has eased into place, so the
// dock follows a move that settles after the first look.
const SETTLE_MS = 400;
let settleTimer = 0;
const queueLift = () => {
  liftFrame ||= setTimeout(liftHudCorner, 0);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(liftHudCorner, SETTLE_MS);
};
// Docking, undocking and the mini player coming or going re-measure at once.
watch([() => dockedViews.view?.key, () => radioUi.value?.selected?.id, () => radioUi.value?.audioState, radioListShown, contextOpen, docked], () => nextTick(queueLift));
// A HUD style or a layout change (cockpit, a timeline, a narrower window)
// moves the readouts without resizing anything: the body's and the HUD's
// attributes are watched too.
let layoutObserver = null;
onMounted(() => {
  queueLift();
  globalThis.addEventListener?.('resize', queueLift);
  if (typeof ResizeObserver === 'function' && contextCorner.value) {
    cornerObserver = new ResizeObserver(queueLift);
    cornerObserver.observe(contextCorner.value);
    const hud = globalThis.document?.querySelector('#intel-hud .hud-bottom-right');
    if (hud) cornerObserver.observe(hud);
    const panel = globalThis.document?.getElementById('global-context-panel');
    if (panel) cornerObserver.observe(panel);
    const voiceBar = globalThis.document?.getElementById('command-dock');
    if (voiceBar) cornerObserver.observe(voiceBar);
  }
  if (typeof MutationObserver === 'function' && globalThis.document?.body) {
    layoutObserver = new MutationObserver(queueLift);
    layoutObserver.observe(globalThis.document.body, { attributes: true, attributeFilter: ['class'] });
    const hudRoot = globalThis.document.getElementById('intel-hud');
    if (hudRoot) layoutObserver.observe(hudRoot, { attributes: true });
    // The column moves Context without resizing it (its top rises or
    // settles): its own style changes say so, and the dock follows.
    const column = globalThis.document.getElementById('right-context-rail');
    if (column) {
      layoutObserver.observe(column, { attributes: true, attributeFilter: ['style', 'class'] });
      // Its top eases into place: measure again once it has arrived.
      column.addEventListener('transitionend', queueLift);
    }
  }
});
onBeforeUnmount(() => {
  cornerObserver?.disconnect();
  layoutObserver?.disconnect();
  globalThis.document?.getElementById('right-context-rail')?.removeEventListener('transitionend', queueLift);
  globalThis.removeEventListener?.('resize', queueLift);
  clearTimeout(liftFrame);
  clearTimeout(settleTimer);
  clearTimeout(settlingTimer);
  if (contextCorner.value) clearColumn(contextCorner.value, globalThis.document?.getElementById('right-context-rail'));
});

// The selected tab is scrolled into view, and the row's fade measured again,
// whenever the tabs or the panel change.
watch([tab, () => tabIds.value.length, contextOpen], async () => {
  await nextTick();
  const selected = globalThis.document?.getElementById(`context-tab-${tab.value}`);
  if (selected && tabStrip.value?.contains(selected)) selected.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  measureTabStrip();
});

// A notice held under the pointer or focus is let go when Context closes.
watch(contextOpen, (open) => open || pinned.releaseNotice());
</script>

<template>
  <!-- Global Context is deliberately independent from the left layer accordion. -->
  <aside id="right-context-rail" class="ui-scroll" v-class-toggle="{ 'bhote-event-active': !!bhotePanel }" @keydown.capture="onEscape">
    <RailPanel id="global-context-panel" start-collapsed :title="t('CONTEXT')" sideways scroll rail-scroller>
        <!-- Folded, the name opens the panel too, not only the ◀ button. -->
        <template #title>
          <UiButton v-if="!contextOpen" class="ui-panel__title panel-title context-title-open" :label="t('Expand {name}', { name: t('CONTEXT') })" :native-title="false" @click="openContext">{{ t('CONTEXT') }}</UiButton>
          <span v-else class="ui-panel__title panel-title">{{ t('CONTEXT') }}</span>
        </template>
        <template #actions>
          <UiButton class="context-dock-btn" :pressed="Boolean(contextSearchOpen)" :aria-label="t('Search in Context')" :title="contextSearchOpen ? t('Close search') : t('Search in Context')" @click="toggleSearch">
            <UiIcon name="search" :size="null" />
          </UiButton>
          <UiButton class="context-dock-btn" :pressed="Boolean(docked)" :aria-label="t('Expand Context to a full-height column')" :title="docked ? t('Shrink') : t('Expand')" @click="setDocked(!docked)">
            <UiIcon :name="docked ? 'close_fullscreen' : 'open_in_full'" :size="null" />
          </UiButton>
        </template>
        <div ref="contextScroller" class="cyber-panel-body ui-scroll" data-rail-scroller tabindex="-1">
        <!-- Escape is the panel's (onEscape, in the capture phase): the card
             clears before the search closes. -->
        <UiSearchField v-if="contextSearchOpen" ref="searchInput" v-model="contextSearchText" class="context-search" @escape="onSearchEscape" role="search" input-class="context-search__input" :label="searchHint" :placeholder="searchHint" autocomplete="off" spellcheck="false" :clear-label="t('Clear search')" clear-class="context-search__clear" />
        <div v-if="contextOpen" id="context-body" :class="{ 'context-searching': contextSearchOpen && contextSearchText.trim() }">
          <div v-if="tabIds.length > 1" class="context-pin-tabs context-pin-tabs--main" role="tablist" :aria-label="t('Context')" @keydown="onTabKey">
            <!-- Inspect holds the start of the row; the other tabs scroll
                 beside it on one line, the row's end fading while more are
                 out of view. -->
            <UiButton id="context-tab-inspect" role="tab" :aria-selected="String(tab === 'inspect')" :tabindex="tab === 'inspect' ? 0 : -1" aria-controls="context-tab-panel" @click="selectTab('inspect')">{{ t('Inspect') }}</UiButton>
            <div ref="tabStrip" class="context-pin-tabs__strip" :class="{ 'is-clipped': tabsClipped }" role="presentation" @scroll.passive="measureTabStrip">
            <UiButton v-if="cameraSettingsAvailable" id="context-tab-camera" role="tab" :aria-selected="String(tab === 'camera')" :tabindex="tab === 'camera' ? 0 : -1" aria-controls="context-tab-panel" @click="selectTab('camera')">{{ t('Camera settings') }}</UiButton>
            <UiButton v-if="lists.length" id="context-tab-lists" role="tab" :aria-selected="String(tab === 'lists')" :tabindex="tab === 'lists' ? 0 : -1" aria-controls="context-lists" @click="selectTab('lists')">{{ listTabLabel }}</UiButton>
            <UiButton v-if="pins.length" id="context-tab-pinned" role="tab" :aria-selected="String(tab === 'pinned')" :tabindex="tab === 'pinned' ? 0 : -1" aria-controls="context-tab-panel" @click="selectTab('pinned')">
              {{ t('Pinned · {n}', { n: formatNumber(pins.length) }) }}
            </UiButton>
            </div>
          </div>
          <!-- Unpinning offers Undo here, above the tabs, so it stays when the
               last pin (and the Pinned tab) goes. -->
          <PinUndoNotice />
          <!-- Kept in the page, hidden, while a list shows: the other tabs
               control it. -->
          <div id="context-tab-panel" :hidden="tab === 'lists'" :role="tabIds.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="tabIds.length > 1 ? `context-tab-${tab === 'lists' ? 'inspect' : tab}` : undefined">
            <template v-if="tab === 'lists'"></template>
            <template v-else-if="showInspect">
              <EntityCard v-if="!inlineCameraId" />
              <!-- Nothing picked: the place, then Radio's stations while it
                   is on, then what is nearby. -->
              <ViewContext v-if="viewContextPresent" @mounted="inspectorMount = Symbol()" @unmounting="inspectorMount = null">
                <!-- Radio shows only the source chosen on its row: the
                     internet stations, or the local receiver. -->
                <template #cameras><div ref="cameraListHost"></div></template>
                <template #lead><RadioStations :module="radioModule" :ui="radioUi" /><LocalReceiverPlayer v-if="radioUi?.localReceiver" /></template>
              </ViewContext>
            </template>
            <!-- The camera's tools, moved in while this tab shows. -->
            <div v-else-if="tab === 'camera'" class="context-camera-settings">
              <div v-if="cctvToolsSlotShown" id="cctv-tools-slot"></div>
              <p v-else class="context-camera-settings__hint">{{ t('Clear the search to see the camera tools.') }}</p>
            </div>
            <PinnedGrid v-else :radio-on="Boolean(radioUi?.enabled)" @open-station="openStation" />
          </div>
        </div>
        <!-- The lists stay in the page while Context is closed or on another
             tab: each readout renders into its own body. -->
        <div v-show="contextOpen && tab === 'lists'" id="context-lists" role="tabpanel" aria-labelledby="context-tab-lists">
          <div v-if="lists.length > 1" class="context-pin-tabs context-list-tabs" role="tablist" :aria-label="t('Lists')" @keydown="onListKey">
            <UiButton v-for="list in lists" :id="`context-list-tab-${list.id}`" :key="list.id" role="tab" :aria-selected="String(listShown === list.id)" :tabindex="listShown === list.id ? 0 : -1" :aria-controls="`context-list-${list.id}`" @click="showContextList(list.id)">{{ listLabel(list) }}</UiButton>
          </div>
          <div v-show="listShown === 'space-missions'" id="context-list-space-missions" class="context-list" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-space-missions' : undefined">
            <div id="space-mission-panel-host" ref="missionHost">
              <MissionRoster />
              <MissionDetail />
            </div>
          </div>
          <div v-show="listShown === 'weather'" id="context-list-weather" class="context-list" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-weather' : undefined">
            <div id="weather-panel-body" class="context-list__body ui-scroll"></div>
          </div>
          <div v-show="listShown === 'news'" id="context-list-news" class="context-list" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-news' : undefined">
            <div id="news-panel-body" class="context-list__body ui-scroll"></div>
          </div>
          <div v-show="listShown === 'recent-imagery'" id="context-list-recent-imagery" class="context-list" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-recent-imagery' : undefined">
            <div id="recent-imagery-panel-body" class="context-list__body ui-scroll"></div>
          </div>

        </div>
        <!-- A selected space station's STATION and LIVE sections, after the
             card. PanelChrome finds collapsible panels once, at startup, and
             the tab content mounts only while Context is open, so they stay
             in the page, each hidden while it has nothing to show. -->
        <StationPanel />
        <LivePanel />
        </div>
        <!-- Expanded, the radio mini player stands here, at the column's
             foot, while what is above it scrolls. -->
        <div v-show="docked" id="context-mini-foot" class="context-mini-foot"></div>
    </RailPanel>
    <BhoteKoshiPanel />
  </aside>

  <!-- Bottom right: the docked view, directly above the radio mini player.
       Expanded, the docked view hides and pauses, and the same mini player
       moves to the column's foot. -->
  <div ref="contextCorner" class="context-corner">
    <DockedView />
    <Teleport to="#context-mini-foot" :disabled="!docked" defer>
      <RadioMiniPlayer :module="radioModule" :ui="radioUi" @closed="onMiniPlayerClosed" />
    </Teleport>
  </div>
  <!-- Radio's own controls are always in the page (RadioControls reads their
       elements once); they move under the station list while it shows. -->
  <div ref="radioFoldHome" class="radio-fold-home" hidden>
    <RadioFold />
  </div>
  <!-- The local receiver's card likewise (LocalSdrControls reads it once);
       Radio's Data Layers row borrows it while the local receiver is chosen
       (RowPanel.vue). -->
  <div class="sdr-card-home" hidden>
    <SdrCard />
  </div>
  <!-- The camera tools likewise (CctvControls reads their elements once);
       they move into the Camera settings tab while it shows. -->
  <div ref="cctvToolsHome" class="cctv-tools-home" hidden>
    <CctvTools />
  </div>
  <!-- The street-level photo likewise (a provider mounts its viewer in it);
       it moves onto the open photo's card, or into the dock. Its home is out
       of view rather than hidden, so a viewer built before the card shows
       has a size (street-level.css). -->
  <div ref="streetLevelHome" class="sl-viewer-home" aria-hidden="true" inert>
    <StreetLevelViewer />
  </div>
  <div id="scene-runtime" :class="{ active: !!sceneRuntime }">{{ sceneRuntime }}</div>
  <!-- Keep the camera walk connected while other tabs hide its list. -->
  <div hidden>
    <Teleport :to="cameraListHost" :disabled="!cameraListHost">
      <CameraList :shown="Boolean(cameraListHost && inspectorShown && !inlineCameraId)" :selected="inlineCameraId" />
    </Teleport>
  </div>
</template>
