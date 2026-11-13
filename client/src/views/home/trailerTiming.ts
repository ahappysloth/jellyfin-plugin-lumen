/** Timings the local trailer preview (TrailerPreview.tsx) and the YouTube one (YouTubePreview.tsx) share. */

/**
 * How long a preview may take to get going before the next way to play it is tried. Some failures never raise an
 * error: WebKit stalls on HEVC the server copied into HLS for a user who may not transcode, unpaused, with all the
 * data it wants, and its clock a few microseconds past zero.
 */
export const TRAILER_START_TIMEOUT_MS = 12_000;
/** How far a preview must have played to count as under way (see TRAILER_START_TIMEOUT_MS), and to show. */
export const TRAILER_STARTED_SECONDS = 0.25;
/**
 * How long an ended preview takes to fade back to the backdrop before it's removed: the longest of the CSS fades
 * (.lmn-hero__video's transition, longer on the details page).
 */
export const TRAILER_FADE_MS = 1200;
