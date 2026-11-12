/**
 * The longest "Public address for QR codes", in UTF-8 bytes: the QR code holds 106 (views/quickconnect/qr.ts), and
 * `/web/#/quickconnect?code=123456` takes 31 of them. The server checks the same (ConfigValidator.IsQuickConnectAddress).
 */
export const MAX_PUBLIC_ADDRESS_BYTES = 75;

/**
 * "Public address for QR codes" (Lumen's settings, General): empty (not set), or an http(s) address, optionally with a
 * base path, as phones reach the server. No user name or password, query or fragment, and short enough for the QR code,
 * as the server checks too on save. The admin page checks it as it's typed.
 */
export function isPublicAddress(value: string): boolean {
  const text = value.trim();
  if (!text) return true;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (
    (url.protocol === 'http:' || url.protocol === 'https:') &&
    url.hostname !== '' &&
    !url.username &&
    !url.password &&
    // `?` or `#` alone parse to an empty search or hash, so look at the text; the client appends `/web/#/…` to it.
    !/[?#"<> ]/.test(text) &&
    new TextEncoder().encode(text).length <= MAX_PUBLIC_ADDRESS_BYTES
  );
}
