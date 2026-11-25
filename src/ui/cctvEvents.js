/**
 * Sent on the document when someone picks a camera (a click on the globe,
 * next/previous on the Data Layers row, voice or Context's own lists):
 * Context opens that camera's card. `detail: {cameraId, explicitReselection?: boolean}`.
 * Voice and the panel's Nearest button announce a re-pick themselves because
 * the active camera stays the same.
 */
export const CCTV_SELECTED_EVENT = 'gev:cctv-selected';

export function announceCameraReselection(cameraId, previousId) {
  if (!cameraId || cameraId !== previousId) return false;
  globalThis.document?.dispatchEvent?.(
    new CustomEvent(CCTV_SELECTED_EVENT, {
      detail: { cameraId, explicitReselection: true },
    }),
  );
  return true;
}
