import { asBody, optionalString, requireString } from '../lib/validate.ts';
import { created, ok } from '../router.ts';
import type { Handler } from '../router.ts';
import { addAddress as addUserAddress, registerUser, toPublic, updateProfile } from './service.ts';

export const register: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const user = registerUser(ctx, {
    email: requireString(body, 'email'),
    name: requireString(body, 'name'),
    password: requireString(body, 'password'),
  });
  return created(toPublic(user));
};

export const me: Handler = (req) => ok(toPublic(req.user!));

export const updateMe: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const user = updateProfile(ctx, req.user!.id, { name: optionalString(body, 'name') });
  return ok(toPublic(user));
};

export const addAddress: Handler = (req, ctx) => {
  const body = asBody(req.body);
  const user = addUserAddress(ctx, req.user!.id, {
    line1: requireString(body, 'line1'),
    city: requireString(body, 'city'),
    region: requireString(body, 'region'),
    postalCode: requireString(body, 'postalCode'),
    country: requireString(body, 'country').toUpperCase(),
  });
  return created(toPublic(user));
};
