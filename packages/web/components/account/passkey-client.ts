/**
 * The browser half of a passkey ceremony: ask the server for options, run WebAuthn through
 * @simplewebauthn/browser, post the result back. Answers where to go next, or a message.
 */
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { WebAuthnError, startAuthentication, startRegistration } from '@simplewebauthn/browser';

export type Ceremony = 'signup' | 'signin' | 'add';

export type CeremonyOutcome =
  | { readonly kind: 'done'; readonly redirect: string }
  | { readonly kind: 'failed'; readonly message: string };

export async function runPasskeyCeremony(
  ceremony: Ceremony,
  input: { readonly handle?: string; readonly next?: string; readonly csrf?: string },
): Promise<CeremonyOutcome> {
  const started = await post(
    ceremony,
    { step: 'options', ...(input.handle === undefined ? {} : { handle: input.handle }) },
    input.csrf,
  );
  if (started.kind === 'failed') return started;
  const options: unknown = Reflect.get(started.body, 'options');
  let response: unknown;
  try {
    if (ceremony === 'signin') {
      if (!isRequestOptions(options)) return failed('The server sent no sign-in options.');
      response = await startAuthentication({ optionsJSON: options });
    } else {
      if (!isCreationOptions(options)) return failed('The server sent no passkey options.');
      response = await startRegistration({ optionsJSON: options });
    }
  } catch (error: unknown) {
    return failed(browserMessage(error));
  }
  const verified = await post(
    ceremony,
    { step: 'verify', response, ...(input.next === undefined ? {} : { next: input.next }) },
    input.csrf,
  );
  if (verified.kind === 'failed') return verified;
  const redirect: unknown = Reflect.get(verified.body, 'redirect');
  return { kind: 'done', redirect: typeof redirect === 'string' ? redirect : '/' };
}

type Posted =
  | { readonly kind: 'ok'; readonly body: object }
  | { readonly kind: 'failed'; readonly message: string };

async function post(ceremony: Ceremony, body: object, csrf: string | undefined): Promise<Posted> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (csrf !== undefined) headers['x-csrf-token'] = csrf;
  let response: Response;
  try {
    response = await fetch(`/api/auth/passkey/${ceremony}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    // Offline or blocked: nothing reached the server.
    return failed('Could not reach Beanstalk. Check your connection.');
  }
  const json: unknown = await response.json().catch(() => null);
  const answer = typeof json === 'object' && json !== null ? json : {};
  if (response.ok) return { kind: 'ok', body: answer };
  const error: unknown = Reflect.get(answer, 'error');
  const message: unknown =
    typeof error === 'object' && error !== null ? Reflect.get(error, 'message') : undefined;
  return failed(typeof message === 'string' ? message : 'Something went wrong. Try again.');
}

function browserMessage(error: unknown): string {
  if (error instanceof WebAuthnError && error.code === 'ERROR_CEREMONY_ABORTED')
    return 'Cancelled.';
  if (error instanceof Error && error.name === 'NotAllowedError')
    return 'Cancelled, or no passkey was chosen.';
  if (error instanceof Error && error.name === 'InvalidStateError')
    return 'That passkey is already registered here.';
  return 'Your browser could not use a passkey here.';
}

function failed(message: string): { readonly kind: 'failed'; readonly message: string } {
  return { kind: 'failed', message };
}

function isCreationOptions(value: unknown): value is PublicKeyCredentialCreationOptionsJSON {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'challenge') === 'string' &&
    typeof Reflect.get(value, 'rp') === 'object' &&
    typeof Reflect.get(value, 'user') === 'object'
  );
}

function isRequestOptions(value: unknown): value is PublicKeyCredentialRequestOptionsJSON {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'challenge') === 'string'
  );
}
