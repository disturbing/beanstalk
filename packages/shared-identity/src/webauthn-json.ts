/**
 * What a browser posts back from a passkey ceremony (the JSON forms of `PublicKeyCredential`,
 * as @simplewebauthn/browser sends them), checked for shape and size. The cryptography is
 * checked by the verifier.
 */
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { z } from 'zod';

const B64 = z
  .string()
  .regex(/^[A-Za-z0-9_-]*$/)
  .max(16_384);
const CredentialId = B64.max(1400);

const Registration = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64,
    attestationObject: B64,
    transports: z.array(z.string().max(20)).max(10).optional(),
  }),
});

const Authentication = z.object({
  id: CredentialId,
  rawId: CredentialId,
  type: z.literal('public-key'),
  response: z.object({
    clientDataJSON: B64,
    authenticatorData: B64,
    signature: B64,
    userHandle: B64.optional(),
  }),
});

/** A registration response, or null when it is not one. */
export function parseRegistrationResponse(value: unknown): RegistrationResponseJSON | null {
  const parsed = Registration.safeParse(value);
  if (!parsed.success) return null;
  const { response, ...credential } = parsed.data;
  const { transports, ...rest } = response;
  return {
    ...credential,
    clientExtensionResults: {},
    response: { ...rest, ...(transports === undefined ? {} : { transports }) },
  };
}

/** An authentication response, or null when it is not one. */
export function parseAuthenticationResponse(value: unknown): AuthenticationResponseJSON | null {
  const parsed = Authentication.safeParse(value);
  if (!parsed.success) return null;
  const { response, ...credential } = parsed.data;
  const { userHandle, ...rest } = response;
  return {
    ...credential,
    clientExtensionResults: {},
    response: { ...rest, ...(userHandle === undefined ? {} : { userHandle }) },
  };
}
