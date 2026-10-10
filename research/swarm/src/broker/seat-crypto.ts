/**
 * Seats at rest: AES-256-GCM under SEAT_KEY (a Worker secret, 32 random bytes in base64), a
 * fresh 96-bit IV per write. Only the BrokerDO calls these; nothing here is ever logged.
 */

export type Sealed = { readonly iv: Uint8Array; readonly ciphertext: Uint8Array };

export class SeatKeyError extends Error {
  override readonly name = 'SeatKeyError';
}

export async function importSeatKey(base64: string): Promise<CryptoKey> {
  const raw = decodeBase64(base64.trim());
  if (raw.byteLength !== 32) throw new SeatKeyError('SEAT_KEY must be 32 bytes, base64-encoded');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function open(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: sealed.iv },
    key,
    sealed.ciphertext,
  );
  return new TextDecoder().decode(plaintext);
}

function decodeBase64(value: string): Uint8Array {
  try {
    return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  } catch {
    throw new SeatKeyError('SEAT_KEY is not base64');
  }
}
