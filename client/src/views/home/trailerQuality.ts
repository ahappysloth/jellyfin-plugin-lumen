/** Which of an online trailer's files a preview plays: its 720p one, or its 1080p one where the box needs that. */

/**
 * Source pixels of height a box may need before 720p looks soft in it: a little over 720, so a box that 720p fills about
 * one to one (a laptop's banner) keeps the smaller, quicker file.
 */
export const HD_ABOVE_PX = 760;

interface Box {
  width: number;
  height: number;
}

/**
 * Whether a 16:9 video covering `box` (object-fit: cover) at `pixelRatio` device pixels per CSS pixel needs more than
 * 720p: it's drawn `max(height, width * 9 / 16)` CSS pixels tall. A phone in portrait shows the middle third of its
 * width over the whole height (390x660 at 3x needs 1980 rows); a desktop's or a TV's banner most of it, big. A browser
 * asking to save data (navigator.connection.saveData) gets 720p, which is about 60% smaller.
 */
export function needsHd(box: Box, pixelRatio: number, saveData = false): boolean {
  return !saveData && Math.max(box.height, (box.width * 9) / 16) * (pixelRatio || 1) > HD_ABOVE_PX;
}

/** The files to try for an online trailer shown in `element`, best first: 1080p (where needed and there is one), 720p. */
export function trailerFiles(
  src: string,
  srcHd: string | null | undefined,
  element: Element | null,
): string[] {
  if (!srcHd || !element) return [src];
  const connection = (navigator as { connection?: { saveData?: boolean } }).connection;
  const box = { width: element.clientWidth, height: element.clientHeight };
  return needsHd(box, window.devicePixelRatio, !!connection?.saveData) ? [srcHd, src] : [src];
}

/**
 * A video's quality as IMDb names it ("720p"…), from its picture: its rows, or for a wide one letterboxed in fewer (a
 * 1280x536 scope trailer is IMDb's 720p) as many as 16:9 at its width would have. Undefined before its metadata loads.
 */
export function videoQuality(video: { videoWidth: number; videoHeight: number }): string | undefined {
  const rows = Math.max(video.videoHeight, Math.round((video.videoWidth * 9) / 16));
  return rows > 0 ? `${rows}p` : undefined;
}
