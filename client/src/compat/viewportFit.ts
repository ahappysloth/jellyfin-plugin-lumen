const COVER = /(^|[\s,;])viewport-fit\s*=\s*cover($|[\s,;])/i;

/**
 * Puts viewport-fit=cover back whenever jellyfin-web drops it. Its appHost.setUserScalable() (the photo slideshow
 * calls it on open and close) rewrites the viewport meta without it, and then iOS reports no safe-area insets while the
 * home-screen app's status bar stays translucent (HtmlInjector.cs asks for one only where the page started with
 * cover): Lumen's nav and jellyfin-web's app bar would sit under the clock until a reload. Only where the page started
 * with cover. Returns a stop function.
 */
export function keepViewportCover(doc: Document = document): () => void {
  const meta = doc.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (!meta || !COVER.test(meta.content)) return () => {};
  const observer = new MutationObserver(() => {
    if (!COVER.test(meta.content)) meta.content = `${meta.content}, viewport-fit=cover`;
  });
  observer.observe(meta, { attributes: true, attributeFilter: ['content'] });
  return () => observer.disconnect();
}
