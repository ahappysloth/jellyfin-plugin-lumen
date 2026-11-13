import { createDecipheriv, createECDH, createPublicKey, type ECDH, hkdfSync, randomBytes, verify } from 'node:crypto';
import { SEERR_URL, STUB_SEERR } from './api';

// The browser's and the push service's sides of Web Push, for the tests: a subscription whose address is the stub
// push service (support/stub-seerr.mjs, /push/:id), reading what Lumen sent there, and decrypting it as the browser
// would (RFC 8291) to check the notification inside. Playwright's browsers can't subscribe for real: there is no
// push service behind them.

const b64url = (data: Uint8Array): string => Buffer.from(data).toString('base64url');

/** A browser's push subscription: the address Lumen posts to, and the keys only this "browser" holds. */
export interface TestSubscription {
  id: string;
  /** As the Jellyfin server reaches the stub. */
  endpoint: string;
  p256dh: string;
  auth: string;
  ecdh: ECDH;
  authSecret: Buffer;
}

/** A new subscription. An `id` starting with "gone", "refused" or "down" makes the stub push service answer so. */
export function newSubscription(id = `device-${randomBytes(6).toString('hex')}`): TestSubscription {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  const authSecret = randomBytes(16);
  return {
    id,
    endpoint: `${SEERR_URL}/push/${id}`,
    p256dh: b64url(ecdh.getPublicKey()),
    auth: b64url(authSecret),
    ecdh,
    authSecret,
  };
}

/** One message as the push service got it (stub-seerr.mjs). */
export interface PushedMessage {
  id: string;
  authorization: string | null;
  ttl: string | null;
  urgency: string | null;
  encoding: string | null;
  /** The encrypted body, base64. */
  body: string;
}

/** The notification's payload, as Lumen's service worker reads it (Push/PushMessage.cs). */
export interface PushPayload {
  v: number;
  kind: string;
  title: string;
  body?: string;
  item?: string;
  key?: string;
  page?: string;
  image?: string;
  icon?: string;
  tag?: string;
}

/** Everything sent to the stub push service since the last reset, or only what went to one subscription. */
export async function pushed(subscription?: TestSubscription): Promise<PushedMessage[]> {
  const all = (await (await fetch(`${STUB_SEERR}/__stub/push`)).json()) as PushedMessage[];
  return subscription ? all.filter((m) => m.id === subscription.id) : all;
}

/** Decrypts an aes128gcm push message as the subscribed browser would (RFC 8291 §4, RFC 8188 §2). */
export function decrypt(subscription: TestSubscription, message: PushedMessage): PushPayload {
  const body = Buffer.from(message.body, 'base64');
  const salt = body.subarray(0, 16);
  const keyLength = body[20]!;
  const senderKey = body.subarray(21, 21 + keyLength);
  const cipher = body.subarray(21 + keyLength);
  const secret = subscription.ecdh.computeSecret(senderKey);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), subscription.ecdh.getPublicKey(), senderKey]);
  const ikm = Buffer.from(hkdfSync('sha256', secret, subscription.authSecret, info, 32));
  const key = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const aes = createDecipheriv('aes-128-gcm', key, nonce);
  aes.setAuthTag(cipher.subarray(cipher.length - 16));
  const record = Buffer.concat([aes.update(cipher.subarray(0, cipher.length - 16)), aes.final()]);
  // The record ends with the delimiter 0x02 (and any zero padding after it).
  const end = record.lastIndexOf(2);
  return JSON.parse(record.subarray(0, end).toString('utf8')) as PushPayload;
}

/**
 * Checks a message's `Authorization: vapid t=<JWT>, k=<key>` (RFC 8292) as a push service does: the JWT is signed by
 * `publicKey` (the one browsers subscribe with). Returns its claims.
 */
export function vapidClaims(message: PushedMessage, publicKey: string): { aud: string; exp: number; sub: string } {
  const match = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(message.authorization ?? '');
  if (!match) throw new Error(`not a VAPID header: ${message.authorization}`);
  const [, header, claims, signature, key] = match as unknown as [string, string, string, string, string];
  if (key !== publicKey) throw new Error('the header carries another public key');
  const point = Buffer.from(publicKey, 'base64url');
  const verifier = createPublicKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', x: b64url(point.subarray(1, 33)), y: b64url(point.subarray(33, 65)) },
  });
  const signed = verify(
    'sha256',
    Buffer.from(`${header}.${claims}`),
    { key: verifier, dsaEncoding: 'ieee-p1363' },
    Buffer.from(signature, 'base64url'),
  );
  if (!signed) throw new Error("the JWT isn't signed with the server's key");
  return JSON.parse(Buffer.from(claims, 'base64url').toString('utf8')) as { aud: string; exp: number; sub: string };
}
