/**
 * The envelope for Actions secret values at rest (doc 25 §3.4): AES-256-GCM under the Worker
 * secret `ACTIONS_SECRETS_KEY`, with additional data that binds each value to where it belongs
 * (a repository or an org, and the name), so a row copied elsewhere does not decrypt.
 */
import { base64UrlDecode, base64UrlEncode } from '../auth/base64url';

/** The key version written with each value (rotation adds a second). */
export const KEY_VERSION = 1;
const KEY_BYTES = 32;
const IV_BYTES = 12;

export async function importSecretsKey(keyBase64: string): Promise<CryptoKey> {
  const bytes = decodeBase64(keyBase64);
  if (bytes === null || bytes.length !== KEY_BYTES)
    throw new Error('ACTIONS_SECRETS_KEY must be 32 bytes, base64');
  return crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealValue(
  key: CryptoKey,
  additionalData: Uint8Array<ArrayBuffer>,
  value: string,
): Promise<{ ciphertext: string; iv: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    encodeText(value),
  );
  return { ciphertext: base64UrlEncode(new Uint8Array(ciphertext)), iv: base64UrlEncode(iv) };
}

export async function openValue(
  key: CryptoKey,
  additionalData: Uint8Array<ArrayBuffer>,
  sealed: { readonly ciphertext: string; readonly iv: string },
): Promise<string> {
  const iv = base64UrlDecode(sealed.iv);
  const ciphertext = base64UrlDecode(sealed.ciphertext);
  if (iv === null || ciphertext === null) throw new Error('a stored secret is malformed');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, additionalData },
    key,
    ciphertext,
  );
  return new TextDecoder().decode(plain);
}

function decodeBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return new Uint8Array(Array.from(atob(text.trim()), (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
}

export function encodeText(text: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(text));
}
