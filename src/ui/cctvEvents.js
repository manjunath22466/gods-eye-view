/**
 * Sent on the document when someone picks a camera (a click on the globe,
 * next/previous on the Data Layers row, voice or Context's own lists):
 * Context opens that camera's card. `detail: {cameraId}`.
 */
export const CCTV_SELECTED_EVENT = 'gev:cctv-selected';

/**
 * Sent on the document when a camera card moves the live video canvas into
 * its top image or back to its hidden home, so the video starts or stops.
 */
export const CCTV_VIDEO_HOST_EVENT = 'gev:cctv-video-host';
