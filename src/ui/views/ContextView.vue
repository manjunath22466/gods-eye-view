<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import { placeStreetLevelViewer, registerStreetLevelViewerHome } from '../streetLevelViewerPlacement.js';
import StreetLevelPhotoViewer from './panels/StreetLevelPhotoViewer.vue';
import { isContextRailModeCovered } from '../mobileSheets.js';
import { STREET_LEVEL_LAYER } from '../streetLevelEvents.js';
import StreetLevelViewer from './panels/StreetLevelViewer.vue';
import { storeToRefs } from 'pinia';
import { formatNumber, t } from '../../i18n/index.js';
import RailPanel from '../rail/RailPanel.vue';
import { vClassToggle } from '../rail/classToggle.js';
import { useBhoteKoshiPanelStore } from '../stores/bhoteKoshiPanel.js';
import { usePanelChromeStore } from '../stores/panelChrome.js';
import { sayWords, useEntityCardStore } from '../stores/entityCard.js';
import { useSceneStore } from '../stores/scenes.js';
import { usePinnedStore } from '../stores/pinned.js';
import { useCctvStore } from '../stores/cctv.js';
import { useDisplayStore } from '../stores/display.js';
import { useCockpitStore } from '../stores/cockpit.js';
import { useContextStore } from '../stores/context.js';
import AwarenessPanel from './panels/AwarenessPanel.vue';
import SpaceMissionsPanel from './panels/SpaceMissionsPanel.vue';
import RadioPanel from './panels/RadioPanel.vue';
import { cockpitEntryFace } from '../cockpitPresentation.js';
import { LAYER_TABS, TAB_AFFECTS, activeTab, availableTabs, contextReady, enabledLayerIds, setEnabledLayers, tabTarget } from '../contextLayerTabs.js';
import { shownLayerName } from '../layerNames.js';
import BhoteKoshiPanel from './panels/BhoteKoshiPanel.vue';
import EntityCard from './panels/EntityCard.vue';
import ViewContext from './panels/ViewContext.vue';
import PinnedGrid from './panels/PinnedGrid.vue';
import PinUndoNotice from './panels/PinUndoNotice.vue';
import RadioStations from './panels/RadioStations.vue';
import RadioMiniPlayer from './panels/RadioMiniPlayer.vue';
import LocalReceiverPlayer from './panels/LocalReceiverPlayer.vue';
import DockedView from './panels/DockedView.vue';
import { placeCctvTools, returnCctvToolsHome } from '../cctvToolsPlacement.js';
import { CAMERA_SETTINGS_EVENT, CONTEXT_NEARBY_EVENT, ESCAPE_OWNING_DIALOGS } from '../contextEvents.js';
import { useStreetLevelStore } from '../stores/streetLevel.js';
import { useDockedStore } from '../stores/docked.js';
import { useRadioLayer } from '../radioContext.js';
import { useSpaceMissionsStore } from '../stores/spaceMissions.js';
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
import CameraList from './panels/CameraList.vue';
import LivePanel from './panels/LivePanel.vue';
import StationPanel from './panels/StationPanel.vue';
import UiButton from '../kit/UiButton.vue';
import UiIcon from '../kit/UiIcon.vue';
import UiSearchField from '../kit/UiSearchField.vue';
import { closeContextSearch, contextNeedle, contextSearchOpen, contextSearchText } from '../contextSearch.js';

// While the Bhote Koshi event is on, its panel is the rail's only content.
const { visiblePanel: bhotePanel } = storeToRefs(useBhoteKoshiPanelStore());
// The Scene runtime chip SceneControls presents while a scene plays.
const { panel: scenePanel } = storeToRefs(useSceneStore());
const sceneRuntime = computed(() => scenePanel.value?.runtime ?? '');
// Context shows what is picked, led by its hero; with nothing picked, it
// summarises the layers that are on around the view.
const entityCards = useEntityCardStore();
const { card: entityCard } = storeToRefs(entityCards);

// ContextControls presents the mode switch and the nearby sites search and
// publishes them; until it does, the panel shows its initial markup.
const context = useContextStore();
const { view: ctx, awareness } = storeToRefs(context);
const { presence: cockpit } = storeToRefs(useCockpitStore());
const { phoneShell } = storeToRefs(useDisplayStore());
// The entry names the subject it would ride (cockpitEntryFace).
const entry = computed(() =>
  cockpitEntryFace(cockpit.value?.entryKind, cockpit.value?.entryFace),
);
const contactsSubject = computed(() =>
  ctx.value?.flightsActive ? awareness.value?.subjectIdentity : null,
);
const contactsMatchCard = computed(() => {
  const card = entityCard.value;
  const subject = contactsSubject.value;
  return Boolean(
    card?.kind === 'aircraft' &&
      subject?.layerId === card.layerId &&
      String(subject.id) === String(card.identity.id),
  );
});
let mirroringContact = false;
watch(
  [() => contactsSubject.value?.layerId, () => contactsSubject.value?.id],
  ([layerId, id]) => {
    if (!['flights', 'military'].includes(layerId) || !id || contactsMatchCard.value) return;
    // Contacts already owns tracking. Only a deliberate choice reveals the
    // Inspector and withdraws the unrelated photo.
    const selectedByUser = awareness.value?.subjectOrigin === 'user';
    mirroringContact = !selectedByUser;
    try {
      entityCards.select({ layerId, id, label: awareness.value?.subjectLabel }, { follow: false, reveal: selectedByUser });
    } finally {
      mirroringContact = false;
    }
  },
);

// Layer tabs: settings for the layers that are on, beside the card.
let layerTimer = null;
const readLayers = () => {
  const rows = entityCards.liveLayers();
  layerNames.value = Object.fromEntries(rows.map((row) => [row.id, shownLayerName(row.name, row.id)]));
  setEnabledLayers(rows.map((row) => row.id));
};
const paneRefs = {};
const setPane = (id) => (el) => {
  if (el) {
    paneRefs[id] = el;
    const target = tabTarget(id);
    if (target instanceof HTMLElement && target.parentElement !== el) el.appendChild(target);
  }
};
// Turning on Radio reveals the Inspector.
function showView(event) {
  activeTab.value = 'view';
  if (event?.detail?.inspect === true) selectTab('inspect');
}
onMounted(() => {
  const body = globalThis.document?.body;
  if (body && globalThis.MutationObserver) {
    // Keep rail visibility current and undock when phone layout or Cockpit starts.
    bodyWatch = new MutationObserver(() => {
      railCovered.value = isContextRailModeCovered();
      if (docked.value && (body.classList.contains('mobile-shell') || body.classList.contains('cockpit-mode'))) setDocked(false);
    });
    bodyWatch.observe(body, { attributeFilter: ['class'] });
    railCovered.value = isContextRailModeCovered();
  }
  globalThis.document?.addEventListener('visibilitychange', updatePageVisibility);
  updatePageVisibility();
  globalThis.addEventListener?.('gev:context-show-view', showView);
  contextReady.value = true;
  readLayers();
  layerTimer = setInterval(readLayers, 1500);
});
onBeforeUnmount(() => {
  bodyWatch?.disconnect();
  globalThis.document?.removeEventListener('visibilitychange', updatePageVisibility);
  entityCards.setViewContextShown(false, null);
  globalThis.removeEventListener?.('gev:context-show-view', showView);
  clearInterval(layerTimer);
  contextReady.value = false;
  // A later mount starts with no tab classes.
  for (const layerTab of LAYER_TABS) globalThis.document?.body.classList.remove(`ctx-tab-${layerTab.id}`);
});
watch(availableTabs, (tabs) => {
  for (const layerTab of LAYER_TABS)
    globalThis.document?.body.classList.toggle(`ctx-tab-${layerTab.id}`, tabs.some((x) => x.id === layerTab.id));
  if (activeTab.value === 'props' && !tabs.length) activeTab.value = 'view';
});
// Picking something shows its card. A street-level photo's card moving on
// to the next image is the same card: its tab stays.
watch([() => entityCard.value?.key, () => entityCards.selectionGeneration()], ([key, generation], [previous, priorGeneration]) => {
  if (key && key !== previous && generation !== priorGeneration) activeTab.value = 'view';
});
// The two tabs swap with the arrow keys, and focus follows (tabs pattern).
function switchTab() {
  activeTab.value = activeTab.value === 'view' ? 'props' : 'view';
  void nextTick(() => globalThis.document?.getElementById(`context-tab-btn-${activeTab.value}`)?.focus());
}
const isShown = (id) => availableTabs.value.some((layerTab) => layerTab.id === id);
// The names of the layers a section's settings act on.
const layerNames = ref({});
// Each layer gets a steady colour of its own for its dot.
const DOT_COLORS = ['#36dcff', '#4be3a0', '#ffb547', '#c792ff', '#ff7a45', '#ff6b9a', '#9ad7ff', '#e6e36b'];
const dotColor = (layer) => {
  let h = 0;
  for (const ch of layer) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return DOT_COLORS[h % DOT_COLORS.length];
};
const affects = (id) => {
  void enabledLayerIds.value;
  const ids = TAB_AFFECTS[id]?.(enabledLayerIds.value) ?? [];
  return ids.map((layer) => ({ id: layer, name: layerNames.value[layer] || layer, color: dotColor(layer) }));
};
// What is pinned: with anything pinned, Context has two tabs, Inspect (the
// pick, or awareness) and Pinned (the grid); with nothing pinned, no tabs.
const pinned = usePinnedStore();
const { pins, tab: pinnedTab } = storeToRefs(pinned);
// A layer with a list of its own (Space Missions, Weather, News, Recent
// Imagery) adds a tab while it is on: named for it when it is the only one,
// Lists with a sub-tab per layer when two or more are on. While its list
// shows, Context borrows the layer's right-rail readout (each is teleported
// into its target in the lists below).
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
watch(tab, (next) => context.setInspectorTab(next), { immediate: true, flush: 'sync' });
onBeforeUnmount(() => context.setInspectorTab('inspect'));
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
// Cameras never does: turning them on leaves Context on what is nearby, and
// their list opens from its tab or Nearby's "Show all".
const DIRECT_ON_MS = 15_000;
const QUIET_LISTS = new Set(['cctv']);
watch(
  () => lists.value.map((list) => list.id),
  (ids, before) => {
    const added = ids.find((id) => !before.includes(id));
    const direct = entityCards.lastDirectOn;
    if (added && !QUIET_LISTS.has(added) && direct && Date.now() - direct.at < DIRECT_ON_MS && listForLayer(direct.layerId) === added) {
      showView();
      showContextList(added);
    }
  },
);
// Space Missions' list is on while its layer is; the others report from
// their readouts (contextLists.js). Turned off while its list shows, Lists
// moves to the next list that is on; with none left, Context goes to Inspect
// (never back to Pinned).
const { enabled: missionsOn, roster: missionRoster } = storeToRefs(useSpaceMissionsStore());
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
    if (!ids.length || !(stripGone || gone.some((id) => focused?.closest?.(`#context-list-tab-${id}, #${listPaneId(id)}`)))) return;
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
// A list shows only on the Inspector, while Context is open.
const showsList = (id) => contextOpen.value && activeTab.value === 'view' && tab.value === 'lists' && listShown.value === id;
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
  showView();
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
// The pane each Lists sub-tab controls: a borrowed readout's target, or the
// camera list.
const listPaneId = (id) => (id === 'cctv' ? 'context-list-cctv' : id === 'space-missions' ? 'context-live-missions' : `context-live-${id}`);
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
  activeTab.value = 'view';
  void nextTick(() => searchInput.value?.focus());
}
const searchHint = computed(() =>
  entityCard.value ? t('Search {name} and nearby', { name: sayWords(entityCard.value.titleWords, entityCard.value.title) }) : t('Search what is in view'),
);

// Expanded, Context becomes a full-height column over the right edge of the
// screen, with the globe left as it is underneath. It shrinks back when the
// panel closes.
const docked = ref(false);
const dockedViews = useDockedStore();
const { panels: chromePanels } = storeToRefs(usePanelChromeStore());
let bodyWatch = null;
function setDocked(next) {
  docked.value = next;
  // The column covers the corner: the docked view hides and pauses meanwhile.
  dockedViews.setStowed(next);
  const body = globalThis.document?.body;
  body?.classList.toggle('context-docked', next);
}
const railCovered = ref(isContextRailModeCovered());
const pageVisible = ref(globalThis.document?.visibilityState !== 'hidden');
function updatePageVisibility() {
  pageVisible.value = globalThis.document?.visibilityState !== 'hidden';
}
// A reply can arrive before the observer or visibility event updates Vue.
const readInspectorVisibility = () =>
  !isContextRailModeCovered() && !bhotePanel.value && globalThis.document?.visibilityState !== 'hidden';
// Only an open panel reads what is picked and in view; closed, it does no work.
const contextOpen = computed(() => chromePanels.value['global-context-panel']?.collapsed === false);
const inspectorMount = ref(null);
const viewContextPresent = computed(() => showInspect.value && !entityCard.value);
const contextViewShown = computed(() =>
  contextOpen.value &&
  activeTab.value === 'view' &&
  pageVisible.value &&
  !railCovered.value &&
  !bhotePanel.value &&
  (!phoneShell.value?.enabled || phoneShell.value.sheet === 'context') &&
  !cockpit.value?.active,
);
provide('contextViewShown', contextViewShown);
const inspectorShown = computed(() =>
  inspectorMount.value !== null && viewContextPresent.value && contextViewShown.value,
);
const inspectorTab = ref(null);
let keyboardOrigin = null;
// Keep keyboard focus with the selected card, then return it to the originating row.
async function focusKeyboardSelection(rowKey) {
  const generation = entityCards.selectionGeneration();
  await nextTick();
  const cardKey = entityCard.value?.key;
  const close = inspectorTab.value?.querySelector('.entity-card__close');
  if (!cardKey || entityCards.selectionGeneration() !== generation || !close) return;
  keyboardOrigin = { rowKey, cardKey, generation };
  close.focus();
}
watch(() => entityCard.value?.key, async (key, previous) => {
  const origin = keyboardOrigin;
  if (!origin || key === origin.cardKey) return;
  if (key && origin.generation === entityCards.selectionGeneration()) {
    origin.cardKey = key;
    return;
  }
  keyboardOrigin = null;
  if (key || previous !== origin.cardKey || !inspectorTab.value?.contains(document.activeElement)) return;
  await nextTick();
  if (!inspectorShown.value || entityCard.value) return;
  const inspector = inspectorTab.value?.querySelector('.view-context');
  const row = [...(inspector?.querySelectorAll('[data-row-key]') || [])]
    .find((candidate) => candidate.dataset.rowKey === origin.rowKey);
  (row || inspector)?.focus();
});
watch(
  [inspectorShown, inspectorMount],
  ([shown, mountId]) => entityCards.setViewContextShown(shown, mountId, readInspectorVisibility),
  { immediate: true, flush: 'sync' },
);
// A later mount starts as the button says: not expanded.
onBeforeUnmount(() => setDocked(false));
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
// Opening one of the old list panels leaves Context's list for Inspect.
// A layer a person just turned on opens its panel by itself (Space Missions
// reveals it, Weather opens it on first appearance): that open leaves the
// list its layer showed in Context.
const LIST_PANEL = ['space-missions-panel', 'weather-panel', 'news-panel', 'recent-imagery-panel'];
const PANEL_LIST = ['space-missions', 'weather', 'news', 'recent-imagery'];
const oldListOpens = () => LIST_PANEL.map((id) => chromePanels.value[id]?.collapsed);
const openedWithItsLayer = (i) => {
  const direct = entityCards.lastDirectOn;
  return Boolean(
    direct && Date.now() - direct.at < DIRECT_ON_MS && listForLayer(direct.layerId) === PANEL_LIST[i] && listShown.value === PANEL_LIST[i],
  );
};
watch(oldListOpens, (next, prev) => {
  if (next.some((value, i) => value === false && prev[i] === true && !openedWithItsLayer(i))) selectTab('inspect');
});
// A camera's tools (projection, coverage, auto-hop, calibration, summary)
// move from the CCTV panel into the Camera settings tab while it shows
// (cctvToolsPlacement). They go home before the tab's slot leaves the page,
// and come in once it is there.
const cctvToolsSlotShown = computed(
  () => contextOpen.value && activeTab.value === 'view' && tab.value === 'camera' && !contextNeedle.value,
);
watch(cctvToolsSlotShown, (shown) => shown || returnCctvToolsHome(), { flush: 'pre' });
watch([cctvToolsSlotShown, () => entityCard.value?.key], placeCctvTools, { flush: 'post' });
onBeforeUnmount(returnCctvToolsHome);

const streetLevel = useStreetLevelStore();
watch([() => entityCard.value?.key, tab, activeTab, contextOpen, () => streetLevel.expanded, () => streetLevel.view?.viewer?.openingPaidPhoto], () => {
  // The Inspector's v-show directive can update after the post-flush watcher.
  void nextTick(placeStreetLevelViewer);
}, { flush: 'post' });
// Picking a different item (not another photo's card) closes the photo,
// whether it shows on a card, waits in its home with no card, or is still
// loading, so a late load cannot open after the pick. It runs inside the
// pick, before anything else reacts to it.
const pickClosesPhoto = (card) => card != null && card.layerId !== STREET_LEVEL_LAYER;
watch(
  () => entityCard.value?.key,
  () => {
    if (mirroringContact || !pickClosesPhoto(entityCard.value)) return;
    if (dockedViews.view?.kind === 'street') return;
    const photo = streetLevel.view?.viewer.photo;
    if (photo && pinned.isPinned(`street-level:${photo.id}`)) {
      const street = entityCards.layerModule(STREET_LEVEL_LAYER)?.getUIState?.()?.street;
      if (!street?.loading && !street?.opening) return;
    }
    streetLevel.act('withdrawPhoto');
  },
  { flush: 'sync' },
);
// The photo card's × closes the photo. Another photo's card, a click on open
// ground or map Escape cancels only a photo still loading for that card; a
// photo already showing goes back to its offscreen home and stays open.
watch(entityCard, (next, previous) => {
  if (previous?.layerId !== STREET_LEVEL_LAYER || next?.key === previous.key || pickClosesPhoto(next)) return;
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
    <RailPanel id="weather-panel" hidden :title="t('WEATHER')" sideways rail-scroller>
      <template #badge><span id="weather-panel-count" :aria-label="t('Active weather products')">0</span></template>
      <Teleport defer to="#context-live-weather" :disabled="!showsList('weather')"><div id="weather-panel-body" class="ui-scroll" data-rail-scroller></div></Teleport>
    </RailPanel>
    <RailPanel id="news-panel" hidden :title="t('NEWS')" sideways rail-scroller>
      <template #badge><span id="news-panel-count" :aria-label="t('News items in the feed')">0</span></template>
      <Teleport defer to="#context-live-news" :disabled="!showsList('news')"><div id="news-panel-body" class="ui-scroll" data-rail-scroller></div></Teleport>
    </RailPanel>
    <RailPanel id="recent-imagery-panel" hidden :title="t('RECENT IMAGERY')" sideways rail-scroller>
      <template #badge><span id="recent-imagery-panel-count" :aria-label="t('Imagery days in the box')"></span></template>
      <Teleport defer to="#context-live-recent-imagery" :disabled="!showsList('recent-imagery')"><div id="recent-imagery-panel-body" class="ui-scroll" data-rail-scroller></div></Teleport>
    </RailPanel>
    <RailPanel id="global-context-panel" start-collapsed v-class-toggle="{ ...(ctx && { 'context-enabled': ctx.enabled }) }" :data-context-mode="ctx?.mode" :data-context-tab="activeTab" :title="t('CONTEXT')" sideways scroll rail-scroller>
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
             clears before the search closes. On a phone onEscape leaves it,
             and the field, which stops the key, closes the search. -->
        <UiSearchField v-if="contextSearchOpen" ref="searchInput" v-model="contextSearchText" class="context-search" @escape="onSearchEscape" role="search" input-class="context-search__input" :label="searchHint" :placeholder="searchHint" autocomplete="off" spellcheck="false" :clear-label="t('Clear search')" clear-class="context-search__clear" />
        <div v-if="availableTabs.length" class="context-tabs" role="tablist" :aria-label="t('Context tabs')">
          <UiButton id="context-tab-btn-view" role="tab" class="context-tabs__tab" :class="{ active: activeTab === 'view' }" :aria-selected="String(activeTab === 'view')" aria-controls="context-tab-view" :tabindex="activeTab === 'view' ? 0 : -1" @click="activeTab = 'view'" @keydown.left.prevent="switchTab" @keydown.right.prevent="switchTab">
            <UiIcon name="visibility" :size="null" /><span class="context-tabs__label">{{ t('Inspector') }}</span>
          </UiButton>
          <UiButton id="context-tab-btn-props" role="tab" class="context-tabs__tab" :class="{ active: activeTab === 'props' }" :aria-selected="String(activeTab === 'props')" aria-controls="context-tab-props" :tabindex="activeTab === 'props' ? 0 : -1" @click="activeTab = 'props'" @keydown.left.prevent="switchTab" @keydown.right.prevent="switchTab">
            <UiIcon name="tune" :size="null" /><span class="context-tabs__label">{{ t('Properties') }}</span>
          </UiButton>
        </div>
        <!-- Properties: settings of the layers that are on, one section each. -->
        <div id="context-tab-props" class="context-props" :hidden="activeTab !== 'props'" role="tabpanel" aria-labelledby="context-tab-btn-props">
          <section v-for="layerTab in LAYER_TABS" v-show="isShown(layerTab.id)" :key="layerTab.id" class="context-props__section">
            <h4 class="context-props__heading"><UiIcon :name="layerTab.icon" :size="null" />{{ t(layerTab.label) }}</h4>
            <ul v-if="affects(layerTab.id).length" class="context-props__layers">
              <li v-for="layer in affects(layerTab.id)" :key="layer.id"><i :style="{ background: layer.color }" aria-hidden="true"></i>{{ layer.name }}</li>
            </ul>
            <div :id="`context-tab-${layerTab.id}`" :ref="setPane(layerTab.id)" class="context-tab-pane"></div>
          </section>
        </div>
        <!-- Sections PanelChrome owns sit outside the Inspector view, which mounts
             only while Context is open: PanelChrome finds collapsible panels once,
             at startup. -->
        <StationPanel />
        <LivePanel />
        <RadioPanel />
        <div class="global-context-modes" role="tablist" :aria-label="t('Context mode')">
          <UiButton id="global-context-flights-btn" class="context-mode-button" v-class-toggle="{ active: ctx?.flightsActive }" role="tab" tabindex="0" :aria-selected="String(ctx?.flightsActive ?? false)" :aria-disabled="ctx && String(ctx.busy)" :aria-busy="ctx && String(ctx.busy)" aria-controls="context-flights-view" :aria-label="t('CONTACTS')" :title="t('Cycles the nearest contacts of whatever type you select — planes, vessels, installations. Satellites track independently.')">
            <UiIcon name="radar" :size="null" />
            <span>{{ t('CONTACTS') }}</span>
          </UiButton>
        </div>
        <div id="context-mode-standby" class="context-mode-standby" :hidden="ctx?.enabled">
          <strong>{{ t('SELECT CONTEXT') }}</strong>
          <span>{{ t('CONTACTS — nearest planes · vessels · sites') }}</span>
        </div>
        <section id="context-flights-view" class="context-mode-view" role="tabpanel" aria-labelledby="global-context-flights-btn" :hidden="!ctx?.flightsActive">
          <div class="global-context-actions" :aria-label="t('Contact Context actions')">
            <UiButton id="cockpit-entry" :hidden="!cockpit?.entryAvailable">
              <UiIcon :name="entry.icon" :size="null" />
              <span>{{ entry.label }}</span>
            </UiButton>
            <UiButton id="installations-search-btn" class="panel-layer-toggle" :aria-disabled="ctx && String(ctx.installationsBusy)" :aria-busy="ctx && String(ctx.installationsBusy)">{{ t('SEARCH NEARBY SITES') }}</UiButton>
            <UiButton id="tr3b-toggle" class="tr3b-toggle" :pressed="!!cockpit?.tr3b?.converted" :hidden="!cockpit?.tr3b" :aria-label="t('Reclassify tracked contact as TR-3B')" :title="cockpit?.tr3b?.converted ? t('Restore real aircraft') : t('Reclassify as TR-3B')">🛸</UiButton>
          </div>
          <AwarenessPanel v-if="!contactsMatchCard" />
        </section>
        <div v-if="contextOpen" v-show="activeTab === 'view'" id="context-tab-view" ref="inspectorTab" role="tabpanel" aria-labelledby="context-tab-btn-view" :class="{ 'context-searching': contextSearchOpen && contextSearchText.trim() }">
          <div v-if="streetLevel.view?.viewer?.openingPaidPhoto" id="sl-viewer-loading-slot" class="sl-hero__slot"></div>
        <div id="context-body">
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
              <EntityCard :with-contacts="contactsMatchCard" />
              <AwarenessPanel v-if="contactsMatchCard" compact />
              <!-- Nothing picked: the place, then Radio's stations while it
                   is on, then what is nearby. -->
              <ViewContext v-if="viewContextPresent" @vue:mounted="inspectorMount = Symbol()" @vue:before-unmount="inspectorMount = null" @keyboard-selection="focusKeyboardSelection">
                <!-- Radio shows only the source chosen on its row: the
                     internet stations, or the local receiver. -->
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
        </div>
        <!-- The lists stay in the page while Context is closed or on another
             tab: each borrowed readout is teleported into its target. -->
        <div v-show="contextOpen && activeTab === 'view' && tab === 'lists'" id="context-lists" role="tabpanel" aria-labelledby="context-tab-lists">
          <div v-if="lists.length > 1" class="context-pin-tabs context-list-tabs" role="tablist" :aria-label="t('Lists')" @keydown="onListKey">
            <UiButton v-for="list in lists" :id="`context-list-tab-${list.id}`" :key="list.id" role="tab" :aria-selected="String(listShown === list.id)" :tabindex="listShown === list.id ? 0 : -1" :aria-controls="listPaneId(list.id)" @click="showContextList(list.id)">{{ listLabel(list) }}</UiButton>
          </div>
          <div v-show="listShown === 'space-missions'" id="context-live-missions" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-space-missions' : undefined"></div>
          <div v-show="listShown === 'weather'" id="context-live-weather" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-weather' : undefined"></div>
          <div v-show="listShown === 'news'" id="context-live-news" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-news' : undefined"></div>
          <div v-show="listShown === 'recent-imagery'" id="context-live-recent-imagery" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-recent-imagery' : undefined"></div>
          <!-- Every camera within the radius, nearest first: it publishes its
               own tab and the order Prev and Next walk, so it stays in the page. -->
          <div v-show="listShown === 'cctv'" id="context-list-cctv" class="context-list" :role="lists.length > 1 ? 'tabpanel' : undefined" :aria-labelledby="lists.length > 1 ? 'context-list-tab-cctv' : undefined">
            <div class="context-list__body ui-scroll"><CameraList /></div>
          </div>
        </div>
        </div>
        <!-- Expanded, the radio mini player stands here, at the column's
             foot, while what is above it scrolls. -->
        <div v-show="docked" id="context-mini-foot" class="context-mini-foot"></div>
    </RailPanel>
    <SpaceMissionsPanel :list-open="showsList('space-missions')" />
    <BhoteKoshiPanel />
  </aside>

  <div :ref="registerStreetLevelViewerHome" class="sl-viewer-home" aria-hidden="true" inert>
    <StreetLevelViewer />
    <StreetLevelPhotoViewer />
  </div>

  <!-- Bottom right: the docked view, directly above the radio mini player.
       Expanded, the docked view hides and pauses, and the same mini player
       moves to the column's foot. -->
  <div ref="contextCorner" class="context-corner">
    <DockedView />
    <Teleport to="#context-mini-foot" :disabled="!docked" defer>
      <RadioMiniPlayer :module="radioModule" :ui="radioUi" @closed="onMiniPlayerClosed" />
    </Teleport>
  </div>
  <div id="scene-runtime" :class="{ active: !!sceneRuntime }">{{ sceneRuntime }}</div>
</template>
