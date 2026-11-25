/**
 * Sent on the document when someone picks a camera (a click on the globe,
 * next/previous on the Data Layers row, voice or Context's own lists):
 * Context opens that camera's card. `detail: {cameraId, explicitReselection?: boolean}`.
 * An explicit voice re-pick opens the card even if the camera is already active.
 */
export const CCTV_SELECTED_EVENT = 'gev:cctv-selected';
